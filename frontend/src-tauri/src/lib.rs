mod auth;
mod ews;
mod http;
mod mail;

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
                    mail::mail_open_attachment,
                    mail::mail_get_inbox_unread,
                    mail::mail_snooze,
                    mail::mail_move_to_folder,
                    mail::mail_find_or_create_snoozed_folder,
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
                    mail::mail_open_attachment,
                    mail::mail_get_inbox_unread,
                    mail::mail_snooze,
                    mail::mail_move_to_folder,
                    mail::mail_find_or_create_snoozed_folder,
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
