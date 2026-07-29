pub mod audio;
pub mod audio_features;
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

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
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
                    ],
                )
                .build(),
        )
        .setup(|app| {
            let player = audio::AudioPlayer::new().expect("audio init");
            app.manage(AppState {
                audio: Arc::new(player),
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
            secret_set,
            secret_get,
            secret_delete,
            library_scan,
            app_data_dir,
            memory_file_read,
            memory_file_write,
            check_panic_file,
            tray::tray_set_breathing,
            audio_features::audio_extract_features,
            lyrics::lyrics_extract,
            weekly::write_weekly_html,
            weekly::open_weekly_html,
            weekly::path_exists,
            weekly::read_weekly_html,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
