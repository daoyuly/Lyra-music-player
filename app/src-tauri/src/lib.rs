pub mod audio;
pub mod audio_features;
pub mod data_export;
pub mod dynamic_volume;
pub mod library_scan;
pub mod lyrics;
pub mod secrets;
pub mod tray;
pub mod weekly;

use std::sync::Arc;
use tauri::{Emitter, Manager, State, WindowEvent};
use tauri_plugin_sql::{Migration, MigrationKind};
use tray::{TrayController, TrayState};

pub struct AppState {
    pub audio: Arc<audio::AudioPlayer>,
    pub dynamic_volume: Arc<dynamic_volume::DynamicVolumeController>,
}

#[tauri::command]
async fn audio_play(
    state: State<'_, AppState>,
    app: tauri::AppHandle,
    path: String,
    duration_ms: Option<u64>,
) -> Result<u64, String> {
    let app_for_emit = app.clone();
    state
        .audio
        .play_file(std::path::Path::new(&path), duration_ms, move |id| {
            // Emit to the frontend so the Orchestrator can advance to the
            // next turn. If the app is shutting down and the emit fails,
            // there's nothing meaningful to do — just drop it.
            let _ = app_for_emit.emit("audio-complete", id);
        })
        .map_err(|e| e.to_string())
}

#[tauri::command]
async fn audio_stop(state: State<'_, AppState>) -> Result<(), String> {
    state.audio.stop();
    Ok(())
}

#[tauri::command]
async fn audio_is_playing(state: State<'_, AppState>) -> Result<bool, String> {
    Ok(state.audio.is_playing())
}

#[tauri::command]
async fn audio_pause(state: State<'_, AppState>) -> Result<(), String> {
    state.audio.pause();
    Ok(())
}

#[tauri::command]
async fn audio_resume(state: State<'_, AppState>) -> Result<(), String> {
    state.audio.resume();
    Ok(())
}

#[tauri::command]
async fn audio_is_paused(state: State<'_, AppState>) -> Result<bool, String> {
    Ok(state.audio.is_paused())
}

#[tauri::command]
async fn audio_set_volume(state: State<'_, AppState>, volume: f32) -> Result<(), String> {
    state.audio.set_volume(volume);
    Ok(())
}

/// 打开动态音量。首次调用会请求 macOS 辅助功能权限;权限未给时监听线程静默退出,
/// 音量保持 1.0(相当于无操作)。用户后续在系统设置里授权后需要重启 Lyra。
#[tauri::command]
async fn dynamic_volume_enable(state: State<'_, AppState>) -> Result<(), String> {
    let audio = state.audio.clone();
    state.dynamic_volume.enable(move |mult| {
        audio.set_volume(mult);
    });
    Ok(())
}

#[tauri::command]
async fn dynamic_volume_disable(state: State<'_, AppState>) -> Result<(), String> {
    state.dynamic_volume.disable();
    Ok(())
}

#[tauri::command]
async fn secret_set(key: String, value: String) -> Result<(), String> {
    secrets::set_secret(&key, &value).map_err(|e| e.to_string())
}

#[tauri::command]
async fn secret_get(key: String) -> Result<Option<String>, String> {
    secrets::get_secret(&key).map_err(|e| e.to_string())
}

#[tauri::command]
async fn secret_delete(key: String) -> Result<(), String> {
    secrets::delete_secret(&key).map_err(|e| e.to_string())
}

#[tauri::command]
async fn library_scan(path: String) -> Result<Vec<library_scan::ScannedTrack>, String> {
    library_scan::scan_directory(std::path::Path::new(&path)).map_err(|e| e.to_string())
}

#[tauri::command]
async fn app_data_dir(app_handle: tauri::AppHandle) -> Result<String, String> {
    app_handle
        .path()
        .app_data_dir()
        .map(|p| p.to_string_lossy().to_string())
        .map_err(|e| e.to_string())
}

#[tauri::command]
async fn memory_file_read(app: tauri::AppHandle) -> Result<String, String> {
    let dir = app.path().app_data_dir().map_err(|e| e.to_string())?;
    let path = dir.join("memory.md");
    match tokio::fs::read_to_string(&path).await {
        Ok(s) => Ok(s),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(String::new()),
        Err(e) => Err(e.to_string()),
    }
}

#[tauri::command]
async fn memory_file_write(app: tauri::AppHandle, content: String) -> Result<(), String> {
    let dir = app.path().app_data_dir().map_err(|e| e.to_string())?;
    tokio::fs::create_dir_all(&dir).await.map_err(|e| e.to_string())?;
    let path = dir.join("memory.md");
    tokio::fs::write(&path, content).await.map_err(|e| e.to_string())
}

/// Returns true if `<app_data_dir>/PANIC` exists.
/// When present, EngineerAgent.runDailyLoop() short-circuits immediately —
/// no LLM call, no roadmap insertions.
#[tauri::command]
async fn check_panic_file(app: tauri::AppHandle) -> Result<bool, String> {
    let dir = app.path().app_data_dir().map_err(|e| e.to_string())?;
    let panic_path = dir.join("PANIC");
    Ok(panic_path.exists())
}

/// Bridge frontend diagnostics into the `tauri dev` terminal.
/// WebView `console.*` stays in DevTools; this prints to Rust stderr so
/// turn/provider failures are greppable from the shell that launched Lyra.
#[tauri::command]
fn frontend_log(level: String, scope: String, message: String) -> Result<(), String> {
    match level.as_str() {
        "warn" => eprintln!("[lyra:{scope}] {message}"),
        "info" => eprintln!("[lyra:{scope}] {message}"),
        _ => eprintln!("[lyra:{scope}] {message}"),
    }
    Ok(())
}

#[derive(serde::Serialize)]
struct HttpFetchResponse {
    status: u16,
    body: String,
}

/// Outbound HTTP from Rust — bypasses WKWebView `fetch` / CSP / CORS quirks
/// that surface as the opaque TypeError "Load failed" in the UI.
#[tauri::command]
async fn http_fetch(
    method: String,
    url: String,
    headers: std::collections::HashMap<String, String>,
    body: Option<String>,
) -> Result<HttpFetchResponse, String> {
    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(120))
        .build()
        .map_err(|e| format!("http_fetch client: {e}"))?;

    let mut req = match method.to_uppercase().as_str() {
        "GET" => client.get(&url),
        "POST" => client.post(&url),
        "PUT" => client.put(&url),
        "DELETE" => client.delete(&url),
        "PATCH" => client.patch(&url),
        other => return Err(format!("http_fetch unsupported method: {other}")),
    };

    for (k, v) in headers {
        req = req.header(k, v);
    }
    if let Some(b) = body {
        req = req.body(b);
    }

    let res = req.send().await.map_err(|e| {
        eprintln!("[lyra:http_fetch] request error url={url}: {e}");
        format!("http_fetch network error: {e}")
    })?;

    let status = res.status().as_u16();
    let body = res.text().await.map_err(|e| format!("http_fetch body: {e}"))?;
    if status >= 400 {
        eprintln!(
            "[lyra:http_fetch] HTTP {status} url={url} body={}",
            body.chars().take(300).collect::<String>()
        );
    }
    Ok(HttpFetchResponse { status, body })
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_notification::init())
        .plugin(
            tauri_plugin_sql::Builder::default()
                .add_migrations(
                    "sqlite:lyra.db",
                    vec![
                        Migration {
                            version: 1,
                            description: "initial schema",
                            sql: include_str!("../migrations/001_initial.sql"),
                            kind: MigrationKind::Up,
                        },
                        Migration {
                            version: 2,
                            description: "perception audit table",
                            sql: include_str!("../migrations/002_perception_audit.sql"),
                            kind: MigrationKind::Up,
                        },
                        Migration {
                            version: 3,
                            description: "soul perception_tuning column",
                            sql: include_str!("../migrations/003_soul_perception_tuning.sql"),
                            kind: MigrationKind::Up,
                        },
                        Migration {
                            version: 4,
                            description: "lyrics embeddings table",
                            sql: include_str!("../migrations/004_lyrics_embeddings.sql"),
                            kind: MigrationKind::Up,
                        },
                        Migration {
                            version: 5,
                            description: "llm usage log",
                            sql: include_str!("../migrations/005_llm_usage.sql"),
                            kind: MigrationKind::Up,
                        },
                        Migration {
                            version: 6,
                            description: "reasoning traces + latency columns",
                            sql: include_str!("../migrations/006_reasoning_traces.sql"),
                            kind: MigrationKind::Up,
                        },
                        Migration {
                            version: 7,
                            description: "weekly_snapshots table",
                            sql: include_str!("../migrations/007_weekly_snapshots.sql"),
                            kind: MigrationKind::Up,
                        },
                        Migration {
                            version: 8,
                            description: "shift_feedback table",
                            sql: include_str!("../migrations/008_shift_feedback.sql"),
                            kind: MigrationKind::Up,
                        },
                        Migration {
                            version: 9,
                            description: "agent_runs + llm_usage agent_kind (Phase 4)",
                            sql: include_str!("../migrations/009_agent_runs.sql"),
                            kind: MigrationKind::Up,
                        },
                        Migration {
                            version: 10,
                            description: "product analytics events (Iter Phase 0.1)",
                            sql: include_str!("../migrations/010_product_events.sql"),
                            kind: MigrationKind::Up,
                        },
                        Migration {
                            version: 11,
                            description: "active_intent sticky listening intent",
                            sql: include_str!("../migrations/011_active_intent.sql"),
                            kind: MigrationKind::Up,
                        },
                        Migration {
                            version: 12,
                            description: "DJ agent library_track_profiles",
                            sql: include_str!("../migrations/012_track_profiles.sql"),
                            kind: MigrationKind::Up,
                        },
                    ],
                )
                .build(),
        )
        .setup(|app| {
            let player = audio::AudioPlayer::new().expect("audio init");
            app.manage(AppState {
                audio: Arc::new(player),
                dynamic_volume: Arc::new(dynamic_volume::DynamicVolumeController::new()),
            });
            let tray_ctrl = TrayController::new(&app.handle()).expect("tray init");
            app.manage(TrayState(tray_ctrl));
            Ok(())
        })
        // Keep the app alive when the user closes the window — the tray
        // icon remains, and the DreamScheduler keeps ticking so scheduled
        // reflect/weekly runs still happen. Clicking the tray icon re-shows
        // the window. Full quit is done from the OS menu / Cmd+Q.
        .on_window_event(|window, event| {
            if let WindowEvent::CloseRequested { api, .. } = event {
                api.prevent_close();
                let _ = window.hide();
            }
        })
        .invoke_handler(tauri::generate_handler![
            audio_play,
            audio_stop,
            audio_is_playing,
            audio_pause,
            audio_resume,
            audio_is_paused,
            audio_set_volume,
            dynamic_volume_enable,
            dynamic_volume_disable,
            secret_set,
            secret_get,
            secret_delete,
            library_scan,
            app_data_dir,
            memory_file_read,
            memory_file_write,
            check_panic_file,
            frontend_log,
            http_fetch,
            tray::tray_set_breathing,
            audio_features::audio_extract_features,
            lyrics::lyrics_extract,
            weekly::write_weekly_html,
            weekly::open_weekly_html,
            weekly::path_exists,
            weekly::read_weekly_html,
            data_export::data_export,
            data_export::data_wipe,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
