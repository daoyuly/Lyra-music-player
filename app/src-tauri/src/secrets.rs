//! API keys and other secrets.
//!
//! Dev builds are ad-hoc signed, so the macOS login keychain treats every
//! rebuild as a different app and asks for the login password again. Reads go
//! to a 0600 file under Application Support. The first time a key is missing
//! there, it is copied out of the old keychain entry (that copy can ask once).

use std::collections::BTreeMap;
use std::fs::{self, OpenOptions};
use std::io::Write;
use std::path::{Path, PathBuf};
use std::process::Command;
use std::sync::{Mutex, MutexGuard};

#[cfg(unix)]
use std::os::unix::fs::{OpenOptionsExt, PermissionsExt};

const SERVICE: &str = "com.daoyu.lyra";

static OPS: Mutex<()> = Mutex::new(());
static DIR_OVERRIDE: Mutex<Option<PathBuf>> = Mutex::new(None);

fn lock() -> MutexGuard<'static, ()> {
    OPS.lock().unwrap_or_else(|err| err.into_inner())
}

fn dir_override() -> Option<PathBuf> {
    DIR_OVERRIDE
        .lock()
        .unwrap_or_else(|err| err.into_inner())
        .clone()
}

/// Point secret storage at a directory. Tests use this so they never touch
/// the login keychain.
pub fn testing_secrets_dir(dir: &Path) {
    fs::create_dir_all(dir).expect("create secrets test dir");
    *DIR_OVERRIDE.lock().unwrap_or_else(|err| err.into_inner()) = Some(dir.to_path_buf());
}

pub fn set_secret(key: &str, value: &str) -> Result<(), String> {
    let _guard = lock();
    let mut store = load()?;
    store.insert(key.to_string(), Some(value.to_string()));
    save(&store)
}

pub fn get_secret(key: &str) -> Result<Option<String>, String> {
    let _guard = lock();
    let mut store = load()?;
    if let Some(value) = store.get(key) {
        return Ok(value.clone());
    }
    if dir_override().is_some() {
        return Ok(None);
    }
    let imported = import_legacy(key)?;
    store.insert(key.to_string(), imported.clone());
    save(&store)?;
    if imported.is_some() {
        eprintln!("[lyra:keychain] copied {key} out of the login keychain");
    }
    Ok(imported)
}

pub fn delete_secret(key: &str) -> Result<(), String> {
    let _guard = lock();
    let mut store = load()?;
    store.insert(key.to_string(), None);
    save(&store)
}

fn secrets_file() -> Result<PathBuf, String> {
    if let Some(dir) = dir_override() {
        return Ok(dir.join("secrets.json"));
    }
    let home = std::env::var_os("HOME").ok_or("HOME is not set")?;
    Ok(PathBuf::from(home)
        .join("Library/Application Support")
        .join(SERVICE)
        .join("secrets.json"))
}

fn load() -> Result<BTreeMap<String, Option<String>>, String> {
    let path = secrets_file()?;
    if !path.exists() {
        return Ok(BTreeMap::new());
    }
    let text = fs::read_to_string(&path).map_err(|err| err.to_string())?;
    if text.trim().is_empty() {
        return Ok(BTreeMap::new());
    }
    serde_json::from_str(&text).map_err(|err| format!("read {}: {err}", path.display()))
}

fn save(store: &BTreeMap<String, Option<String>>) -> Result<(), String> {
    let path = secrets_file()?;
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).map_err(|err| err.to_string())?;
    }
    let text = serde_json::to_string_pretty(store).map_err(|err| err.to_string())?;
    let tmp = path.with_extension("json.tmp");
    {
        let mut options = OpenOptions::new();
        options.write(true).create(true).truncate(true);
        #[cfg(unix)]
        options.mode(0o600);
        let mut file = options.open(&tmp).map_err(|err| err.to_string())?;
        file.write_all(text.as_bytes()).map_err(|err| err.to_string())?;
    }
    fs::rename(&tmp, &path).map_err(|err| err.to_string())?;
    #[cfg(unix)]
    fs::set_permissions(&path, fs::Permissions::from_mode(0o600))
        .map_err(|err| err.to_string())?;
    Ok(())
}

/// Copy one legacy login-keychain item. `security` is Apple-signed, so it can
/// show the password dialog that a rebuilt dev app sometimes never presents.
#[cfg(target_os = "macos")]
fn import_legacy(account: &str) -> Result<Option<String>, String> {
    let output = Command::new("security")
        .args([
            "find-generic-password",
            "-s",
            SERVICE,
            "-a",
            account,
            "-w",
        ])
        .output()
        .map_err(|err| format!("read login keychain: {err}"))?;
    if output.status.code() == Some(44) {
        return Ok(None);
    }
    if !output.status.success() {
        let detail = String::from_utf8_lossy(&output.stderr);
        let detail = detail.trim();
        if detail.is_empty() {
            return Err("read login keychain failed".into());
        }
        return Err(detail.to_string());
    }
    let mut password = String::from_utf8(output.stdout)
        .map_err(|_| format!("secret {account} is not utf-8"))?;
    if password.ends_with('\n') {
        password.pop();
    }
    if password.ends_with('\r') {
        password.pop();
    }
    Ok(Some(password))
}

#[cfg(not(target_os = "macos"))]
fn import_legacy(_account: &str) -> Result<Option<String>, String> {
    Ok(None)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn setup() {
        let dir = std::env::temp_dir().join(format!("lyra-secrets-lib-{}", std::process::id()));
        testing_secrets_dir(&dir);
    }

    #[test]
    fn roundtrip_missing_and_delete() {
        setup();
        let key = format!("unit-{}", std::process::id());
        assert_eq!(get_secret(&key).unwrap(), None);
        set_secret(&key, "v1").unwrap();
        assert_eq!(get_secret(&key).unwrap().as_deref(), Some("v1"));
        set_secret(&key, "v2").unwrap();
        assert_eq!(get_secret(&key).unwrap().as_deref(), Some("v2"));
        delete_secret(&key).unwrap();
        assert_eq!(get_secret(&key).unwrap(), None);
        delete_secret(&key).unwrap();
    }
}
