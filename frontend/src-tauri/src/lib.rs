mod auth;
mod ews;
mod gmail;
mod http;
mod imap;
mod jmap;
mod mail;

use base64::{engine::general_purpose::STANDARD as BASE64, Engine as _};

/// Save a base64-encoded file to the user's Downloads folder.
/// Accepts both standard base64 and base64url encoding.
/// Returns the absolute path of the saved file.
#[tauri::command]
fn save_file_to_downloads(filename: String, data: String) -> Result<String, String> {
    // Normalise base64url → standard base64
    let standard = data.replace('-', "+").replace('_', "/");
    let padding = (4 - standard.len() % 4) % 4;
    let padded = format!("{}{}", standard, "=".repeat(padding));
    let bytes = BASE64.decode(padded.as_bytes()).map_err(|e| format!("Base64 decode: {}", e))?;

    let safe_name: String = filename
        .chars()
        .map(|c| if c.is_alphanumeric() || ".-_ ()[]".contains(c) { c } else { '_' })
        .collect();

    let home = std::env::var("HOME").unwrap_or_else(|_| "/tmp".to_string());
    let downloads = std::path::PathBuf::from(home).join("Downloads");
    std::fs::create_dir_all(&downloads).map_err(|e| e.to_string())?;
    let dest = downloads.join(&safe_name);
    std::fs::write(&dest, &bytes).map_err(|e| format!("Write: {}", e))?;
    Ok(dest.to_string_lossy().into_owned())
}

/// Open a local file with the system default application.
#[tauri::command]
fn open_file_path(path: String) -> Result<(), String> {
    #[cfg(target_os = "macos")]
    std::process::Command::new("open")
        .arg(&path)
        .spawn()
        .map_err(|e| format!("open: {}", e))?;

    #[cfg(target_os = "linux")]
    std::process::Command::new("xdg-open")
        .arg(&path)
        .spawn()
        .map_err(|e| format!("xdg-open: {}", e))?;

    #[cfg(target_os = "windows")]
    std::process::Command::new("cmd")
        .args(["/C", "start", "", &path])
        .spawn()
        .map_err(|e| format!("start: {}", e))?;

    Ok(())
}

#[cfg(target_os = "macos")]
mod eventkit;

// ── Badge ──────────────────────────────────────────────────────────────────────

/// Set the application dock/taskbar badge count.
/// On macOS, updates the Dock tile badge label via AppKit.
/// On other platforms this is a no-op.
#[tauri::command]
fn set_badge_count(app: tauri::AppHandle, count: u32) -> Result<(), String> {
    #[cfg(target_os = "macos")]
    {
        app.run_on_main_thread(move || {
            use objc2::MainThreadMarker;
            use objc2_app_kit::NSApplication;
            use objc2_foundation::NSString;
            unsafe {
                let mtm = MainThreadMarker::new_unchecked();
                let ns_app = NSApplication::sharedApplication(mtm);
                let tile = ns_app.dockTile();
                if count == 0 {
                    tile.setBadgeLabel(None);
                } else {
                    let label = NSString::from_str(&count.to_string());
                    tile.setBadgeLabel(Some(&label));
                }
            }
        })
        .map_err(|e| e.to_string())?;
    }
    #[cfg(not(target_os = "macos"))]
    let _ = (app, count);
    Ok(())
}

// ── App entry point ───────────────────────────────────────────────────────────

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    rustls::crypto::aws_lc_rs::default_provider()
        .install_default()
        .expect("Failed to install rustls crypto provider");

    let oauth_state = auth::OAuthState { rx: std::sync::Mutex::new(None) };

    #[cfg(target_os = "macos")]
    let ek_state = eventkit::EventKitState::new();

    let builder = tauri::Builder::default()
        .manage(oauth_state);

    #[cfg(target_os = "macos")]
    let builder = builder.manage(ek_state);

    builder
        .invoke_handler({
            #[cfg(not(target_os = "macos"))]
            {
                tauri::generate_handler![
                    http::fetch_ics,
                    http::fetch_url_with_auth,
                    http::put_caldav_event,
                    http::delete_caldav_event,
                    http::fetch_caldav_status,
                    auth::open_url,
                    auth::start_oauth_listener,
                    auth::wait_oauth_code,
                    ews::ews_start_device_auth,
                    ews::ews_poll_device_token,
                    ews::ews_refresh_access_token,
                    ews::ews_get_calendar_events,
                    ews::ews_respond_to_invitation,
                    ews::ews_create_event,
                    ews::ews_update_event,
                    ews::ews_delete_event,
                    ews::ews_get_free_busy,
                    ews::ews_get_free_busy_ews,
                    mail::mail_list_folders,
                    mail::mail_list_threads,
                    mail::mail_get_thread,
                    mail::mail_send,
                    mail::mail_mark_read,
                    mail::mail_mark_unread,
                    mail::mail_move_to_trash,
                    mail::mail_permanently_delete,
                    mail::mail_open_attachment,
                    mail::mail_get_attachment_data,
                    mail::mail_get_inbox_unread,
                    mail::mail_snooze,
                    mail::mail_move_to_folder,
                    mail::mail_find_or_create_snoozed_folder,
                    mail::mail_save_draft,
                    mail::mail_search_threads,
                    gmail::gmail_open_attachment,
                    gmail::gmail_get_attachment_data,
                    imap::imap_list_folders,
                    imap::imap_get_inbox_unread,
                    imap::imap_list_threads,
                    imap::imap_get_thread,
                    imap::imap_mark_read,
                    imap::imap_mark_unread,
                    imap::imap_move_to_trash,
                    imap::imap_permanently_delete,
                    imap::imap_send,
                    imap::imap_get_attachment_data,
                    jmap::jmap_list_folders,
                    jmap::jmap_get_inbox_unread,
                    jmap::jmap_list_threads,
                    jmap::jmap_get_thread,
                    jmap::jmap_mark_read,
                    jmap::jmap_mark_unread,
                    jmap::jmap_move_to_trash,
                    jmap::jmap_permanently_delete,
                    jmap::jmap_send,
                    jmap::jmap_get_attachment_data,
                    jmap::jmap_search_threads,
                    jmap::jmap_list_identities,
                    save_file_to_downloads,
                    open_file_path,
                    set_badge_count,
                ]
            }
            #[cfg(target_os = "macos")]
            {
                tauri::generate_handler![
                    http::fetch_ics,
                    http::fetch_url_with_auth,
                    http::put_caldav_event,
                    http::delete_caldav_event,
                    http::fetch_caldav_status,
                    auth::open_url,
                    auth::start_oauth_listener,
                    auth::wait_oauth_code,
                    ews::ews_start_device_auth,
                    ews::ews_poll_device_token,
                    ews::ews_refresh_access_token,
                    ews::ews_get_calendar_events,
                    ews::ews_respond_to_invitation,
                    ews::ews_create_event,
                    ews::ews_update_event,
                    ews::ews_delete_event,
                    ews::ews_get_free_busy,
                    ews::ews_get_free_busy_ews,
                    mail::mail_list_folders,
                    mail::mail_list_threads,
                    mail::mail_get_thread,
                    mail::mail_send,
                    mail::mail_mark_read,
                    mail::mail_mark_unread,
                    mail::mail_move_to_trash,
                    mail::mail_permanently_delete,
                    mail::mail_open_attachment,
                    mail::mail_get_attachment_data,
                    mail::mail_get_inbox_unread,
                    mail::mail_snooze,
                    mail::mail_move_to_folder,
                    mail::mail_find_or_create_snoozed_folder,
                    mail::mail_save_draft,
                    mail::mail_search_threads,
                    gmail::gmail_open_attachment,
                    gmail::gmail_get_attachment_data,
                    imap::imap_list_folders,
                    imap::imap_get_inbox_unread,
                    imap::imap_list_threads,
                    imap::imap_get_thread,
                    imap::imap_mark_read,
                    imap::imap_mark_unread,
                    imap::imap_move_to_trash,
                    imap::imap_permanently_delete,
                    imap::imap_send,
                    imap::imap_get_attachment_data,
                    jmap::jmap_list_folders,
                    jmap::jmap_get_inbox_unread,
                    jmap::jmap_list_threads,
                    jmap::jmap_get_thread,
                    jmap::jmap_mark_read,
                    jmap::jmap_mark_unread,
                    jmap::jmap_move_to_trash,
                    jmap::jmap_permanently_delete,
                    jmap::jmap_send,
                    jmap::jmap_get_attachment_data,
                    jmap::jmap_search_threads,
                    save_file_to_downloads,
                    open_file_path,
                    set_badge_count,
                    eventkit::check_eventkit_status,
                    eventkit::request_eventkit_access,
                    eventkit::list_eventkit_calendars,
                    eventkit::fetch_eventkit_events,
                    eventkit::create_eventkit_event,
                    eventkit::update_eventkit_event,
                    eventkit::delete_eventkit_event,
                ]
            }
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
