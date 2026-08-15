use axum::{http::StatusCode, Json};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::sync::Arc;

type SyncResult = Result<Json<SyncResponse>, (StatusCode, Json<Value>)>;

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SyncRequest {
    provider: String,
    credentials: Value,
    cursor: Option<String>,
    max_count: Option<u32>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SyncResponse {
    cursor: String,
    messages: Vec<SyncMessage>,
    #[serde(skip_serializing_if = "Option::is_none")]
    credential_update: Option<Value>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct SyncMessage {
    id: String,
    conversation_id: String,
    sender: String,
    subject: String,
    received_at: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct OAuthCredentials {
    access_token: String,
    refresh_token: Option<String>,
    expires_at: Option<u64>,
    email: Option<String>,
    client_id: Option<String>,
    client_secret: Option<String>,
}

#[derive(Deserialize)]
struct TokenReply {
    access_token: String,
    refresh_token: Option<String>,
    expires_in: Option<u64>,
}

pub async fn detect(Json(request): Json<SyncRequest>) -> SyncResult {
    let limit = request.max_count.unwrap_or(50).clamp(1, 100);
    let previous_cursor = request.cursor.as_deref().and_then(decode_cursor);
    let (snapshot, credential_update) = match request.provider.as_str() {
        "imap" => (detect_imap(request.credentials, limit).await?, None),
        "jmap" => (detect_jmap(request.credentials, limit).await?, None),
        "exchange" => detect_exchange(request.credentials, limit).await?,
        "gmail" => detect_gmail(request.credentials, limit).await?,
        _ => return failure(StatusCode::BAD_REQUEST, "unsupported_provider"),
    };
    let cursor = serde_json::to_string(&snapshot.iter().map(|message| message.id.as_str()).collect::<Vec<_>>())
        .map_err(|_| api_error(StatusCode::INTERNAL_SERVER_ERROR, "cursor_serialization_failed"))?;
    let messages = match previous_cursor {
        Some(previous) => snapshot.into_iter().filter(|message| !previous.contains(&message.id)).collect(),
        None => snapshot,
    };
    Ok(Json(SyncResponse { cursor, messages, credential_update }))
}

fn decode_cursor(value: &str) -> Option<Vec<String>> {
    serde_json::from_str(value).ok()
}

async fn detect_imap(credentials: Value, limit: u32) -> Result<Vec<SyncMessage>, (StatusCode, Json<Value>)> {
    let config: app_lib::imap::ImapConfig = serde_json::from_value(credentials)
        .map_err(|_| api_error(StatusCode::BAD_REQUEST, "invalid_imap_credentials"))?;
    let threads = app_lib::imap::imap_list_threads(config, "INBOX".into(), Some(limit), Some(0))
        .await.map_err(upstream)?;
    Ok(canonical(threads))
}

async fn detect_jmap(credentials: Value, limit: u32) -> Result<Vec<SyncMessage>, (StatusCode, Json<Value>)> {
    let config: app_lib::jmap::JmapConfig = serde_json::from_value(credentials)
        .map_err(|_| api_error(StatusCode::BAD_REQUEST, "invalid_jmap_credentials"))?;
    // A request-scoped state prevents account tokens from remaining cached server-side.
    let state = Arc::new(app_lib::jmap::JmapClientState::new());
    let threads = app_lib::jmap::jmap_list_threads(&state, config, "inbox".into(), Some(limit), Some(0))
        .await.map_err(upstream)?;
    Ok(canonical(threads))
}

async fn detect_exchange(credentials: Value, limit: u32) -> Result<(Vec<SyncMessage>, Option<Value>), (StatusCode, Json<Value>)> {
    let mut auth: OAuthCredentials = serde_json::from_value(credentials)
        .map_err(|_| api_error(StatusCode::BAD_REQUEST, "invalid_exchange_credentials"))?;
    let mut update = None;
    if token_expired(auth.expires_at) {
        let token = refresh_microsoft(auth.refresh_token.as_deref().ok_or_else(|| api_error(StatusCode::UNAUTHORIZED, "reauthorization_required"))?).await?;
        auth.access_token = token.access_token;
        auth.expires_at = Some(expiry(token.expires_in));
        if token.refresh_token.is_some() { auth.refresh_token = token.refresh_token; }
        update = Some(oauth_update(&auth));
    }
    let threads = app_lib::mail::mail_list_threads(auth.access_token, "inbox".into(), Some(limit), Some(0), auth.email)
        .await.map_err(upstream)?;
    Ok((canonical(threads), update))
}

async fn detect_gmail(credentials: Value, limit: u32) -> Result<(Vec<SyncMessage>, Option<Value>), (StatusCode, Json<Value>)> {
    let mut auth: OAuthCredentials = serde_json::from_value(credentials)
        .map_err(|_| api_error(StatusCode::BAD_REQUEST, "invalid_gmail_credentials"))?;
    let mut update = None;
    if token_expired(auth.expires_at) {
        let token = refresh_google(&auth).await?;
        auth.access_token = token.access_token;
        auth.expires_at = Some(expiry(token.expires_in));
        if token.refresh_token.is_some() { auth.refresh_token = token.refresh_token; }
        update = Some(oauth_update(&auth));
    }
    let client = reqwest::Client::new();
    let list: Value = google_get(&client, &auth.access_token, &format!(
        "https://gmail.googleapis.com/gmail/v1/users/me/messages?labelIds=INBOX&q=is%3Aunread&maxResults={limit}"
    )).await?;
    let mut messages = Vec::new();
    for item in list.get("messages").and_then(Value::as_array).into_iter().flatten() {
        let Some(id) = item.get("id").and_then(Value::as_str) else { continue };
        let detail: Value = google_get(&client, &auth.access_token, &format!(
            "https://gmail.googleapis.com/gmail/v1/users/me/messages/{id}?format=metadata&metadataHeaders=Subject&metadataHeaders=From"
        )).await?;
        let headers = detail.pointer("/payload/headers").and_then(Value::as_array);
        let header = |name: &str| headers.into_iter().flatten().find(|entry| {
            entry.get("name").and_then(Value::as_str).is_some_and(|value| value.eq_ignore_ascii_case(name))
        }).and_then(|entry| entry.get("value")).and_then(Value::as_str).unwrap_or_default().to_string();
        messages.push(SyncMessage {
            id: id.into(),
            conversation_id: detail.get("threadId").and_then(Value::as_str).unwrap_or(id).into(),
            sender: header("From"),
            subject: header("Subject"),
            received_at: detail.get("internalDate").and_then(Value::as_str).unwrap_or_default().into(),
        });
    }
    Ok((messages, update))
}

fn canonical(threads: Vec<app_lib::mail_provider::MailThread>) -> Vec<SyncMessage> {
    threads.into_iter().filter(|thread| thread.unread_count > 0).map(|thread| SyncMessage {
        id: format!("{}:{}", thread.conversation_id, thread.last_delivery_time),
        conversation_id: thread.conversation_id,
        sender: thread.from_name.or(thread.from_email).unwrap_or_default(),
        subject: thread.topic,
        received_at: thread.last_delivery_time,
    }).collect()
}

async fn google_get(client: &reqwest::Client, token: &str, url: &str) -> Result<Value, (StatusCode, Json<Value>)> {
    let response = client.get(url).bearer_auth(token).send().await.map_err(upstream)?;
    let status = response.status();
    if !status.is_success() {
        return Err(api_error(if status.as_u16() == 401 { StatusCode::UNAUTHORIZED } else { StatusCode::BAD_GATEWAY }, "gmail_request_failed"));
    }
    response.json().await.map_err(upstream)
}

async fn refresh_google(auth: &OAuthCredentials) -> Result<TokenReply, (StatusCode, Json<Value>)> {
    let refresh_token = auth.refresh_token.as_deref().ok_or_else(|| api_error(StatusCode::UNAUTHORIZED, "reauthorization_required"))?;
    let client_id = auth.client_id.clone().or_else(|| std::env::var("COURRIER_GOOGLE_CLIENT_ID").ok())
        .filter(|value| !value.trim().is_empty()).ok_or_else(|| api_error(StatusCode::SERVICE_UNAVAILABLE, "google_oauth_not_configured"))?;
    let client_secret = auth.client_secret.clone().or_else(|| std::env::var("COURRIER_GOOGLE_CLIENT_SECRET").ok()).unwrap_or_default();
    let response = reqwest::Client::new().post("https://oauth2.googleapis.com/token").form(&[
        ("client_id", client_id.as_str()), ("client_secret", client_secret.as_str()),
        ("refresh_token", refresh_token), ("grant_type", "refresh_token"),
    ]).send().await.map_err(upstream)?;
    if !response.status().is_success() { return Err(api_error(StatusCode::UNAUTHORIZED, "reauthorization_required")); }
    response.json().await.map_err(upstream)
}

async fn refresh_microsoft(refresh_token: &str) -> Result<TokenReply, (StatusCode, Json<Value>)> {
    let client_id = std::env::var("COURRIER_MICROSOFT_CLIENT_ID")
        .unwrap_or_else(|_| "d3590ed6-52b3-4102-aeff-aad2292ab01c".into());
    let response = reqwest::Client::new().post("https://login.microsoftonline.com/common/oauth2/v2.0/token").form(&[
        ("client_id", client_id.as_str()), ("grant_type", "refresh_token"), ("refresh_token", refresh_token),
        ("scope", "https://outlook.office.com/EWS.AccessAsUser.All offline_access"),
    ]).send().await.map_err(upstream)?;
    if !response.status().is_success() { return Err(api_error(StatusCode::UNAUTHORIZED, "reauthorization_required")); }
    response.json().await.map_err(upstream)
}

fn oauth_update(auth: &OAuthCredentials) -> Value {
    serde_json::json!({
        "accessToken": &auth.access_token,
        "refreshToken": &auth.refresh_token,
        "expiresAt": &auth.expires_at,
    })
}

fn token_expired(expires_at: Option<u64>) -> bool {
    expires_at.is_some_and(|expiry| expiry <= now_ms() + 60_000)
}

fn expiry(expires_in: Option<u64>) -> u64 {
    now_ms() + expires_in.unwrap_or(3600).saturating_sub(60) * 1000
}

fn now_ms() -> u64 {
    std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).unwrap_or_default().as_millis() as u64
}

fn upstream(_error: impl ToString) -> (StatusCode, Json<Value>) {
    api_error(StatusCode::BAD_GATEWAY, "provider_request_failed")
}

fn api_error(status: StatusCode, code: &str) -> (StatusCode, Json<Value>) {
    (status, Json(serde_json::json!({ "error": code })))
}

fn failure<T>(status: StatusCode, code: &str) -> Result<T, (StatusCode, Json<Value>)> {
    Err(api_error(status, code))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn cursor_round_trip_and_rejects_invalid_cursor() {
        let cursor = serde_json::to_string(&vec!["m1", "m2"]).unwrap();
        assert_eq!(decode_cursor(&cursor), Some(vec!["m1".into(), "m2".into()]));
        assert_eq!(decode_cursor("secret-not-json"), None);
    }

    #[test]
    fn canonical_messages_have_stable_provider_scoped_ids() {
        let threads = vec![app_lib::mail_provider::MailThread {
            conversation_id: "thread".into(), topic: "Subject".into(), snippet: String::new(),
            last_delivery_time: "2026-08-15T10:00:00Z".into(), message_count: 1, unread_count: 1,
            from_name: Some("Sender".into()), from_email: None, has_attachments: false,
            to_recipients: vec![], cc_recipients: vec![], unique_senders: vec![], snoozed_until: None,
        }];
        let result = canonical(threads);
        assert_eq!(result[0].id, "thread:2026-08-15T10:00:00Z");
    }

    #[test]
    fn expired_token_uses_a_safety_window() {
        assert!(token_expired(Some(now_ms())));
        assert!(!token_expired(Some(now_ms() + 120_000)));
    }
    #[tokio::test]
    async fn rejects_unknown_provider_without_echoing_credentials() {
        let result = detect(Json(SyncRequest {
            provider: "unknown".into(),
            credentials: serde_json::json!({ "password": "must-not-appear" }),
            cursor: None,
            max_count: None,
        })).await.unwrap_err();
        assert_eq!(result.0, StatusCode::BAD_REQUEST);
        assert_eq!(result.1.0, serde_json::json!({ "error": "unsupported_provider" }));
        assert!(!result.1.0.to_string().contains("must-not-appear"));
    }
}
