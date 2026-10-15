// Pairing credentials and Desktop sign-in passwords live in the system keychain.
const SECRET_SERVICE: &str = "com.xrdavies.mob";

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .invoke_handler(tauri::generate_handler![
            updater_configured,
            secret_get,
            secret_set,
            secret_delete
        ])
        .plugin(tauri_plugin_process::init())
        .setup(|app| {
            if app.config().plugins.0.contains_key("updater") {
                app.handle()
                    .plugin(tauri_plugin_updater::Builder::new().build())?;
            }
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running mob");
}

#[tauri::command]
fn updater_configured(app: tauri::AppHandle) -> bool {
    app.config().plugins.0.contains_key("updater")
}

fn secret_entry(account: &str) -> Result<keyring::Entry, String> {
    if account.is_empty() || account.len() > 256 {
        return Err("invalid secret account".into());
    }
    keyring::Entry::new(SECRET_SERVICE, account).map_err(|e| e.to_string())
}

// Async commands run off the main thread, so a keychain prompt cannot freeze the window.
#[tauri::command]
async fn secret_get(account: String) -> Result<Option<String>, String> {
    match secret_entry(&account)?.get_password() {
        Ok(value) => Ok(Some(value)),
        Err(keyring::Error::NoEntry) => Ok(None),
        Err(e) => Err(e.to_string()),
    }
}

#[tauri::command]
async fn secret_set(account: String, value: String) -> Result<(), String> {
    secret_entry(&account)?
        .set_password(&value)
        .map_err(|e| e.to_string())
}

#[tauri::command]
async fn secret_delete(account: String) -> Result<(), String> {
    match secret_entry(&account)?.delete_credential() {
        Ok(()) | Err(keyring::Error::NoEntry) => Ok(()),
        Err(e) => Err(e.to_string()),
    }
}
