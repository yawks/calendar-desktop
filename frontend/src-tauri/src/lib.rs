mod auth;
mod ews;
mod http;
mod mail;

#[cfg(target_os = "macos")]
mod eventkit;

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
