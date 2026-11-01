// Show-host speech. GLM-TTS (锤锤 / 小陈) when the Zhipu key is present.
// A dropped request is retried; macOS `say` is only used when there is no
// key, so a blip never swaps Lyra onto the system voice.
// One player at a time; cancel kills it so Enter-to-play doesn't talk over the song.

use serde::Deserialize;
use std::process::{Child, Command, Stdio};
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{Arc, Mutex};
use std::thread;
use std::time::Duration;

const ZHIPU_SECRET: &str = "provider.zhipu.apiKey";
const GLM_URL: &str = "https://open.bigmodel.cn/api/paas/v4/audio/speech";

#[derive(Deserialize)]
pub struct TtsLine {
    pub voice: String,
    pub text: String,
}

pub struct Tts {
    /// Bumped by cancel so a late GLM response cannot play over the song.
    generation: AtomicU64,
    child: Mutex<Option<Child>>,
    player: Arc<crate::audio::AudioPlayer>,
}

impl Tts {
    pub fn new(player: Arc<crate::audio::AudioPlayer>) -> Self {
        Self {
            generation: AtomicU64::new(0),
            child: Mutex::new(None),
            player,
        }
    }

    pub fn cancel(&self) {
        self.generation.fetch_add(1, Ordering::SeqCst);
        self.kill_child();
        self.player.stop_speech();
    }

    fn stale(&self, generation: u64) -> bool {
        self.generation.load(Ordering::SeqCst) != generation
    }

    pub async fn speak(self: Arc<Self>, lines: Vec<TtsLine>) -> Result<(), String> {
        let generation = self.generation.load(Ordering::SeqCst);
        let key = tauri::async_runtime::spawn_blocking(|| crate::secrets::get_secret(ZHIPU_SECRET))
            .await
            .ok()
            .and_then(|result| result.ok())
            .flatten()
            .filter(|key| !key.trim().is_empty());
        if key.is_none() {
            eprintln!("[lyra:tts] no zhipu key, using say");
        }
        let client = reqwest::Client::builder()
            .timeout(Duration::from_secs(20))
            .build()
            .map_err(|err| format!("tts client: {err}"))?;

        let queue: Vec<(&'static str, String)> = lines
            .into_iter()
            .filter_map(|line| {
                let text = line.text.trim().to_string();
                if text.is_empty() {
                    None
                } else {
                    Some((glm_voice(line.voice.trim()), text))
                }
            })
            .collect();
        // Every line starts synthesizing together. Each finished clip is
        // appended to one sink, so the next sentence does not wait for a
        // new player to start.
        let mut speech_end = std::time::Instant::now();
        let jobs: Vec<_> = queue
            .iter()
            .map(|(voice, text)| {
                let key = key.clone()?;
                let client = client.clone();
                let voice = *voice;
                let text = text.clone();
                Some(tauri::async_runtime::spawn(async move {
                    glm_wav(&client, &key, voice, &text).await
                }))
            })
            .collect();

        for (index, job) in jobs.into_iter().enumerate() {
            if self.stale(generation) {
                self.player.stop_speech();
                return Ok(());
            }
            let (voice, text) = &queue[index];
            let audio = match job {
                Some(handle) => handle
                    .await
                    .map_err(|err| format!("glm join {err}"))
                    .and_then(|result| result),
                None => Err("no zhipu key".into()),
            };
            if self.stale(generation) {
                self.player.stop_speech();
                return Ok(());
            }
            match audio {
                Ok(bytes) => {
                    let bytes = trim_edge_silence(&bytes);
                    let duration = wav_duration(bytes.len(), &bytes);
                    if let Err(err) = self.player.enqueue_speech(&bytes) {
                        eprintln!("[lyra:tts] queue failed, keeping her voice by skipping: {err}");
                    } else {
                        let now = std::time::Instant::now();
                        if now > speech_end {
                            speech_end = now;
                        }
                        speech_end += duration;
                    }
                }
                Err(err) => {
                    if err == "no zhipu key" {
                        self.wait_speech(generation, speech_end).await;
                        self.say_fallback(generation, voice, text).await?;
                    } else {
                        // Keep 锤锤. A system voice in the middle of her line
                        // is worse than skipping one sentence.
                        eprintln!("[lyra:tts] glm failed, keeping her voice by skipping: {err}");
                    }
                }
            }
        }
        self.wait_speech(generation, speech_end).await;
        Ok(())
    }

    async fn wait_speech(self: &Arc<Self>, generation: u64, speech_end: std::time::Instant) {
        let this = Arc::clone(self);
        let _ = tauri::async_runtime::spawn_blocking(move || {
            let deadline = speech_end + Duration::from_millis(200);
            while this.player.speech_busy() {
                if this.stale(generation) || std::time::Instant::now() >= deadline {
                    if this.stale(generation) {
                        this.player.stop_speech();
                    }
                    return;
                }
                thread::sleep(Duration::from_millis(20));
            }
        })
        .await;
    }

    async fn say_fallback(
        self: &Arc<Self>,
        generation: u64,
        voice: &str,
        text: &str,
    ) -> Result<(), String> {
        if self.stale(generation) {
            return Ok(());
        }
        let say = say_voice(voice);
        let text = text.to_string();
        let this = Arc::clone(self);
        tauri::async_runtime::spawn_blocking(move || this.say(generation, say, &text))
            .await
            .map_err(|err| err.to_string())?
    }

    fn say(&self, generation: u64, voice: &str, text: &str) -> Result<(), String> {
        let path = temp_audio("aiff");
        let spawned = Command::new("say")
            .arg("-v")
            .arg(voice)
            .arg("-o")
            .arg(&path)
            .arg(text)
            .stdin(Stdio::null())
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .spawn()
            .map_err(|err| format!("say: {err}"));
        let said = match spawned {
            Ok(child) => self.run_child(generation, child),
            Err(err) => Err(err),
        };
        if self.stale(generation) {
            let _ = std::fs::remove_file(&path);
            return Ok(());
        }
        if let Err(err) = said {
            let _ = std::fs::remove_file(&path);
            return Err(err);
        }
        let played = self.play_path(generation, &path);
        let _ = std::fs::remove_file(&path);
        played
    }

    fn play_path(&self, generation: u64, path: &std::path::Path) -> Result<(), String> {
        let gain = afplay_gain(self.player.get_volume());
        let spawned = Command::new("afplay")
            .arg("-v")
            .arg(format!("{gain:.3}"))
            .arg(path)
            .stdin(Stdio::null())
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .spawn()
            .map_err(|err| format!("afplay: {err}"));
        match spawned {
            Ok(child) => self.run_child(generation, child),
            Err(err) => Err(err),
        }
    }

    fn run_child(&self, generation: u64, mut child: Child) -> Result<(), String> {
        {
            let mut guard = self.child.lock().unwrap();
            if self.stale(generation) {
                let _ = child.kill();
                let _ = child.wait();
                return Ok(());
            }
            *guard = Some(child);
        }
        loop {
            if self.stale(generation) {
                self.kill_child();
                return Ok(());
            }
            let mut guard = self.child.lock().unwrap();
            let Some(child) = guard.as_mut() else {
                return Ok(());
            };
            match child.try_wait() {
                Ok(Some(status)) => {
                    *guard = None;
                    if status.success() || self.stale(generation) {
                        return Ok(());
                    }
                    return Err(format!("player exited {status}"));
                }
                Ok(None) => {
                    drop(guard);
                    thread::sleep(Duration::from_millis(40));
                }
                Err(err) => {
                    *guard = None;
                    return Err(err.to_string());
                }
            }
        }
    }

    fn kill_child(&self) {
        let mut guard = self.child.lock().unwrap();
        if let Some(mut child) = guard.take() {
            let _ = child.kill();
            let _ = child.wait();
        }
    }
}

fn glm_voice(voice: &str) -> &'static str {
    match voice {
        "xiaochen" => "xiaochen",
        "chuichui" => "chuichui",
        "jam" => "jam",
        "kazi" => "kazi",
        "douji" => "douji",
        "luodo" => "luodo",
        _ => "tongtong",
    }
}

fn say_voice(voice: &str) -> &'static str {
    match voice {
        "xiaochen" => "Reed (中文（中国大陆）)",
        _ => "Tingting",
    }
}

/// `afplay -v` accepts 0..=1. Song volume uses the same number up to 1,
/// and anything above that (the player allows 1.5) stays at full speech gain.
fn afplay_gain(song_volume: f32) -> f32 {
    song_volume.clamp(0.0, 1.0)
}

fn temp_audio(ext: &str) -> std::path::PathBuf {
    static NEXT: AtomicU64 = AtomicU64::new(0);
    std::env::temp_dir().join(format!(
        "lyra-tts-{}-{}.{}",
        std::process::id(),
        NEXT.fetch_add(1, Ordering::Relaxed),
        ext
    ))
}

fn retryable(status: u16) -> bool {
    status == 0 || status == 408 || status == 429 || (500..600).contains(&status)
}

async fn glm_wav(
    client: &reqwest::Client,
    key: &str,
    voice: &str,
    text: &str,
) -> Result<Vec<u8>, String> {
    let mut omit_watermark = false;
    let mut last = String::from("glm failed");
    for attempt in 0..3 {
        if attempt > 0 {
            tokio::time::sleep(Duration::from_millis(300 * attempt as u64)).await;
        }
        match post_wav(client, key, voice, text, omit_watermark).await {
            Ok(bytes) => return Ok(bytes),
            Err((400, message)) if !omit_watermark => {
                eprintln!("[lyra:tts] retry without watermark: {message}");
                omit_watermark = true;
            }
            Err((status, message)) if retryable(status) => {
                last = format!("glm {status} {message}");
                eprintln!("[lyra:tts] transient, retry {}: {last}", attempt + 1);
            }
            Err((status, message)) => return Err(format!("glm {status} {message}")),
        }
    }
    Err(last)
}

async fn post_wav(
    client: &reqwest::Client,
    key: &str,
    voice: &str,
    text: &str,
    omit_watermark: bool,
) -> Result<Vec<u8>, (u16, String)> {
    let mut body = serde_json::json!({
        "model": "glm-tts",
        "input": text,
        "voice": voice,
        "response_format": "wav",
        "speed": 1.0,
        "volume": 3.0,
    });
    if !omit_watermark {
        body["watermark"] = serde_json::json!(false);
    }
    let res = client
        .post(GLM_URL)
        .bearer_auth(key)
        .json(&body)
        .send()
        .await
        .map_err(|err| (0, err.to_string()))?;
    let status = res.status().as_u16();
    let bytes = res.bytes().await.map_err(|err| (status, err.to_string()))?;
    if !(200..300).contains(&status) {
        return Err((status, snippet(&bytes)));
    }
    if bytes.len() < 12 || &bytes[..4] != b"RIFF" {
        return Err((status, format!("not wav: {}", snippet(&bytes))));
    }
    Ok(bytes.to_vec())
}

fn wav_duration(fallback_len: usize, wav: &[u8]) -> Duration {
    if let Some((sample_rate, channels, data)) = wav_pcm16(wav) {
        let frame = channels as u64 * 2;
        if frame > 0 && sample_rate > 0 {
            return Duration::from_millis(data.len() as u64 * 1000 / (frame * sample_rate as u64));
        }
    }
    // Unknown layout: assume 24 kHz mono 16-bit, which is what GLM-TTS returns.
    let samples = fallback_len.saturating_sub(44) / 2;
    Duration::from_millis(samples as u64 * 1000 / 24_000)
}

fn snippet(bytes: &[u8]) -> String {
    String::from_utf8_lossy(bytes).chars().take(180).collect()
}

/// Drops near-silence at both ends so the next host is not waiting on padding.
fn trim_edge_silence(wav: &[u8]) -> Vec<u8> {
    let Some((sample_rate, channels, data)) = wav_pcm16(wav) else {
        return wav.to_vec();
    };
    let frame = channels as usize * 2;
    if frame == 0 || data.len() < frame {
        return wav.to_vec();
    }
    let frames = data.len() / frame;
    let mut first = None;
    let mut last = 0usize;
    for index in 0..frames {
        let base = index * frame;
        let loud = (0..channels as usize).any(|channel| {
            let sample = i16::from_le_bytes([data[base + channel * 2], data[base + channel * 2 + 1]]);
            sample.unsigned_abs() > 2500
        });
        if loud {
            if first.is_none() {
                first = Some(index);
            }
            last = index;
        }
    }
    let Some(first) = first else {
        return wav.to_vec();
    };
    let pad = (sample_rate as usize * 8) / 1000;
    let start = first.saturating_sub(pad);
    let end = (last + 1 + pad).min(frames);
    if start == 0 && end == frames {
        return wav.to_vec();
    }
    pcm16_wav(sample_rate, channels, &data[start * frame..end * frame])
}

fn wav_pcm16(wav: &[u8]) -> Option<(u32, u16, &[u8])> {
    if wav.len() < 44 || &wav[..4] != b"RIFF" || &wav[8..12] != b"WAVE" {
        return None;
    }
    let mut offset = 12usize;
    let mut audio_format = 1u16;
    let mut channels = 1u16;
    let mut sample_rate = 24_000u32;
    let mut bits = 16u16;
    let mut data = None;
    while offset + 8 <= wav.len() {
        let id = &wav[offset..offset + 4];
        let size = u32::from_le_bytes(wav[offset + 4..offset + 8].try_into().ok()?) as usize;
        let start = offset + 8;
        if start + size > wav.len() {
            break;
        }
        if id == b"fmt " && size >= 16 {
            audio_format = u16::from_le_bytes([wav[start], wav[start + 1]]);
            channels = u16::from_le_bytes([wav[start + 2], wav[start + 3]]);
            sample_rate = u32::from_le_bytes(wav[start + 4..start + 8].try_into().ok()?);
            bits = u16::from_le_bytes([wav[start + 14], wav[start + 15]]);
        } else if id == b"data" {
            data = Some(&wav[start..start + size]);
        }
        offset = start + size + (size % 2);
    }
    if audio_format != 1 || bits != 16 || channels == 0 {
        return None;
    }
    Some((sample_rate, channels, data?))
}

fn pcm16_wav(sample_rate: u32, channels: u16, data: &[u8]) -> Vec<u8> {
    let block = channels as u32 * 2;
    let mut out = Vec::with_capacity(44 + data.len());
    out.extend(b"RIFF");
    out.extend((36 + data.len() as u32).to_le_bytes());
    out.extend(b"WAVE");
    out.extend(b"fmt ");
    out.extend(16u32.to_le_bytes());
    out.extend(1u16.to_le_bytes());
    out.extend(channels.to_le_bytes());
    out.extend(sample_rate.to_le_bytes());
    out.extend((sample_rate * block).to_le_bytes());
    out.extend((block as u16).to_le_bytes());
    out.extend(16u16.to_le_bytes());
    out.extend(b"data");
    out.extend((data.len() as u32).to_le_bytes());
    out.extend(data);
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_dropped_request_is_retried_and_a_bad_voice_is_not() {
        assert!(retryable(0));
        assert!(retryable(429));
        assert!(retryable(503));
        assert!(!retryable(400));
        assert!(!retryable(401));
    }

    #[test]
    fn lyra_is_chuichui_and_the_guest_is_xiaochen() {
        assert_eq!(glm_voice("chuichui"), "chuichui");
        assert_eq!(glm_voice("xiaochen"), "xiaochen");
        assert_eq!(glm_voice("tongtong"), "tongtong");
        assert_eq!(say_voice("chuichui"), "Tingting");
        assert_eq!(say_voice("xiaochen"), "Reed (中文（中国大陆）)");
    }

    #[test]
    fn speech_uses_the_song_volume() {
        assert_eq!(afplay_gain(1.0), 1.0);
        assert_eq!(afplay_gain(0.7), 0.7);
        assert_eq!(afplay_gain(1.5), 1.0);
        assert_eq!(afplay_gain(-1.0), 0.0);
    }

    #[test]
    fn drops_silence_around_the_spoken_samples() {
        let mut samples = vec![0i16; 200];
        samples.extend(std::iter::repeat(8_000).take(20));
        samples.extend(std::iter::repeat(0).take(200));
        let wav = pcm16_wav(1_000, 1, &samples.iter().flat_map(|sample| sample.to_le_bytes()).collect::<Vec<_>>());
        let trimmed = trim_edge_silence(&wav);
        assert!(trimmed.len() < wav.len());
        assert!(trimmed.windows(2).any(|pair| i16::from_le_bytes([pair[0], pair[1]]) == 8_000));
    }
}
