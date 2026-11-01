use std::sync::OnceLock;

use lyra_lib::secrets;

fn prepare() {
    static INIT: OnceLock<()> = OnceLock::new();
    INIT.get_or_init(|| {
        let dir = std::env::temp_dir().join(format!(
            "lyra-secrets-int-{}",
            std::process::id()
        ));
        secrets::testing_secrets_dir(&dir);
    });
}

fn tkey(name: &str) -> String {
    format!("lyra-test-{}-{}", name, std::process::id())
}

#[test]
fn set_get_roundtrip() {
    prepare();
    let k = tkey("k1");
    secrets::set_secret(&k, "v1").unwrap();
    assert_eq!(secrets::get_secret(&k).unwrap().as_deref(), Some("v1"));
    secrets::delete_secret(&k).unwrap();
}

#[test]
fn get_missing_returns_none() {
    prepare();
    let k = tkey("does-not-exist");
    assert_eq!(secrets::get_secret(&k).unwrap(), None);
}

#[test]
fn delete_missing_is_ok() {
    prepare();
    let k = tkey("also-missing");
    secrets::delete_secret(&k).unwrap();
}
