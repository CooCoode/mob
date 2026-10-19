mod secrets;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .invoke_handler(tauri::generate_handler![
            updater_configured,
            secret_get,
            secret_set,
            secret_delete,
            secret_storage_info
        ])
        .plugin(tauri_plugin_process::init())
        .setup(|app| {
            if app.config().plugins.0.contains_key("updater") {
                app.handle()
                    .plugin(tauri_plugin_updater::Builder::new().build())?;
            }
            #[cfg(target_os = "linux")]
            enable_webrtc(app)?;
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running mob");
}

// WebKitGTK ships with WebRTC switched off; the live view uses it when GStreamer's webrtcbin is
// installed, and otherwise falls back to the WebSocket stream played through Media Source.
#[cfg(target_os = "linux")]
fn enable_webrtc(app: &tauri::App) -> tauri::Result<()> {
    use tauri::Manager;
    use webkit2gtk::{SettingsExt, WebViewExt};
    for window in app.webview_windows().into_values() {
        window.with_webview(|webview| {
            if let Some(settings) = webview.inner().settings() {
                settings.set_enable_webrtc(true);
                settings.set_enable_mediasource(true);
            }
        })?;
    }
    Ok(())
}

#[tauri::command]
fn updater_configured(app: tauri::AppHandle) -> bool {
    app.config().plugins.0.contains_key("updater")
}

// Async commands run off the main thread, so a keychain prompt cannot freeze the window.
#[tauri::command]
async fn secret_get(account: String) -> Result<Option<String>, String> {
    secrets::get(&account)
}

#[tauri::command]
async fn secret_set(account: String, value: String) -> Result<String, String> {
    secrets::set(&account, &value).map(|backend| backend.to_string())
}

#[tauri::command]
async fn secret_delete(account: String) -> Result<(), String> {
    secrets::delete(&account)
}

#[tauri::command]
async fn secret_storage_info() -> secrets::StorageInfo {
    secrets::storage_info()
}
