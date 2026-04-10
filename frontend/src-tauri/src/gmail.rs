use base64::{engine::general_purpose::STANDARD as BASE64, Engine as _};
use serde::Deserialize;
use tauri::command;

#[derive(Deserialize)]
struct GmailAttachmentResponse {
    data: String,
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

    // Gmail uses URL-safe base64 (base64url); convert to standard base64 for decoding
    let standard = payload.data.replace('-', "+").replace('_', "/");
    let padding = (4 - standard.len() % 4) % 4;
    let padded = format!("{}{}", standard, "=".repeat(padding));
    let bytes = BASE64
        .decode(&padded)
        .map_err(|e| format!("Base64 decode error: {}", e))?;

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
