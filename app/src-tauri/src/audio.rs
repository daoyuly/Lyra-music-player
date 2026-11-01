use rodio::{Decoder, OutputStream, OutputStreamHandle, Sink, Source};
use rustfft::{num_complex::Complex, Fft, FftPlanner};
use std::fs::File;
use std::io::BufReader;
use std::path::Path;
use std::sync::atomic::{AtomicBool, AtomicU32, AtomicU64, AtomicUsize, Ordering};
use std::sync::{mpsc, Arc, Mutex};
use std::thread;
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};

// Extra time we wait past the declared song duration before assuming the
// primary Sink::empty() watcher will never fire. Covers decoder tail latency,
// small metadata rounding, and the 400ms grace + 300ms poll of the watcher
// itself. 750ms is enough for MP3/FLAC/AAC without noticeably delaying the
// next song when the primary path is broken.
const FALLBACK_SLACK_MS: u64 = 750;

#[derive(Debug, thiserror::Error)]
pub enum AudioError {
    #[error("io: {0}")]
    Io(#[from] std::io::Error),
    #[error("decode: {0}")]
    Decode(String),
    #[error("stream: {0}")]
    Stream(String),
}

/// Per-playback pause bookkeeping. `since` holds the Instant of the current
/// pause (None when playing); `accumulated_ms` is the total pause time so far
/// on this playback. Reset at the start of every `play_file` and consulted by
/// the duration-fallback watcher so a pause never triggers auto-advance.
#[derive(Default)]
struct PauseState {
    accumulated_ms: u64,
    since: Option<Instant>,
}

/// Owns the audio pipeline. `OutputStream` (the `!Send` cpal handle) lives
/// forever on a dedicated audio thread; only the `Send + Sync`
/// `OutputStreamHandle` crosses thread boundaries. This keeps the struct
/// `Send + Sync` without any `unsafe`, and guarantees `OutputStream` drops on
/// its own thread — safe on macOS, Windows (WASAPI), and Linux (ALSA/PipeWire)
/// alike.
pub struct AudioPlayer {
    handle: OutputStreamHandle,
    sink: Arc<Mutex<Option<Sink>>>,
    // Incremented on every `play_file` and every `stop`. Watcher threads
    // read this to decide whether their "song finished" observation is
    // still relevant (i.e., the playback wasn't superseded by a new one).
    current_id: Arc<AtomicU64>,
    // Per-playback pause state. Reset on every `play_file`.
    paused: Arc<Mutex<PauseState>>,
    // 记忆化的当前音量。set_volume 更新它,play_file 在开新 Sink 后立刻应用,
    // 避免动态音量控制器压低到 0.7 后,下一首恢复到 1.0。
    volume: Arc<Mutex<f32>>,
    /// Host lines share one sink so the next sentence starts when the
    /// previous source ends, without launching a new player.
    speech: Arc<Mutex<Option<Sink>>>,
    // Live three-band spectrum of the song currently in the sink.
    // The audio thread only writes samples; FFT runs when the UI asks.
    spectrum: Arc<SpectrumBus>,
    // Signal the audio thread to drop the OutputStream and exit.
    shutdown: Option<mpsc::Sender<()>>,
    // Kept so Drop can join the worker before the AudioPlayer disappears.
    worker: Option<thread::JoinHandle<()>>,
}

impl AudioPlayer {
    pub fn new() -> Result<Self, AudioError> {
        let (init_tx, init_rx) =
            mpsc::channel::<Result<OutputStreamHandle, String>>();
        let (shutdown_tx, shutdown_rx) = mpsc::channel::<()>();

        let worker = thread::spawn(move || {
            // Create the OutputStream on this thread. It never leaves.
            let (stream, handle) = match OutputStream::try_default() {
                Ok(pair) => pair,
                Err(e) => {
                    let _ = init_tx.send(Err(e.to_string()));
                    return;
                }
            };
            // Hand back the clone-able handle so the outer struct can build sinks.
            if init_tx.send(Ok(handle)).is_err() {
                // Receiver dropped — nothing more to do.
                return;
            }
            drop(init_tx);
            // Park until shutdown. OutputStream stays alive here, and
            // its Drop runs on this thread when the block ends.
            let _ = shutdown_rx.recv();
            drop(stream);
        });

        let handle = init_rx
            .recv()
            .map_err(|e| AudioError::Stream(format!("audio worker init: {}", e)))?
            .map_err(AudioError::Stream)?;

        Ok(Self {
            handle,
            sink: Arc::new(Mutex::new(None)),
            current_id: Arc::new(AtomicU64::new(0)),
            paused: Arc::new(Mutex::new(PauseState::default())),
            volume: Arc::new(Mutex::new(1.0)),
            speech: Arc::new(Mutex::new(None)),
            spectrum: Arc::new(SpectrumBus::new()),
            shutdown: Some(shutdown_tx),
            worker: Some(worker),
        })
    }

    /// Play `path`. Returns a monotonically increasing playback id.
    /// When the sink naturally drains (song finished), `on_complete(id)` is
    /// called on a background thread. If `stop()` or another `play_file()` is
    /// called first, the watcher exits silently — the caller only gets
    /// `on_complete` for natural completions.
    ///
    /// `duration_hint_ms`: optional song length. When provided, a fallback
    /// timer thread fires `on_complete` after `duration + FALLBACK_SLACK_MS`
    /// if the primary Sink::empty() watcher hasn't already fired. This
    /// guards against rodio 0.19 + symphonia edge cases where `sound_count`
    /// never decrements to 0 after an MP3 decoder EOFs — without the
    /// fallback the watcher polls forever and auto-advance never triggers.
    ///
    /// Exactly one of the two paths ever invokes the callback — whichever
    /// takes the boxed FnOnce out of the shared slot first. Superseded
    /// playbacks (id bumped) suppress both paths.
    pub fn play_file<F>(
        &self,
        path: &Path,
        duration_hint_ms: Option<u64>,
        on_complete: F,
    ) -> Result<u64, AudioError>
    where
        F: 'static + Send + FnOnce(u64),
    {
        let file = File::open(path)?;
        let reader = BufReader::new(file);
        let decoder = Decoder::new(reader).map_err(|e| AudioError::Decode(e.to_string()))?;
        // convert_samples yields f32 in [-1, 1]. The tap copies those
        // samples into a ring; it does not filter or delay playback.
        let tapped = FreqTap::new(
            decoder.convert_samples::<f32>(),
            Arc::clone(&self.spectrum),
        );

        // Create the sink upfront so a failure here doesn't leave shared
        // state half-mutated. The sink attaches to the OutputStreamHandle
        // but contributes silence until we append.
        let new_sink = Sink::try_new(&self.handle)
            .map_err(|e| AudioError::Stream(e.to_string()))?;
        // 应用记忆化的音量:动态音量控制器把上一首压低到 0.7 之后,
        // 新 Sink 默认是 1.0,不加这一步会在换歌瞬间"音量突然弹回来"。
        new_sink.set_volume(*self.volume.lock().unwrap());

        // Bump id BEFORE swapping the sink. The previous watcher thread (if
        // any) may still be sleeping between polls; when it next reads
        // current_id it will find a different value and exit silently.
        let id = self.current_id.fetch_add(1, Ordering::SeqCst) + 1;

        {
            let mut guard = self.sink.lock().unwrap();
            if let Some(old) = guard.take() {
                old.stop();
            }
            // Append AFTER stopping the old sink — otherwise both sinks
            // feed the shared handle for a lock-acquisition-window worth
            // of samples, causing audible double-audio at each swap.
            new_sink.append(tapped);
            *guard = Some(new_sink);
        }

        // Reset per-playback pause bookkeeping. The old watcher (if any) has
        // already been invalidated by the id bump; whatever it reads next
        // will be zeroes but its id check exits first.
        {
            let mut ps = self.paused.lock().unwrap();
            ps.accumulated_ms = 0;
            ps.since = None;
        }

        // Shared FnOnce slot so both the empty-watcher and the duration
        // fallback race for it; whoever wins take()s the boxed callback,
        // the loser sees None and drops.
        type Callback = Box<dyn FnOnce(u64) + Send>;
        let on_complete: Arc<Mutex<Option<Callback>>> =
            Arc::new(Mutex::new(Some(Box::new(on_complete))));

        // Primary watcher — polls sink emptiness every 300ms.
        let sink_arc = Arc::clone(&self.sink);
        let current_id_w = Arc::clone(&self.current_id);
        let cb_w = Arc::clone(&on_complete);
        thread::spawn(move || {
            // Grace period so we don't observe "empty" before playback starts.
            thread::sleep(Duration::from_millis(400));
            loop {
                if current_id_w.load(Ordering::SeqCst) != id {
                    return; // superseded
                }
                let done = {
                    let guard = sink_arc.lock().unwrap();
                    guard.as_ref().map_or(true, |s| s.empty())
                };
                if done {
                    // Take the callback slot FIRST — this guarantees that a
                    // stop() or fallback race can't fire the same callback
                    // twice. Then verify id inside; if it moved, we drop
                    // the callback without invoking it (equivalent to stop's
                    // "no natural-complete" contract).
                    let taken = cb_w.lock().unwrap().take();
                    if let Some(cb) = taken {
                        if current_id_w.load(Ordering::SeqCst) == id {
                            cb(id);
                        }
                    }
                    return;
                }
                thread::sleep(Duration::from_millis(300));
            }
        });

        // Fallback timer — only armed when the caller knows the song length.
        // A hint of 0 means "duration unknown" (metadata read failed); firing
        // the fallback then would truncate short songs at FALLBACK_SLACK_MS,
        // so skip.
        //
        // Implemented as a poll loop (not a single sleep) so a pause during
        // playback defers firing: effective play time excludes both fully
        // accumulated pauses and the currently-open pause interval.
        if let Some(dur_ms) = duration_hint_ms.filter(|d| *d > 0) {
            let current_id_f = Arc::clone(&self.current_id);
            let cb_f = Arc::clone(&on_complete);
            let paused_f = Arc::clone(&self.paused);
            let wait_ms = dur_ms.saturating_add(FALLBACK_SLACK_MS);
            let started = Instant::now();
            thread::spawn(move || {
                loop {
                    if current_id_f.load(Ordering::SeqCst) != id {
                        return; // superseded
                    }
                    let (accumulated, in_pause_ms) = {
                        let ps = paused_f.lock().unwrap();
                        let in_pause = ps
                            .since
                            .as_ref()
                            .map(|t| t.elapsed().as_millis() as u64)
                            .unwrap_or(0);
                        (ps.accumulated_ms, in_pause)
                    };
                    let wall_ms = started.elapsed().as_millis() as u64;
                    let effective =
                        wall_ms.saturating_sub(accumulated).saturating_sub(in_pause_ms);
                    if effective >= wait_ms {
                        let taken = cb_f.lock().unwrap().take();
                        if let Some(cb) = taken {
                            if current_id_f.load(Ordering::SeqCst) == id {
                                cb(id);
                            }
                        }
                        return;
                    }
                    // Sleep until we might reach wait_ms; cap at 500ms so
                    // resume() is picked up within half a second even after
                    // a long pause.
                    let remaining = wait_ms - effective;
                    thread::sleep(Duration::from_millis(remaining.min(500)));
                }
            });
        }

        Ok(id)
    }

    pub fn stop(&self) {
        // Invalidate the current id so the watcher thread's completion emit
        // (if it happens to observe emptiness at the same time) gets suppressed.
        self.current_id.fetch_add(1, Ordering::SeqCst);
        let mut guard = self.sink.lock().unwrap();
        if let Some(sink) = guard.take() {
            sink.stop();
        }
        drop(guard);
        self.spectrum.silence();
    }

    /// Latest low / mid / high energy of the playing song, each in [0, 1],
    /// plus a low-band onset pulse. All zeros when nothing is playing.
    /// The FFT runs here, on the caller thread, never inside the audio callback.
    pub fn spectrum(&self) -> PlaybackSpectrum {
        self.spectrum.snapshot()
    }

    pub fn is_playing(&self) -> bool {
        let guard = self.sink.lock().unwrap();
        guard.as_ref().map_or(false, |s| !s.empty() && !s.is_paused())
    }

    /// Pause the current playback. No-op when nothing is loaded or already
    /// paused. Does NOT bump `current_id`, so both watcher threads stay
    /// armed; the fallback watcher explicitly excludes paused time from
    /// its "song should be over" comparison so it never fires early.
    pub fn pause(&self) {
        let guard = self.sink.lock().unwrap();
        let Some(sink) = guard.as_ref() else { return };
        if sink.is_paused() {
            return;
        }
        sink.pause();
        let mut ps = self.paused.lock().unwrap();
        if ps.since.is_none() {
            ps.since = Some(Instant::now());
        }
    }

    /// Resume a paused playback. No-op when nothing is loaded or not paused.
    /// Adds the elapsed pause interval to `accumulated_ms` so the fallback
    /// watcher's effective-time calculation stays honest across many
    /// pause/resume cycles.
    pub fn resume(&self) {
        let guard = self.sink.lock().unwrap();
        let Some(sink) = guard.as_ref() else { return };
        if !sink.is_paused() {
            return;
        }
        sink.play();
        let mut ps = self.paused.lock().unwrap();
        if let Some(t) = ps.since.take() {
            ps.accumulated_ms = ps
                .accumulated_ms
                .saturating_add(t.elapsed().as_millis() as u64);
        }
    }

    pub fn is_paused(&self) -> bool {
        let guard = self.sink.lock().unwrap();
        guard.as_ref().map_or(false, |s| s.is_paused())
    }

    /// 设置当前音量。值会被记住,任何新创建的 Sink 都会在开播时应用同一个音量,
    /// 避免"换歌就恢复满音量"。安全范围 [0.0, 1.5],超出会被裁剪。
    /// 从后台线程(动态音量控制器)频繁调用,只做短锁 + 一次赋值,不阻塞。
    pub fn set_volume(&self, v: f32) {
        let clamped = v.clamp(0.0, 1.5);
        {
            let mut vg = self.volume.lock().unwrap();
            *vg = clamped;
        }
        let guard = self.sink.lock().unwrap();
        if let Some(sink) = guard.as_ref() {
            sink.set_volume(clamped);
        }
        drop(guard);
        if let Some(sink) = self.speech.lock().unwrap().as_ref() {
            sink.set_volume(clamped);
        }
    }

    /// Queue one spoken line on the speech sink. A later line appended while
    /// an earlier one is still playing starts immediately after it.
    pub fn enqueue_speech(&self, wav: &[u8]) -> Result<(), String> {
        let decoder = Decoder::new(std::io::Cursor::new(wav.to_vec()))
            .map_err(|err| format!("speech decode: {err}"))?;
        let volume = *self.volume.lock().unwrap();
        let mut guard = self.speech.lock().unwrap();
        if let Some(sink) = guard.as_ref() {
            sink.set_volume(volume);
            sink.append(decoder);
            return Ok(());
        }
        let sink = Sink::try_new(&self.handle).map_err(|err| format!("speech sink: {err}"))?;
        sink.set_volume(volume);
        sink.append(decoder);
        *guard = Some(sink);
        Ok(())
    }

    pub fn speech_busy(&self) -> bool {
        self.speech
            .lock()
            .unwrap()
            .as_ref()
            .is_some_and(|sink| !sink.empty())
    }

    pub fn stop_speech(&self) {
        if let Some(sink) = self.speech.lock().unwrap().take() {
            sink.stop();
        }
    }

    /// 读回当前音量,主要给测试和调试用。
    pub fn get_volume(&self) -> f32 {
        *self.volume.lock().unwrap()
    }

}

impl Drop for AudioPlayer {
    fn drop(&mut self) {
        // Kill any live sink first so its Drop doesn't race with the audio
        // thread's OutputStream teardown.
        if let Ok(mut guard) = self.sink.lock() {
            if let Some(sink) = guard.take() {
                sink.stop();
            }
        }
        if let Ok(mut guard) = self.speech.lock() {
            if let Some(sink) = guard.take() {
                sink.stop();
            }
        }
        // Signal the audio thread to exit, then wait for it. The shutdown
        // channel dropping is also a valid signal in case send() fails.
        if let Some(tx) = self.shutdown.take() {
            let _ = tx.send(());
            drop(tx);
        }
        if let Some(worker) = self.worker.take() {
            let _ = worker.join();
        }
    }
}

/// Three bands the room animation listens to, each in [0, 1].
/// `pulse` is the rising edge of the low band — a soft beat, not a click track.
#[derive(Debug, Clone, Copy, serde::Serialize)]
pub struct PlaybackSpectrum {
    pub low: f32,
    pub mid: f32,
    pub high: f32,
    pub pulse: f32,
}

const RING: usize = 8192;
const FRAME: usize = 1024;

struct SpectrumBus {
    ring: Box<[AtomicU32]>,
    write: AtomicUsize,
    live: AtomicBool,
    sample_rate: AtomicU32,
    low: AtomicU32,
    mid: AtomicU32,
    high: AtomicU32,
    pulse: AtomicU32,
    prev_low: AtomicU32,
    analyzed: AtomicUsize,
    analyzed_at: AtomicU64,
    analyzer: Mutex<BandAnalyzer>,
}

struct BandAnalyzer {
    fft: Arc<dyn Fft<f32>>,
    scratch: Vec<Complex<f32>>,
    window: Vec<f32>,
}

impl SpectrumBus {
    fn new() -> Self {
        let mut planner = FftPlanner::<f32>::new();
        let fft = planner.plan_fft_forward(FRAME);
        let window: Vec<f32> = (0..FRAME)
            .map(|i| {
                0.5 - 0.5
                    * (2.0 * std::f32::consts::PI * i as f32 / (FRAME as f32 - 1.0)).cos()
            })
            .collect();
        let ring = (0..RING).map(|_| AtomicU32::new(0)).collect::<Vec<_>>().into_boxed_slice();
        Self {
            ring,
            write: AtomicUsize::new(0),
            live: AtomicBool::new(false),
            sample_rate: AtomicU32::new(44_100),
            low: AtomicU32::new(0),
            mid: AtomicU32::new(0),
            high: AtomicU32::new(0),
            pulse: AtomicU32::new(0),
            prev_low: AtomicU32::new(0),
            analyzed: AtomicUsize::new(0),
            analyzed_at: AtomicU64::new(0),
            analyzer: Mutex::new(BandAnalyzer {
                fft,
                scratch: vec![Complex::new(0.0, 0.0); FRAME],
                window,
            }),
        }
    }

    fn arm(&self) {
        let w = self.write.load(Ordering::Relaxed);
        self.analyzed.store(w, Ordering::Relaxed);
        self.analyzed_at.store(now_ms(), Ordering::Relaxed);
        self.live.store(true, Ordering::Relaxed);
        self.store_bands(PlaybackSpectrum { low: 0.0, mid: 0.0, high: 0.0, pulse: 0.0 });
        store_f(&self.prev_low, 0.0);
    }

    fn silence(&self) {
        self.live.store(false, Ordering::Relaxed);
        self.store_bands(PlaybackSpectrum { low: 0.0, mid: 0.0, high: 0.0, pulse: 0.0 });
    }

    fn push(&self, sample: f32) {
        let sample = if sample.is_finite() { sample } else { 0.0 };
        let i = self.write.fetch_add(1, Ordering::Relaxed);
        self.ring[i & (RING - 1)].store(sample.to_bits(), Ordering::Relaxed);
    }

    fn snapshot(&self) -> PlaybackSpectrum {
        if !self.live.load(Ordering::Relaxed) {
            return PlaybackSpectrum { low: 0.0, mid: 0.0, high: 0.0, pulse: 0.0 };
        }
        let end = self.write.load(Ordering::Relaxed);
        let prev = self.analyzed.load(Ordering::Relaxed);
        if end < FRAME || end.wrapping_sub(prev) < FRAME {
            return self.decayed();
        }
        let mut mono = [0.0f32; FRAME];
        let start = end - FRAME;
        for i in 0..FRAME {
            let bits = self.ring[(start + i) & (RING - 1)].load(Ordering::Relaxed);
            mono[i] = f32::from_bits(bits);
        }
        let sr = self.sample_rate.load(Ordering::Relaxed).max(1);
        let prev_low = load_f(&self.prev_low);
        let mut guard = match self.analyzer.lock() {
            Ok(g) => g,
            Err(poisoned) => poisoned.into_inner(),
        };
        let BandAnalyzer { fft, scratch, window } = &mut *guard;
        for i in 0..FRAME {
            let s = mono[i];
            scratch[i] = Complex::new(if s.is_finite() { s * window[i] } else { 0.0 }, 0.0);
        }
        fft.process(scratch);
        let bands = fold_bands(scratch, sr, prev_low);
        drop(guard);
        self.analyzed.store(end, Ordering::Relaxed);
        self.analyzed_at.store(now_ms(), Ordering::Relaxed);
        store_f(&self.prev_low, bands.low);
        self.store_bands(bands);
        bands
    }

    fn decayed(&self) -> PlaybackSpectrum {
        let age = now_ms().saturating_sub(self.analyzed_at.load(Ordering::Relaxed));
        let k = (-(age as f32) / 240.0).exp();
        PlaybackSpectrum {
            low: load_f(&self.low) * k,
            mid: load_f(&self.mid) * k,
            high: load_f(&self.high) * k,
            pulse: load_f(&self.pulse) * k,
        }
    }

    fn store_bands(&self, bands: PlaybackSpectrum) {
        store_f(&self.low, bands.low);
        store_f(&self.mid, bands.mid);
        store_f(&self.high, bands.high);
        store_f(&self.pulse, bands.pulse);
    }
}

/// Hann-windowed 1024-point FFT folded into low / mid / high plus a low-band pulse.
/// A full-scale sine near a band center should land mostly in that band.
#[cfg(test)]
pub(crate) fn spectrum_bands(mono: &[f32], sample_rate: u32, prev_low: f32) -> PlaybackSpectrum {
    if mono.len() < FRAME || sample_rate == 0 {
        return PlaybackSpectrum { low: 0.0, mid: 0.0, high: 0.0, pulse: 0.0 };
    }
    let samples = &mono[mono.len() - FRAME..];
    let mut buf: Vec<Complex<f32>> = Vec::with_capacity(FRAME);
    for i in 0..FRAME {
        let w = 0.5 - 0.5 * (2.0 * std::f32::consts::PI * i as f32 / (FRAME as f32 - 1.0)).cos();
        let s = samples[i];
        buf.push(Complex::new(if s.is_finite() { s * w } else { 0.0 }, 0.0));
    }
    let mut planner = FftPlanner::<f32>::new();
    let fft = planner.plan_fft_forward(FRAME);
    fft.process(&mut buf);
    fold_bands(&buf, sample_rate, prev_low)
}

fn fold_bands(buf: &[Complex<f32>], sample_rate: u32, prev_low: f32) -> PlaybackSpectrum {
    let bin_hz = sample_rate as f32 / FRAME as f32;
    let mut low_p = 0.0f32;
    let mut mid_p = 0.0f32;
    let mut high_p = 0.0f32;
    for k in 1..FRAME / 2 {
        let hz = k as f32 * bin_hz;
        let mag = buf[k].norm();
        let p = mag * mag;
        if hz < 180.0 {
            low_p += p;
        } else if hz < 2_000.0 {
            mid_p += p;
        } else if hz < 8_000.0 {
            high_p += p;
        }
    }
    let low = band_level(low_p);
    let mid = band_level(mid_p);
    let high = band_level(high_p);
    let pulse = ((low - prev_low) * 2.8).clamp(0.0, 1.0);
    PlaybackSpectrum { low, mid, high, pulse }
}

/// Map one band's power to 0..1. Real music spreads across bins and used to
/// sit near 0.1, which the picture could not show. The curve lifts that
/// quiet range; a full-scale sine still clamps near 1.
fn band_level(power: f32) -> f32 {
    let rms = (power / (FRAME as f32 * FRAME as f32)).sqrt();
    (1.0 - (-rms * 28.0).exp()).clamp(0.0, 1.0)
}

fn store_f(slot: &AtomicU32, v: f32) {
    slot.store(v.to_bits(), Ordering::Relaxed);
}

fn load_f(slot: &AtomicU32) -> f32 {
    f32::from_bits(slot.load(Ordering::Relaxed))
}

fn now_ms() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_millis() as u64)
        .unwrap_or(0)
}

/// Copies playback samples into the spectrum ring. `next` stays allocation-free.
struct FreqTap<S> {
    inner: S,
    bus: Arc<SpectrumBus>,
    channels: u16,
    acc: f32,
    seen: u16,
}

impl<S> FreqTap<S>
where
    S: Source<Item = f32>,
{
    fn new(inner: S, bus: Arc<SpectrumBus>) -> Self {
        let channels = inner.channels().max(1);
        let rate = inner.sample_rate().max(1);
        bus.sample_rate.store(rate, Ordering::Relaxed);
        bus.arm();
        Self {
            inner,
            bus,
            channels,
            acc: 0.0,
            seen: 0,
        }
    }
}

impl<S> Iterator for FreqTap<S>
where
    S: Iterator<Item = f32>,
{
    type Item = f32;

    fn next(&mut self) -> Option<f32> {
        let sample = self.inner.next()?;
        self.acc += sample;
        self.seen += 1;
        if self.seen >= self.channels {
            let mono = self.acc / self.channels as f32;
            self.acc = 0.0;
            self.seen = 0;
            self.bus.push(mono);
        }
        Some(sample)
    }
}

impl<S> Source for FreqTap<S>
where
    S: Source<Item = f32>,
{
    fn current_frame_len(&self) -> Option<usize> {
        self.inner.current_frame_len()
    }

    fn channels(&self) -> u16 {
        self.inner.channels()
    }

    fn sample_rate(&self) -> u32 {
        self.inner.sample_rate()
    }

    fn total_duration(&self) -> Option<Duration> {
        self.inner.total_duration()
    }
}

#[cfg(test)]
mod spectrum_tests {
    use super::spectrum_bands;

    fn sine(freq: f32, sr: u32, n: usize) -> Vec<f32> {
        (0..n)
            .map(|i| (2.0 * std::f32::consts::PI * freq * i as f32 / sr as f32).sin())
            .collect()
    }

    #[test]
    fn a_low_sine_lands_in_the_low_band() {
        let s = sine(100.0, 44_100, 1024);
        let b = spectrum_bands(&s, 44_100, 0.0);
        assert!(b.low > b.mid && b.low > b.high, "low={} mid={} high={}", b.low, b.mid, b.high);
        assert!(b.low > 0.35, "low={}", b.low);
    }

    #[test]
    fn a_mid_sine_lands_in_the_mid_band() {
        let s = sine(1_000.0, 44_100, 1024);
        let b = spectrum_bands(&s, 44_100, 0.0);
        assert!(b.mid > b.low && b.mid > b.high, "low={} mid={} high={}", b.low, b.mid, b.high);
        assert!(b.mid > 0.35, "mid={}", b.mid);
    }

    #[test]
    fn a_high_sine_lands_in_the_high_band() {
        let s = sine(6_000.0, 44_100, 1024);
        let b = spectrum_bands(&s, 44_100, 0.0);
        assert!(b.high > b.low && b.high > b.mid, "low={} mid={} high={}", b.low, b.mid, b.high);
        assert!(b.high > 0.35, "high={}", b.high);
    }

    #[test]
    fn silence_is_still() {
        let s = vec![0.0f32; 1024];
        let b = spectrum_bands(&s, 44_100, 0.0);
        assert_eq!(b.low, 0.0);
        assert_eq!(b.mid, 0.0);
        assert_eq!(b.high, 0.0);
        assert_eq!(b.pulse, 0.0);
    }

    #[test]
    fn a_rising_low_band_makes_a_pulse() {
        let s = sine(100.0, 44_100, 1024);
        let b = spectrum_bands(&s, 44_100, 0.0);
        assert!(b.pulse > 0.4, "pulse={}", b.pulse);
    }
}
