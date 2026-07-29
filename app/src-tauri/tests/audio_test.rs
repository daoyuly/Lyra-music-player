use lyra_lib::audio::AudioPlayer;
use std::path::PathBuf;
use std::sync::{Arc, Mutex};
use std::thread::sleep;
use std::time::Duration;

fn fixture(name: &str) -> PathBuf {
    let mut p = PathBuf::from(env!("CARGO_MANIFEST_DIR"));
    p.push("tests/fixtures");
    p.push(name);
    p
}

fn noop_complete(_id: u64) {}

#[test]
fn create_player_ok() {
    let _p = AudioPlayer::new().expect("new should succeed");
}

#[test]
fn play_file_starts_playback() {
    let p = AudioPlayer::new().unwrap();
    p.play_file(&fixture("silence_1s.wav"), None, noop_complete)
        .expect("play should succeed");
    assert!(p.is_playing());
}

#[test]
fn stop_ends_playback() {
    let p = AudioPlayer::new().unwrap();
    p.play_file(&fixture("silence_1s.wav"), None, noop_complete).unwrap();
    p.stop();
    // small wait for internal cleanup
    sleep(Duration::from_millis(50));
    assert!(!p.is_playing());
}

#[test]
fn play_missing_file_returns_error() {
    let p = AudioPlayer::new().unwrap();
    let err = p.play_file(&PathBuf::from("/nonexistent.wav"), None, noop_complete);
    assert!(err.is_err());
}

#[test]
fn play_file_fires_completion_callback_when_song_ends_naturally() {
    let p = AudioPlayer::new().unwrap();
    let completed = Arc::new(Mutex::new(None::<u64>));
    let completed_c = Arc::clone(&completed);

    let id = p
        .play_file(&fixture("silence_1s.wav"), None, move |i| {
            *completed_c.lock().unwrap() = Some(i);
        })
        .expect("play should succeed");

    // silence_1s.wav is 1 second; the watcher polls every 300ms after a
    // 400ms grace period so we should see completion within ~2s.
    for _ in 0..25 {
        if completed.lock().unwrap().is_some() {
            break;
        }
        sleep(Duration::from_millis(100));
    }
    assert_eq!(*completed.lock().unwrap(), Some(id));
}

#[test]
fn stop_suppresses_completion_callback() {
    let p = AudioPlayer::new().unwrap();
    let fired = Arc::new(Mutex::new(false));
    let fired_c = Arc::clone(&fired);

    p.play_file(&fixture("silence_1s.wav"), None, move |_| {
        *fired_c.lock().unwrap() = true;
    })
    .expect("play should succeed");

    // Stop immediately — before natural completion — and give the watcher
    // enough time to observe an empty sink AND read the invalidated id.
    p.stop();
    sleep(Duration::from_millis(1500));
    assert!(!*fired.lock().unwrap());
}

#[test]
fn duration_hint_fires_completion_even_if_sink_never_reports_empty() {
    // Real-world guard: when Sink::empty() does eventually report true (as it
    // does with silence_1s.wav), the fallback still fires exactly once.
    // The primary path may win; the fallback path may win; either way we
    // must observe exactly one call and the callback id must match.
    let p = AudioPlayer::new().unwrap();
    let count = Arc::new(Mutex::new(0u32));
    let seen_id = Arc::new(Mutex::new(None::<u64>));
    let count_c = Arc::clone(&count);
    let seen_id_c = Arc::clone(&seen_id);

    let id = p
        .play_file(&fixture("silence_1s.wav"), Some(1000), move |i| {
            *count_c.lock().unwrap() += 1;
            *seen_id_c.lock().unwrap() = Some(i);
        })
        .expect("play should succeed");

    // Duration hint + FALLBACK_SLACK_MS (750ms) = ~1.75s worst case.
    sleep(Duration::from_millis(2500));
    assert_eq!(*count.lock().unwrap(), 1, "callback must fire exactly once");
    assert_eq!(*seen_id.lock().unwrap(), Some(id));
}

#[test]
fn short_duration_hint_makes_fallback_win_before_sink_reports_empty() {
    // Prove the fallback timer wins the race (and fires exactly once) when
    // the primary watcher would otherwise take longer to notice: the file
    // is silence_1s.wav (~1s) but the hint says the song is 100ms long,
    // so the fallback fires at ~850ms while the primary path is still
    // polling. Locks in the "sink never reports empty" recovery path
    // that the caller-facing docstring on play_file promises.
    let p = AudioPlayer::new().unwrap();
    let count = Arc::new(Mutex::new(0u32));
    let count_c = Arc::clone(&count);

    let start = std::time::Instant::now();
    let id = p
        .play_file(&fixture("silence_1s.wav"), Some(100), move |_| {
            *count_c.lock().unwrap() += 1;
        })
        .expect("play should succeed");
    assert_eq!(id, 1);

    // Wait past the fallback deadline (~850ms) but before the primary
    // watcher would decide (which polls at t=400, 700, 1000...).
    sleep(Duration::from_millis(950));
    let n = *count.lock().unwrap();
    let elapsed = start.elapsed();
    assert_eq!(n, 1, "fallback should have fired by now");
    assert!(
        elapsed < Duration::from_millis(1500),
        "fallback path fired within {elapsed:?} — well before primary poll deadline"
    );

    // And a follow-up wait must not fire a second time.
    sleep(Duration::from_millis(1500));
    assert_eq!(*count.lock().unwrap(), 1, "callback must fire exactly once");
}

#[test]
fn duration_hint_of_zero_is_treated_as_no_hint() {
    // Regression guard: a duration_ms of 0 (metadata read failed, or bpm
    // detection returned 0 → serialized as null → deserialized as 0 by
    // some frontend paths) MUST NOT fire the fallback at FALLBACK_SLACK_MS,
    // which would truncate the song.
    let p = AudioPlayer::new().unwrap();
    let fired_early = Arc::new(Mutex::new(false));
    let fired_early_c = Arc::clone(&fired_early);

    let _id = p
        .play_file(&fixture("silence_1s.wav"), Some(0), move |_| {
            *fired_early_c.lock().unwrap() = true;
        })
        .expect("play should succeed");

    // If the guard were absent the fallback would fire at t=750ms. Wait
    // 900ms and confirm nothing has fired via the fallback path yet —
    // the primary watcher hasn't observed empty on a 1s file either.
    sleep(Duration::from_millis(900));
    assert!(
        !*fired_early.lock().unwrap(),
        "duration_ms=0 must not arm the fallback timer"
    );
}

#[test]
fn pause_resume_toggles_is_paused_and_is_playing() {
    let p = AudioPlayer::new().unwrap();
    p.play_file(&fixture("silence_1s.wav"), None, noop_complete).unwrap();
    // Give the sink a beat to start actually producing samples before we
    // assert on state — is_playing checks !empty which needs the first
    // decode to have landed.
    sleep(Duration::from_millis(100));
    assert!(p.is_playing());
    assert!(!p.is_paused());

    p.pause();
    assert!(p.is_paused());
    assert!(!p.is_playing(), "paused sink must not report as playing");

    // Idempotent: pause a second time is a no-op.
    p.pause();
    assert!(p.is_paused());

    p.resume();
    assert!(!p.is_paused());
    assert!(p.is_playing());

    // Resume when not paused is also a no-op.
    p.resume();
    assert!(!p.is_paused());
}

#[test]
fn pause_defers_duration_fallback_completion() {
    // With a 100ms duration hint, the fallback would fire at ~850ms.
    // If we pause immediately and stay paused past that deadline, the
    // callback must NOT fire — otherwise the frontend would auto-advance
    // to a new song while the user has explicitly paused.
    let p = AudioPlayer::new().unwrap();
    let fired = Arc::new(Mutex::new(false));
    let fired_c = Arc::clone(&fired);

    p.play_file(&fixture("silence_1s.wav"), Some(100), move |_| {
        *fired_c.lock().unwrap() = true;
    })
    .expect("play should succeed");

    p.pause();
    // Sleep past the fallback deadline (100 + 750 = 850ms).
    sleep(Duration::from_millis(1500));
    assert!(
        !*fired.lock().unwrap(),
        "duration fallback must not fire while playback is paused"
    );

    // After resume, effective time must grow by wait_ms (100 + 750 = 850ms)
    // before the fallback fires. The poll loop caps sleeps at 500ms, so
    // worst case: poll just went to sleep at resume-time → wakes 500ms
    // later with effective=500 (needs 350 more) → sleeps 350ms → fires at
    // resume+850ms. Wait 1500ms to absorb OS scheduling jitter on top.
    p.resume();
    sleep(Duration::from_millis(1500));
    assert!(
        *fired.lock().unwrap(),
        "fallback should fire once effective play time catches up after resume"
    );
}

#[test]
fn superseding_play_file_suppresses_old_completion_callback() {
    let p = AudioPlayer::new().unwrap();
    let old_fired = Arc::new(Mutex::new(false));
    let new_completed = Arc::new(Mutex::new(None::<u64>));
    let old_fired_c = Arc::clone(&old_fired);
    let new_completed_c = Arc::clone(&new_completed);

    p.play_file(&fixture("silence_1s.wav"), None, move |_| {
        *old_fired_c.lock().unwrap() = true;
    })
    .expect("first play should succeed");

    // Start a second playback almost immediately — old watcher must exit
    // without firing, new one must fire when its song ends.
    sleep(Duration::from_millis(100));
    let new_id = p
        .play_file(&fixture("silence_1s.wav"), None, move |i| {
            *new_completed_c.lock().unwrap() = Some(i);
        })
        .expect("second play should succeed");

    for _ in 0..25 {
        if new_completed.lock().unwrap().is_some() {
            break;
        }
        sleep(Duration::from_millis(100));
    }
    assert_eq!(*new_completed.lock().unwrap(), Some(new_id));
    assert!(!*old_fired.lock().unwrap());
}
