use base64::{
    engine::general_purpose::{STANDARD as BASE64, URL_SAFE_NO_PAD},
    Engine as _,
};
use serde::Deserialize;
use tauri::command;

#[derive(Deserialize)]
struct GmailAttachmentResponse {
    data: String,
}

async fn fetch_gmail_attachment_bytes(
    access_token: &str,
    message_id: &str,
    attachment_id: &str,
) -> Result<(Vec<u8>, String), String> {
    let url = format!(
        "https://www.googleapis.com/gmail/v1/users/me/messages/{}/attachments/{}",
        message_id, attachment_id
    );
    let client = reqwest::Client::new();
    let response = client
        .get(&url)
        .header("Authorization", format!("Bearer {}", access_token))
        .send()
        .await
        .map_err(|e| e.to_string())?;
    if !response.status().is_success() {
        return Err(format!("Gmail API {}: {}", response.status(), response.text().await.unwrap_or_default()));
    }
    let payload: GmailAttachmentResponse = response.json().await.map_err(|e| e.to_string())?;
    // Gmail returns base64url (URL-safe, no padding). Strip any stray whitespace/padding
    // characters and decode with the correct engine.
    let clean: String = payload.data
        .chars()
        .filter(|c| c.is_ascii_alphanumeric() || *c == '-' || *c == '_')
        .collect();
    let bytes = URL_SAFE_NO_PAD
        .decode(&clean)
        .map_err(|e| format!("Base64 decode error: {}", e))?;
    // Re-encode to standard base64 so callers (save_file_to_downloads, preview) can use STANDARD.
    let standard_b64 = BASE64.encode(&bytes);
    Ok((bytes, standard_b64))
}

/// Return the raw standard-base64 content of a Gmail attachment (for in-app preview / download).
#[command]
pub async fn gmail_get_attachment_data(
    access_token: String,
    message_id: String,
    attachment_id: String,
) -> Result<String, String> {
    let (_, b64) = fetch_gmail_attachment_bytes(&access_token, &message_id, &attachment_id).await?;
    Ok(b64)
}

/// Download a Gmail attachment and open it with the system default application.
/// The `attachment_id` stored in the frontend is `messageId:attachmentId` for Gmail;
/// this command receives both separately.
#[command]
pub async fn gmail_open_attachment(
    access_token: String,
    message_id: String,
    attachment_id: String,
    filename: String,
) -> Result<(), String> {
    let (bytes, _) = fetch_gmail_attachment_bytes(&access_token, &message_id, &attachment_id).await?;

    // Sanitise filename and write to the OS temp directory
    let safe_name: String = filename
        .chars()
        .map(|c| if c.is_alphanumeric() || ".-_ ".contains(c) { c } else { '_' })
        .collect();
    let path = std::env::temp_dir().join(&safe_name);
    std::fs::write(&path, &bytes).map_err(|e| format!("Write temp file: {}", e))?;

    // Open with the system default application
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
        .args(["/C", "start", "", path.to_str().unwrap_or("")])
        .spawn()
        .map_err(|e| format!("start: {}", e))?;

    Ok(())
}
