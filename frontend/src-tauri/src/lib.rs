use std::sync::Mutex;
use tokio::sync::oneshot;

// ── ICS fetch ─────────────────────────────────────────────────────────────────

#[tauri::command]
async fn fetch_ics(url: String) -> Result<String, String> {
    let client = reqwest::Client::builder()
        .user_agent("CalendarApp/1.0")
        .timeout(std::time::Duration::from_secs(15))
        .build()
        .map_err(|e| e.to_string())?;

    let response = client
        .get(&url)
        .send()
        .await
        .map_err(|e| format!("Fetch error: {}", e))?;

    response
        .text()
        .await
        .map_err(|e| format!("Read error: {}", e))
}

// ── Authenticated HTTP fetch (Nextcloud / CalDAV) ─────────────────────────────

/// Fetches a URL with HTTP Basic Auth and returns the response body.
/// Used by the Nextcloud hook to retrieve the ICS export of a CalDAV calendar.
#[tauri::command]
async fn fetch_url_with_auth(url: String, username: String, password: String) -> Result<String, String> {
    let client = reqwest::Client::builder()
        .user_agent("CalendarApp/1.0")
        .timeout(std::time::Duration::from_secs(30))
        .build()
        .map_err(|e| e.to_string())?;

    let response = client
        .get(&url)
        .basic_auth(&username, Some(&password))
        .send()
        .await
        .map_err(|e| format!("Erreur réseau : {}", e))?;

    let status = response.status();
    if !status.is_success() {
        return Err(format!(
            "HTTP {} — {}",
            status.as_u16(),
            status.canonical_reason().unwrap_or("erreur")
        ));
    }

    response.text().await.map_err(|e| format!("Erreur de lecture : {}", e))
}

// ── CalDAV write (create / update event) ─────────────────────────────────────

/// HTTP PUT with Basic Auth — used to create or update a CalDAV event resource.
/// `url` must be the full resource URL, e.g. {calendar}/{uid}.ics
#[tauri::command]
async fn put_caldav_event(url: String, username: String, password: String, ics_content: String) -> Result<(), String> {
    let client = reqwest::Client::builder()
        .user_agent("CalendarApp/1.0")
        .timeout(std::time::Duration::from_secs(30))
        .build()
        .map_err(|e| e.to_string())?;

    let response = client
        .put(&url)
        .basic_auth(&username, Some(&password))
        .header("Content-Type", "text/calendar; charset=utf-8")
        .body(ics_content)
        .send()
        .await
        .map_err(|e| format!("Erreur réseau : {}", e))?;

    let status = response.status();
    if !status.is_success() {
        return Err(format!(
            "HTTP {} — {}",
            status.as_u16(),
            status.canonical_reason().unwrap_or("erreur")
        ));
    }

    Ok(())
}

// ── CalDAV connectivity test ───────────────────────────────────────────────────

/// Sends a GET request with HTTP Basic Auth and returns the HTTP status code.
/// Used to validate Nextcloud / CalDAV calendar credentials before saving.
#[tauri::command]
async fn fetch_caldav_status(url: String, username: String, password: String) -> Result<u16, String> {
    let client = reqwest::Client::builder()
        .user_agent("CalendarApp/1.0")
        .timeout(std::time::Duration::from_secs(10))
        .build()
        .map_err(|e| e.to_string())?;

    let response = client
        .get(&url)
        .basic_auth(&username, Some(&password))
        .send()
        .await
        .map_err(|e| format!("Erreur réseau : {}", e))?;

    Ok(response.status().as_u16())
}

// ── Google OAuth ──────────────────────────────────────────────────────────────

#[derive(Debug, serde::Serialize)]
struct OAuthCallback {
    code: Option<String>,
    state: Option<String>,
    error: Option<String>,
}

/// Shared state: holds the oneshot receiver for the OAuth callback result.
struct OAuthState {
    rx: Mutex<Option<oneshot::Receiver<OAuthCallback>>>,
}

/// Step 1 — Opens a TCP listener on a random localhost port.
/// Returns the port so the frontend can build the redirect_uri and open the browser.
/// The listener runs in the background; call `wait_oauth_code` to block until
/// the callback arrives.
#[tauri::command]
async fn start_oauth_listener(state: tauri::State<'_, OAuthState>) -> Result<u16, String> {
    use tokio::io::{AsyncReadExt, AsyncWriteExt};
    use tokio::net::TcpListener;

    let listener = TcpListener::bind("127.0.0.1:0")
        .await
        .map_err(|e| e.to_string())?;
    let port = listener.local_addr().map_err(|e| e.to_string())?.port();

    let (tx, rx) = oneshot::channel::<OAuthCallback>();

    // Store the receiver so `wait_oauth_code` can pick it up
    *state.rx.lock().map_err(|_| "Lock poisoned")? = Some(rx);

    tokio::spawn(async move {
        match listener.accept().await {
            Ok((mut stream, _)) => {
                let mut buf = vec![0u8; 8192];
                let result = match stream.read(&mut buf).await {
                    Ok(n) => {
                        let request = String::from_utf8_lossy(&buf[..n]);
                        let code = extract_query_param(&request, "code");
                        let st = extract_query_param(&request, "state");
                        let error = extract_query_param(&request, "error");

                        let html = if code.is_some() {
                            include_str!("oauth_success.html")
                        } else {
                            include_str!("oauth_error.html")
                        };
                        let response = format!(
                            "HTTP/1.1 200 OK\r\nContent-Type: text/html; charset=utf-8\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{}",
                            html.len(), html
                        );
                        let _ = stream.write_all(response.as_bytes()).await;
                        let _ = stream.flush().await;

                        OAuthCallback { code, state: st, error }
                    }
                    Err(e) => OAuthCallback {
                        code: None,
                        state: None,
                        error: Some(format!("Read error: {}", e)),
                    },
                };
                let _ = tx.send(result);
            }
            Err(e) => {
                let _ = tx.send(OAuthCallback {
                    code: None,
                    state: None,
                    error: Some(format!("Accept error: {}", e)),
                });
            }
        }
    });

    Ok(port)
}

/// Step 2 — Blocks until the OAuth callback is received (up to 5 minutes).
/// Returns { code, state, error }.
#[tauri::command]
async fn wait_oauth_code(state: tauri::State<'_, OAuthState>) -> Result<OAuthCallback, String> {
    // Take the receiver out of the mutex without holding the lock during the await
    let rx = {
        let mut guard = state.rx.lock().map_err(|_| "Lock poisoned")?;
        guard.take().ok_or("Aucun flux OAuth en attente — appelez start_oauth_listener d'abord")?
    };

    tokio::time::timeout(std::time::Duration::from_secs(300), rx)
        .await
        .map_err(|_| "Timeout: aucune réponse OAuth en 5 minutes".to_string())?
        .map_err(|_| "Le channel OAuth a été fermé sans réponse".to_string())
}

/// Opens a URL in the system default browser.
#[tauri::command]
fn open_url(url: String) -> Result<(), String> {
    webbrowser::open(&url).map_err(|e| e.to_string())
}

// ── Helpers ───────────────────────────────────────────────────────────────────

fn extract_query_param(request: &str, param: &str) -> Option<String> {
    let first_line = request.lines().next()?;
    // e.g. "GET /?code=xxx&state=yyy HTTP/1.1"
    let path = first_line.split_whitespace().nth(1)?;
    let query = path.split('?').nth(1)?;
    for pair in query.split('&') {
        let mut kv = pair.splitn(2, '=');
        let key = kv.next()?;
        if key == param {
            let raw = kv.next().unwrap_or("").trim_end_matches(" HTTP/1.1");
            return Some(urlencoding::decode(raw).unwrap_or_default().into_owned());
        }
    }
    None
}

// ── EventKit (macOS only) ─────────────────────────────────────────────────────

#[cfg(target_os = "macos")]
mod eventkit {
    use objc2::rc::Retained;
    use objc2::runtime::Bool;
    use objc2_app_kit::NSColor;
    use objc2_event_kit::{
        EKAuthorizationStatus, EKCalendar, EKEntityType, EKEvent, EKEventStore,
        EKParticipant, EKParticipantRole, EKParticipantStatus, EKSpan,
    };
    use objc2_foundation::{NSArray, NSDate, NSError, NSString};
    use serde::{Deserialize, Serialize};

    // ── Thread-safety wrapper ────────────────────────────────────────────────

    pub struct EKStoreWrapper(pub Retained<EKEventStore>);

    // SAFETY: EKEventStore is documented as thread-safe by Apple for reading.
    // Write operations (save/remove) are protected by the Tauri command serialisation.
    unsafe impl Send for EKStoreWrapper {}
    unsafe impl Sync for EKStoreWrapper {}

    pub struct EventKitState {
        pub store: std::sync::Arc<EKStoreWrapper>,
    }

    impl EventKitState {
        pub fn new() -> Self {
            let store = unsafe { EKEventStore::new() };
            Self {
                store: std::sync::Arc::new(EKStoreWrapper(store)),
            }
        }
    }

    // ── Serialisable types ───────────────────────────────────────────────────

    #[derive(Debug, Serialize, Clone)]
    pub struct EKCalendarInfo {
        pub id: String,
        pub title: String,
        pub color: String,
        pub is_writable: bool,
        pub source_title: String,
    }

    #[derive(Debug, Serialize, Clone)]
    pub struct EKAttendeeInfo {
        pub name: String,
        pub email: String,
        pub status: String,
        pub is_organizer: bool,
    }

    #[derive(Debug, Serialize, Clone)]
    pub struct EKEventInfo {
        pub id: String,
        pub calendar_id: String,
        pub title: String,
        pub start: String,
        pub end: String,
        pub is_all_day: bool,
        pub location: Option<String>,
        pub notes: Option<String>,
        pub attendees: Vec<EKAttendeeInfo>,
    }

    #[derive(Debug, Deserialize)]
    pub struct AttendeePayload {
        pub email: String,
        pub name: Option<String>,
    }

    #[derive(Debug, Deserialize)]
    pub struct CreateEKEventPayload {
        pub calendar_id: String,
        pub title: String,
        pub start: String,
        pub end: String,
        pub is_all_day: bool,
        pub location: Option<String>,
        pub notes: Option<String>,
        pub attendees: Option<Vec<AttendeePayload>>,
    }

    #[derive(Debug, Deserialize)]
    pub struct UpdateEKEventPayload {
        pub event_id: String,
        pub title: String,
        pub start: String,
        pub end: String,
        pub is_all_day: bool,
        pub location: Option<String>,
        pub notes: Option<String>,
        pub attendees: Option<Vec<AttendeePayload>>,
    }

    // ── Helpers ──────────────────────────────────────────────────────────────

    /// Convert a Unix timestamp (seconds) to an ISO 8601 UTC string.
    pub fn ts_to_iso(ts: f64) -> String {
        let total_secs = ts as i64;
        let mut rem = total_secs % 86400;
        let mut days = total_secs / 86400;
        if rem < 0 {
            rem += 86400;
            days -= 1;
        }
        let h = rem / 3600;
        let m = (rem % 3600) / 60;
        let s = rem % 60;

        // Julian Day Number for Unix epoch: 2440588
        let jd = days + 2440588;
        let l = jd + 68569;
        let n = (4 * l) / 146097;
        let l = l - (146097 * n + 3) / 4;
        let i = (4000 * (l + 1)) / 1461001;
        let l = l - (1461 * i) / 4 + 31;
        let j = (80 * l) / 2447;
        let day = l - (2447 * j) / 80;
        let l = j / 11;
        let month = j + 2 - 12 * l;
        let year = 100 * (n - 49) + i + l;

        format!(
            "{:04}-{:02}-{:02}T{:02}:{:02}:{:02}Z",
            year, month, day, h, m, s
        )
    }

    /// Parse an ISO 8601 string to a Unix timestamp (seconds).
    /// Handles "YYYY-MM-DD" (all-day) and "YYYY-MM-DDTHH:MM:SSZ" / "+HH:MM" offsets.
    pub fn iso_to_ts(iso: &str) -> Result<f64, String> {
        let iso = iso.trim();

        // All-day date: YYYY-MM-DD
        if iso.len() == 10 && iso.as_bytes()[4] == b'-' {
            let y: i64 = iso[0..4].parse().map_err(|e: std::num::ParseIntError| e.to_string())?;
            let mo: i64 = iso[5..7].parse().map_err(|e: std::num::ParseIntError| e.to_string())?;
            let d: i64 = iso[8..10].parse().map_err(|e: std::num::ParseIntError| e.to_string())?;
            let jd = julian_day(y, mo, d);
            return Ok(((jd - 2440588) * 86400) as f64);
        }

        // DateTime: YYYY-MM-DDTHH:MM:SS[.mmm][Z|+HH:MM|-HH:MM]
        if iso.len() < 19 {
            return Err(format!("Format de date non reconnu : {}", iso));
        }
        let y: i64 = iso[0..4].parse().map_err(|e: std::num::ParseIntError| e.to_string())?;
        let mo: i64 = iso[5..7].parse().map_err(|e: std::num::ParseIntError| e.to_string())?;
        let d: i64 = iso[8..10].parse().map_err(|e: std::num::ParseIntError| e.to_string())?;
        let h: i64 = iso[11..13].parse().map_err(|e: std::num::ParseIntError| e.to_string())?;
        let min: i64 = iso[14..16].parse().map_err(|e: std::num::ParseIntError| e.to_string())?;
        let sec: i64 = iso[17..19].parse().map_err(|e: std::num::ParseIntError| e.to_string())?;

        let jd = julian_day(y, mo, d);
        let base = (jd - 2440588) * 86400 + h * 3600 + min * 60 + sec;

        // Parse timezone offset
        let tz_part = &iso[19..];
        // Skip fractional seconds if present
        let tz_part = if tz_part.starts_with('.') {
            let end = tz_part.find(|c: char| c == 'Z' || c == '+' || c == '-').unwrap_or(tz_part.len());
            &tz_part[end..]
        } else {
            tz_part
        };

        let offset_secs: i64 = if tz_part.is_empty() || tz_part == "Z" {
            0
        } else {
            let sign: i64 = if tz_part.starts_with('+') { 1 } else { -1 };
            let parts = &tz_part[1..];
            if parts.len() >= 5 {
                let oh: i64 = parts[0..2].parse().unwrap_or(0);
                let om: i64 = parts[3..5].parse().unwrap_or(0);
                sign * (oh * 3600 + om * 60)
            } else {
                0
            }
        };

        Ok((base - offset_secs) as f64)
    }

    fn julian_day(y: i64, m: i64, d: i64) -> i64 {
        // Algorithm from Wikipedia (Julian Day Number from Gregorian calendar)
        (1461 * (y + 4800 + (m - 14) / 12)) / 4
            + (367 * (m - 2 - 12 * ((m - 14) / 12))) / 12
            - (3 * ((y + 4900 + (m - 14) / 12) / 100)) / 4
            + d
            - 32075
    }

    /// Extract an approximate hex colour from an NSColor.
    /// Calendar colours are always in RGB colour space, so redComponent etc. are safe.
    pub fn nscolor_to_hex(color: &NSColor) -> String {
        // SAFETY: Calendar colours returned by EventKit are always in a device/calibrated
        // RGB colour space. Calling redComponent on a non-RGB colour would raise an exception
        // in ObjC, but that cannot happen here.
        let r = color.redComponent();
        let g = color.greenComponent();
        let b = color.blueComponent();
        let to_u8 = |v: f64| (v.clamp(0.0, 1.0) * 255.0).round() as u8;
        format!("#{:02x}{:02x}{:02x}", to_u8(r), to_u8(g), to_u8(b))
    }

    /// Extracts attendees from an EKEvent.
    /// The participant URL is typically `mailto:email@example.com`.
    fn extract_attendees(ev: &EKEvent) -> Vec<EKAttendeeInfo> {
        let Some(participants) = (unsafe { ev.attendees() }) else {
            return vec![];
        };
        participants
            .iter()
            .filter_map(|p: Retained<EKParticipant>| {
                // Email from mailto: URL
                let url_str = unsafe { p.URL() }.absoluteString()?.to_string();
                let email = url_str
                    .strip_prefix("mailto:")
                    .unwrap_or(&url_str)
                    .to_string();

                let name = unsafe { p.name() }
                    .map(|n| n.to_string())
                    .unwrap_or_else(|| email.clone());

                let status = match unsafe { p.participantStatus() } {
                    EKParticipantStatus::Accepted   => "ACCEPTED",
                    EKParticipantStatus::Declined   => "DECLINED",
                    EKParticipantStatus::Tentative  => "TENTATIVE",
                    EKParticipantStatus::Delegated  => "DELEGATED",
                    _                               => "NEEDS-ACTION",
                }
                .to_string();

                // Chair role = organizer (matches EKEvent.organizer)
                let is_organizer =
                    unsafe { p.participantRole() } == EKParticipantRole::Chair;

                Some(EKAttendeeInfo { name, email, status, is_organizer })
            })
            .collect()
    }

    // ── Tauri commands ───────────────────────────────────────────────────────

    /// Returns the current EventKit authorisation status.
    /// Possible values: "not_determined" | "restricted" | "denied" | "authorized" | "write_only"
    #[tauri::command]
    pub async fn check_eventkit_status() -> Result<String, String> {
        let status =
            unsafe { EKEventStore::authorizationStatusForEntityType(EKEntityType::Event) };
        let s = match status {
            EKAuthorizationStatus::NotDetermined => "not_determined",
            EKAuthorizationStatus::Restricted => "restricted",
            EKAuthorizationStatus::Denied => "denied",
            EKAuthorizationStatus::FullAccess => "authorized",
            EKAuthorizationStatus::WriteOnly => "write_only",
            _ => "unknown",
        };
        Ok(s.to_string())
    }

    /// Requests full calendar access. Returns the new status string (same values as above).
    #[tauri::command]
    pub async fn request_eventkit_access(
        state: tauri::State<'_, EventKitState>,
    ) -> Result<String, String> {
        let store_arc = state.store.clone();

        // Run in a blocking context to avoid Send issues with ObjC types crossing await points.
        let granted = tokio::task::spawn_blocking(move || {
            let (tx, rx) = std::sync::mpsc::channel::<bool>();

            // Use StackBlock — EventKit copies it to the heap via Block_copy before returning.
            let block = block2::StackBlock::new(move |granted: Bool, _err: *mut NSError| {
                let _ = tx.send(granted.as_bool());
            });

            unsafe {
                store_arc
                    .0
                    .requestFullAccessToEventsWithCompletion(&block as *const _ as *mut _);
            }

            rx.recv_timeout(std::time::Duration::from_secs(30)).unwrap_or(false)
        })
        .await
        .map_err(|e| e.to_string())?;

        if granted {
            Ok("authorized".to_string())
        } else {
            Ok("denied".to_string())
        }
    }

    /// Lists all EventKit calendars the user has granted access to.
    #[tauri::command]
    pub async fn list_eventkit_calendars(
        state: tauri::State<'_, EventKitState>,
    ) -> Result<Vec<EKCalendarInfo>, String> {
        let store_arc = state.store.clone();
        let calendars: Retained<NSArray<EKCalendar>> =
            unsafe { store_arc.0.calendarsForEntityType(EKEntityType::Event) };

        let mut result = Vec::new();
        for cal in &calendars {
            let id = unsafe { cal.calendarIdentifier() }.to_string();
            let title = unsafe { cal.title() }.to_string();
            let ns_color = unsafe { cal.color() };
            let color = nscolor_to_hex(&ns_color);
            let is_writable = unsafe { cal.allowsContentModifications() };
            let source_title = unsafe { cal.source() }
                .as_deref()
                .map(|s| unsafe { s.title() }.to_string())
                .unwrap_or_default();

            result.push(EKCalendarInfo {
                id,
                title,
                color,
                is_writable,
                source_title,
            });
        }
        Ok(result)
    }

    /// Fetches events from a specific EventKit calendar within a time range.
    /// `time_min` and `time_max` are ISO 8601 strings.
    #[tauri::command]
    pub async fn fetch_eventkit_events(
        state: tauri::State<'_, EventKitState>,
        calendar_id: String,
        time_min: String,
        time_max: String,
    ) -> Result<Vec<EKEventInfo>, String> {
        let store_arc = state.store.clone();

        let start_ts = iso_to_ts(&time_min)?;
        let end_ts = iso_to_ts(&time_max)?;

        let start_date = NSDate::dateWithTimeIntervalSince1970(start_ts);
        let end_date = NSDate::dateWithTimeIntervalSince1970(end_ts);

        // Find the target calendar
        let all_cals: Retained<NSArray<EKCalendar>> =
            unsafe { store_arc.0.calendarsForEntityType(EKEntityType::Event) };

        let target_cal = all_cals
            .iter()
            .find(|c| unsafe { c.calendarIdentifier() }.to_string() == calendar_id);

        let pred = match target_cal {
            Some(cal) => {
                // Build a single-calendar NSArray
                let retained =
                    unsafe { Retained::retain(&*cal as *const EKCalendar as *mut EKCalendar) }
                        .ok_or("Retain failed")?;
                let arr: Retained<NSArray<EKCalendar>> =
                    NSArray::from_retained_slice(&[retained]);
                unsafe {
                    store_arc.0.predicateForEventsWithStartDate_endDate_calendars(
                        &start_date,
                        &end_date,
                        Some(&arr),
                    )
                }
            }
            None => return Ok(vec![]),
        };

        let events: Retained<NSArray<EKEvent>> =
            unsafe { store_arc.0.eventsMatchingPredicate(&pred) };

        let mut result = Vec::new();
        for ev in &events {
            let id = unsafe { ev.eventIdentifier() }
                .as_deref()
                .map(|s| s.to_string())
                .unwrap_or_else(|| uuid_like(&calendar_id));
            let title = unsafe { ev.title() }.to_string();
            let is_all_day = unsafe { ev.isAllDay() };
            let start_ts = unsafe { ev.startDate() }.timeIntervalSince1970();
            let end_ts = unsafe { ev.endDate() }.timeIntervalSince1970();
            let location = unsafe { ev.location() }
                .as_deref()
                .map(|s| s.to_string())
                .filter(|s| !s.is_empty());
            let notes = unsafe { ev.notes() }
                .as_deref()
                .map(|s| s.to_string())
                .filter(|s| !s.is_empty());

            let start_iso = if is_all_day {
                // For all-day events, emit a date string without time
                let ts = start_ts as i64;
                let days = ts / 86400;
                let jd = days + 2440588;
                let l = jd + 68569;
                let n = (4 * l) / 146097;
                let l = l - (146097 * n + 3) / 4;
                let i = (4000 * (l + 1)) / 1461001;
                let l = l - (1461 * i) / 4 + 31;
                let j = (80 * l) / 2447;
                let day = l - (2447 * j) / 80;
                let lx = j / 11;
                let month = j + 2 - 12 * lx;
                let year = 100 * (n - 49) + i + lx;
                format!("{:04}-{:02}-{:02}", year, month, day)
            } else {
                ts_to_iso(start_ts)
            };
            let end_iso = if is_all_day {
                let ts = end_ts as i64;
                let days = ts / 86400;
                let jd = days + 2440588;
                let l = jd + 68569;
                let n = (4 * l) / 146097;
                let l = l - (146097 * n + 3) / 4;
                let i = (4000 * (l + 1)) / 1461001;
                let l = l - (1461 * i) / 4 + 31;
                let j = (80 * l) / 2447;
                let day = l - (2447 * j) / 80;
                let lx = j / 11;
                let month = j + 2 - 12 * lx;
                let year = 100 * (n - 49) + i + lx;
                format!("{:04}-{:02}-{:02}", year, month, day)
            } else {
                ts_to_iso(end_ts)
            };

            let attendees = extract_attendees(&ev);

            result.push(EKEventInfo {
                id,
                calendar_id: calendar_id.clone(),
                title,
                start: start_iso,
                end: end_iso,
                is_all_day,
                location,
                notes,
                attendees,
            });
        }

        Ok(result)
    }

    /// Creates an event in the given EventKit calendar. Returns the new event's identifier.
    #[tauri::command]
    pub async fn create_eventkit_event(
        state: tauri::State<'_, EventKitState>,
        payload: CreateEKEventPayload,
    ) -> Result<String, String> {
        let store_arc = state.store.clone();

        // Find the target calendar
        let all_cals: Retained<NSArray<EKCalendar>> =
            unsafe { store_arc.0.calendarsForEntityType(EKEntityType::Event) };

        let target_cal = all_cals
            .iter()
            .find(|c| unsafe { c.calendarIdentifier() }.to_string() == payload.calendar_id)
            .map(|c| {
                unsafe { Retained::retain(&*c as *const EKCalendar as *mut EKCalendar) }
                    .ok_or("Retain failed")
            })
            .transpose()?
            .ok_or_else(|| format!("Calendrier introuvable : {}", payload.calendar_id))?;

        let start_ts = iso_to_ts(&payload.start)?;
        let end_ts = iso_to_ts(&payload.end)?;

        let event = unsafe { EKEvent::eventWithEventStore(&store_arc.0) };
        unsafe {
            event.setTitle(Some(&NSString::from_str(&payload.title)));
            event.setAllDay(payload.is_all_day);
            event.setStartDate(Some(&NSDate::dateWithTimeIntervalSince1970(start_ts)));
            event.setEndDate(Some(&NSDate::dateWithTimeIntervalSince1970(end_ts)));
            event.setCalendar(Some(&target_cal));
            if let Some(loc) = &payload.location {
                if !loc.is_empty() {
                    event.setLocation(Some(&NSString::from_str(loc)));
                }
            }
            // Build the final notes string, appending attendees if provided
            // (EKParticipant has no public initialiser in the EventKit API, so
            //  attendees are recorded as plain text in the notes field.)
            let final_notes: Option<String> = {
                let base = payload.notes.as_deref().unwrap_or("").trim().to_string();
                let attendees = payload.attendees.as_deref().unwrap_or(&[]);
                if attendees.is_empty() {
                    if base.is_empty() { None } else { Some(base) }
                } else {
                    let list: String = attendees
                        .iter()
                        .map(|a| match &a.name {
                            Some(n) if !n.is_empty() && n != &a.email => {
                                format!("• {} <{}>", n, a.email)
                            }
                            _ => format!("• {}", a.email),
                        })
                        .collect::<Vec<_>>()
                        .join("\n");
                    let section = format!("Participants :\n{}", list);
                    if base.is_empty() {
                        Some(section)
                    } else {
                        Some(format!("{}\n\n{}", base, section))
                    }
                }
            };
            if let Some(notes) = &final_notes {
                event.setNotes(Some(&NSString::from_str(notes)));
            }
        }

        unsafe { store_arc.0.saveEvent_span_commit_error(&event, EKSpan::ThisEvent, true) }
            .map_err(|e| e.localizedDescription().to_string())?;

        let event_id = unsafe { event.eventIdentifier() }
            .as_deref()
            .map(|s| s.to_string())
            .unwrap_or_default();

        Ok(event_id)
    }

    /// Updates an existing EventKit event identified by its eventIdentifier.
    #[tauri::command]
    pub async fn update_eventkit_event(
        state: tauri::State<'_, EventKitState>,
        payload: UpdateEKEventPayload,
    ) -> Result<(), String> {
        let store_arc = state.store.clone();

        let ns_id = NSString::from_str(&payload.event_id);
        let event = unsafe { store_arc.0.eventWithIdentifier(&ns_id) }
            .ok_or_else(|| format!("Événement introuvable : {}", payload.event_id))?;

        let start_ts = iso_to_ts(&payload.start)?;
        let end_ts = iso_to_ts(&payload.end)?;

        unsafe {
            event.setTitle(Some(&NSString::from_str(&payload.title)));
            event.setAllDay(payload.is_all_day);
            event.setStartDate(Some(&NSDate::dateWithTimeIntervalSince1970(start_ts)));
            event.setEndDate(Some(&NSDate::dateWithTimeIntervalSince1970(end_ts)));
            let loc_ns = payload.location.as_deref()
                .filter(|s| !s.is_empty())
                .map(|s| NSString::from_str(s));
            event.setLocation(loc_ns.as_deref());

            let final_notes: Option<String> = {
                let base = payload.notes.as_deref().unwrap_or("").trim().to_string();
                let attendees = payload.attendees.as_deref().unwrap_or(&[]);
                if attendees.is_empty() {
                    if base.is_empty() { None } else { Some(base) }
                } else {
                    let list: String = attendees
                        .iter()
                        .map(|a| match &a.name {
                            Some(n) if !n.is_empty() && n != &a.email => {
                                format!("• {} <{}>", n, a.email)
                            }
                            _ => format!("• {}", a.email),
                        })
                        .collect::<Vec<_>>()
                        .join("\n");
                    let section = format!("Participants :\n{}", list);
                    if base.is_empty() { Some(section) } else { Some(format!("{}\n\n{}", base, section)) }
                }
            };
            let notes_ns = final_notes.as_deref().map(|s| NSString::from_str(s));
            event.setNotes(notes_ns.as_deref());
        }

        unsafe { store_arc.0.saveEvent_span_commit_error(&event, EKSpan::ThisEvent, true) }
            .map_err(|e| e.localizedDescription().to_string())?;

        Ok(())
    }

    fn uuid_like(seed: &str) -> String {
        let h: u64 = seed
            .bytes()
            .fold(0xcbf29ce484222325u64, |acc, b| {
                acc.wrapping_mul(0x100000001b3).wrapping_add(b as u64)
            });
        format!("ek-{:016x}", h)
    }
}

// ── App entry point ───────────────────────────────────────────────────────────

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let oauth_state = OAuthState { rx: Mutex::new(None) };

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
                tauri::generate_handler![fetch_ics, fetch_url_with_auth, put_caldav_event, fetch_caldav_status, open_url, start_oauth_listener, wait_oauth_code]
            }
            #[cfg(target_os = "macos")]
            {
                tauri::generate_handler![
                    fetch_ics,
                    fetch_url_with_auth,
                    put_caldav_event,
                    fetch_caldav_status,
                    open_url,
                    start_oauth_listener,
                    wait_oauth_code,
                    eventkit::check_eventkit_status,
                    eventkit::request_eventkit_access,
                    eventkit::list_eventkit_calendars,
                    eventkit::fetch_eventkit_events,
                    eventkit::create_eventkit_event,
                    eventkit::update_eventkit_event,
                ]
            }
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
