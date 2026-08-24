use serde_json::Value;
use std::path::PathBuf;
use tauri::{Manager, WebviewUrl, WebviewWindowBuilder};

mod oauth;

struct DesktopVaultState(std::sync::Mutex<Option<Vec<u8>>>);

#[tauri::command]
fn set_vault_session_key(
    state: tauri::State<'_, DesktopVaultState>,
    key: Vec<u8>,
) -> Result<(), String> {
    if key.len() != 32 {
        return Err("Invalid vault session key".into());
    }
    *state.0.lock().map_err(|_| "Vault state lock poisoned")? = Some(key);
    Ok(())
}

#[tauri::command]
fn get_vault_session_key(
    state: tauri::State<'_, DesktopVaultState>,
) -> Result<Option<Vec<u8>>, String> {
    Ok(state
        .0
        .lock()
        .map_err(|_| "Vault state lock poisoned")?
        .clone())
}

#[tauri::command]
fn clear_vault_session_key(state: tauri::State<'_, DesktopVaultState>) -> Result<(), String> {
    *state.0.lock().map_err(|_| "Vault state lock poisoned")? = None;
    Ok(())
}

#[tauri::command]
fn set_badge_count(app: tauri::AppHandle, count: u32) -> Result<(), String> {
    let window = app
        .get_webview_window("main")
        .ok_or_else(|| "Main application window not found".to_string())?;
    window
        .set_badge_count((count > 0).then_some(i64::from(count)))
        .map_err(|error| error.to_string())
}

#[tauri::command]
async fn mail_command(command: String, args: Value) -> Result<Value, String> {
    app_lib::command::dispatch(&command, args)
        .await
        .map_err(|error| error.detail)
}

#[tauri::command]
async fn detect_new_mail(
    request: app_lib::sync::SyncRequest,
) -> Result<app_lib::sync::SyncResponse, String> {
    app_lib::sync::detect(request)
        .await
        .map_err(|error| error.code.to_string())
}

#[tauri::command]
fn open_app_window(
    app: tauri::AppHandle,
    label: String,
    path: String,
    title: String,
) -> Result<(), String> {
    let expected_path = match label.as_str() {
        "main" => "",
        "calendar" => "calendar",
        _ => return Err("Unsupported application window".into()),
    };
    if path.trim_start_matches('/') != expected_path {
        return Err("Unsupported application window path".into());
    }

    if let Some(window) = app.get_webview_window(&label) {
        window.show().map_err(|error| error.to_string())?;
        window.set_focus().map_err(|error| error.to_string())?;
        return Ok(());
    }

    let app_url = if expected_path == "calendar" {
        PathBuf::from("?window=calendar")
    } else {
        PathBuf::new()
    };
    WebviewWindowBuilder::new(&app, label, WebviewUrl::App(app_url))
        .title(title)
        .inner_size(1200.0, 800.0)
        .min_inner_size(800.0, 600.0)
        .build()
        .map_err(|error| error.to_string())?;
    Ok(())
}

fn main() {
    tauri::Builder::default()
        .manage(oauth::OAuthState(std::sync::Mutex::new(None)))
        .manage(DesktopVaultState(std::sync::Mutex::new(None)))
        .invoke_handler(tauri::generate_handler![
            mail_command,
            detect_new_mail,
            oauth::start_oauth_listener,
            oauth::wait_oauth_code,
            oauth::open_external_url,
            set_vault_session_key,
            get_vault_session_key,
            clear_vault_session_key,
            set_badge_count,
            open_app_window
        ])
        .run(tauri::generate_context!())
        .expect("run Courrier desktop");
}
