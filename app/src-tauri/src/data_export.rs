/// data_export.rs — Tauri commands for bulk data export and wipe.
///
/// data_export: opens lyra.db with sqlx (already a transitive dep via
///              tauri-plugin-sql), dumps all user tables to a JSON file at the
///              path chosen by the frontend's native save dialog.
///
/// data_wipe:   deletes lyra.db so the next startup re-runs all migrations and
///              produces clean empty tables.
use serde_json::{json, Value};
use sqlx::sqlite::SqliteConnectOptions;
use sqlx::{Column, Row, SqlitePool, TypeInfo};
use std::str::FromStr;
use tauri::Manager;

/// Tables exported. `product_events` is included; if the table doesn't exist
/// yet (Phase 0.1 migration not yet run) we silently skip it with an empty
/// array so the export never crashes.
const EXPORT_TABLES: &[&str] = &[
    "dialogue_turns",
    "shared_memory",
    "soul_state",
    "agent_runs",
    "product_events",
];

async fn open_pool(app: &tauri::AppHandle) -> Result<SqlitePool, String> {
    let db_path = app
        .path()
        .app_data_dir()
        .map_err(|e| e.to_string())?
        .join("lyra.db");

    let opts = SqliteConnectOptions::from_str(&format!(
        "sqlite://{}",
        db_path.to_string_lossy()
    ))
    .map_err(|e| e.to_string())?
    .read_only(true);

    SqlitePool::connect_with(opts)
        .await
        .map_err(|e| e.to_string())
}

async fn dump_table(pool: &SqlitePool, table: &str) -> Result<Vec<Value>, String> {
    // Use a raw query; table names are from a compile-time constant so no
    // injection risk.
    let rows = sqlx::query(&format!("SELECT * FROM \"{table}\""))
        .fetch_all(pool)
        .await
        .map_err(|e| format!("query {table}: {e}"))?;

    let mut out = Vec::with_capacity(rows.len());
    for row in rows {
        let mut obj = serde_json::Map::new();
        for col in row.columns() {
            let name = col.name().to_owned();
            // sqlx-sqlite stores everything as one of: integer, real, text, blob, null.
            let val: Value = if col.type_info().name() == "INTEGER" {
                row.try_get::<i64, _>(col.ordinal())
                    .map(|n| json!(n))
                    .unwrap_or(Value::Null)
            } else if col.type_info().name() == "REAL" {
                row.try_get::<f64, _>(col.ordinal())
                    .map(|f| json!(f))
                    .unwrap_or(Value::Null)
            } else if col.type_info().name() == "BLOB" {
                row.try_get::<Vec<u8>, _>(col.ordinal())
                    .map(|b| json!(b))
                    .unwrap_or(Value::Null)
            } else {
                // TEXT or NULL — try text first, fall back to null.
                row.try_get::<String, _>(col.ordinal())
                    .map(|s| json!(s))
                    .unwrap_or(Value::Null)
            };
            obj.insert(name, val);
        }
        out.push(Value::Object(obj));
    }
    Ok(out)
}

/// `data_export` — dump all user tables to `target_path` as a JSON file.
/// Returns the byte length of the written file so the frontend can display it.
#[tauri::command]
pub async fn data_export(app: tauri::AppHandle, target_path: String) -> Result<u64, String> {
    let pool = open_pool(&app).await?;

    let exported_at = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or(0);

    let mut payload = serde_json::Map::new();
    payload.insert("version".to_string(), json!("1"));
    payload.insert("exported_at".to_string(), json!(exported_at));

    for table in EXPORT_TABLES {
        match dump_table(&pool, table).await {
            Ok(rows) => {
                payload.insert(table.to_string(), Value::Array(rows));
            }
            Err(err) => {
                // Table might not exist yet (e.g. product_events before Phase 0.1
                // migration). Export continues with an empty array.
                eprintln!("[data_export] skipping table {table}: {err}");
                payload.insert(table.to_string(), Value::Array(vec![]));
            }
        }
    }

    pool.close().await;

    let json_bytes = serde_json::to_vec_pretty(&Value::Object(payload))
        .map_err(|e| format!("JSON serialise: {e}"))?;

    let byte_len = json_bytes.len() as u64;
    tokio::fs::write(&target_path, &json_bytes)
        .await
        .map_err(|e| format!("write {target_path}: {e}"))?;

    Ok(byte_len)
}

/// `data_wipe` — delete lyra.db so that the next startup re-runs all
/// migrations and produces clean empty tables. Provider API keys stored in
/// the keychain are intentionally NOT wiped.
#[tauri::command]
pub async fn data_wipe(app: tauri::AppHandle) -> Result<(), String> {
    let db_path = app
        .path()
        .app_data_dir()
        .map_err(|e| e.to_string())?
        .join("lyra.db");

    if db_path.exists() {
        tokio::fs::remove_file(&db_path)
            .await
            .map_err(|e| format!("remove lyra.db: {e}"))?;
    }

    Ok(())
}
