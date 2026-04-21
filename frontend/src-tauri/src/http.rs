// ── ICS fetch ─────────────────────────────────────────────────────────────────

#[tauri::command]
pub async fn fetch_ics(url: String) -> Result<String, String> {
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
pub async fn fetch_url_with_auth(url: String, username: String, password: String) -> Result<String, String> {
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
pub async fn put_caldav_event(url: String, username: String, password: String, ics_content: String) -> Result<(), String> {
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

/// HTTP DELETE with Basic Auth — used to delete a CalDAV event resource.
#[tauri::command]
pub async fn delete_caldav_event(url: String, username: String, password: String) -> Result<(), String> {
    let client = reqwest::Client::builder()
        .user_agent("CalendarApp/1.0")
        .timeout(std::time::Duration::from_secs(30))
        .build()
        .map_err(|e| e.to_string())?;

    let response = client
        .delete(&url)
        .basic_auth(&username, Some(&password))
        .send()
        .await
        .map_err(|e| format!("Erreur réseau : {}", e))?;

    let status = response.status();
    // 204 No Content and 404 Not Found are both acceptable outcomes
    if !status.is_success() && status.as_u16() != 404 {
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
pub async fn fetch_caldav_status(url: String, username: String, password: String) -> Result<u16, String> {
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
