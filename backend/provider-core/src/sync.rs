//! Provider-neutral new-mail detection.
//!
//! This module intentionally has no Axum or desktop-runtime dependency so it can
//! be called by the HTTP adapter today and by native Android/desktop bindings.

use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::sync::Arc;

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SyncRequest {
    pub provider: String,
    pub credentials: Value,
    pub cursor: Option<String>,
    pub max_count: Option<u32>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SyncResponse {
    pub cursor: String,
    pub messages: Vec<SyncMessage>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub credential_update: Option<Value>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SyncMessage {
    pub id: String,
    pub conversation_id: String,
    pub sender: String,
    pub subject: String,
    pub received_at: String,
}

#[derive(Debug)]
pub struct SyncError {
    pub code: &'static str,
    pub kind: SyncErrorKind,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum SyncErrorKind {
    InvalidRequest,
    Unauthorized,
    Unavailable,
    Upstream,
    Internal,
}

impl SyncError {
    fn invalid(code: &'static str) -> Self {
        Self {
            code,
            kind: SyncErrorKind::InvalidRequest,
        }
    }
    fn unauthorized(code: &'static str) -> Self {
        Self {
            code,
            kind: SyncErrorKind::Unauthorized,
        }
    }
    fn unavailable(code: &'static str) -> Self {
        Self {
            code,
            kind: SyncErrorKind::Unavailable,
        }
    }
    fn upstream() -> Self {
        Self {
            code: "provider_request_failed",
            kind: SyncErrorKind::Upstream,
        }
    }
    fn internal(code: &'static str) -> Self {
        Self {
            code,
            kind: SyncErrorKind::Internal,
        }
    }
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

pub async fn detect(request: SyncRequest) -> Result<SyncResponse, SyncError> {
    let limit = request.max_count.unwrap_or(50).clamp(1, 100);
    let previous_cursor = request.cursor.as_deref().and_then(decode_cursor);
    let (snapshot, credential_update) = match request.provider.as_str() {
        "imap" => (detect_imap(request.credentials, limit).await?, None),
        "jmap" => (detect_jmap(request.credentials, limit).await?, None),
        "exchange" => detect_exchange(request.credentials, limit).await?,
        "gmail" => detect_gmail(request.credentials, limit).await?,
        _ => return Err(SyncError::invalid("unsupported_provider")),
    };
    let cursor = serde_json::to_string(
        &snapshot
            .iter()
            .map(|message| message.id.as_str())
            .collect::<Vec<_>>(),
    )
    .map_err(|_| SyncError::internal("cursor_serialization_failed"))?;
    let messages = match previous_cursor {
        Some(previous) => snapshot
            .into_iter()
            .filter(|message| !previous.contains(&message.id))
            .collect(),
        None => snapshot,
    };
    Ok(SyncResponse {
        cursor,
        messages,
        credential_update,
    })
}

fn decode_cursor(value: &str) -> Option<Vec<String>> {
    serde_json::from_str(value).ok()
}

async fn detect_imap(credentials: Value, limit: u32) -> Result<Vec<SyncMessage>, SyncError> {
    let config: crate::imap::ImapConfig = serde_json::from_value(credentials)
        .map_err(|_| SyncError::invalid("invalid_imap_credentials"))?;
    Ok(canonical(
        crate::imap::imap_list_threads(config, "INBOX".into(), Some(limit), Some(0))
            .await
            .map_err(|_| SyncError::upstream())?,
    ))
}

async fn detect_jmap(credentials: Value, limit: u32) -> Result<Vec<SyncMessage>, SyncError> {
    let config: crate::jmap::JmapConfig = serde_json::from_value(credentials)
        .map_err(|_| SyncError::invalid("invalid_jmap_credentials"))?;
    let state = Arc::new(crate::jmap::JmapClientState::new());
    Ok(canonical(
        crate::jmap::jmap_list_threads(&state, config, "inbox".into(), Some(limit), Some(0))
            .await
            .map_err(|_| SyncError::upstream())?,
    ))
}

async fn detect_exchange(
    credentials: Value,
    limit: u32,
) -> Result<(Vec<SyncMessage>, Option<Value>), SyncError> {
    let mut auth: OAuthCredentials = serde_json::from_value(credentials)
        .map_err(|_| SyncError::invalid("invalid_exchange_credentials"))?;
    let mut update = None;
    if token_expired(auth.expires_at) {
        let refresh = auth
            .refresh_token
            .as_deref()
            .ok_or_else(|| SyncError::unauthorized("reauthorization_required"))?;
        let token = refresh_microsoft(refresh).await?;
        apply_token(&mut auth, token);
        update = Some(oauth_update(&auth));
    }
    let threads = crate::mail::mail_list_threads(
        auth.access_token,
        "inbox".into(),
        Some(limit),
        Some(0),
        auth.email,
    )
    .await
    .map_err(|_| SyncError::upstream())?;
    Ok((canonical(threads), update))
}

async fn detect_gmail(
    credentials: Value,
    limit: u32,
) -> Result<(Vec<SyncMessage>, Option<Value>), SyncError> {
    let mut auth: OAuthCredentials = serde_json::from_value(credentials)
        .map_err(|_| SyncError::invalid("invalid_gmail_credentials"))?;
    let mut update = None;
    if token_expired(auth.expires_at) {
        let token = refresh_google(&auth).await?;
        apply_token(&mut auth, token);
        update = Some(oauth_update(&auth));
    }
    let client = reqwest::Client::new();
    let list = google_get(&client, &auth.access_token, &format!(
        "https://gmail.googleapis.com/gmail/v1/users/me/messages?labelIds=INBOX&q=is%3Aunread&maxResults={limit}"
    )).await?;
    let mut messages = Vec::new();
    for item in list
        .get("messages")
        .and_then(Value::as_array)
        .into_iter()
        .flatten()
    {
        let Some(id) = item.get("id").and_then(Value::as_str) else {
            continue;
        };
        let detail = google_get(&client, &auth.access_token, &format!(
            "https://gmail.googleapis.com/gmail/v1/users/me/messages/{id}?format=metadata&metadataHeaders=Subject&metadataHeaders=From"
        )).await?;
        let headers = detail.pointer("/payload/headers").and_then(Value::as_array);
        let header = |name: &str| {
            headers
                .into_iter()
                .flatten()
                .find(|entry| {
                    entry
                        .get("name")
                        .and_then(Value::as_str)
                        .is_some_and(|value| value.eq_ignore_ascii_case(name))
                })
                .and_then(|entry| entry.get("value"))
                .and_then(Value::as_str)
                .unwrap_or_default()
                .to_string()
        };
        messages.push(SyncMessage {
            id: id.into(),
            conversation_id: detail
                .get("threadId")
                .and_then(Value::as_str)
                .unwrap_or(id)
                .into(),
            sender: header("From"),
            subject: header("Subject"),
            received_at: detail
                .get("internalDate")
                .and_then(Value::as_str)
                .unwrap_or_default()
                .into(),
        });
    }
    Ok((messages, update))
}

fn canonical(threads: Vec<crate::mail_provider::MailThread>) -> Vec<SyncMessage> {
    threads
        .into_iter()
        .filter(|thread| thread.unread_count > 0)
        .map(|thread| SyncMessage {
            id: format!("{}:{}", thread.conversation_id, thread.last_delivery_time),
            conversation_id: thread.conversation_id,
            sender: thread.from_name.or(thread.from_email).unwrap_or_default(),
            subject: thread.topic,
            received_at: thread.last_delivery_time,
        })
        .collect()
}

async fn google_get(client: &reqwest::Client, token: &str, url: &str) -> Result<Value, SyncError> {
    let response = client
        .get(url)
        .bearer_auth(token)
        .send()
        .await
        .map_err(|_| SyncError::upstream())?;
    if !response.status().is_success() {
        return Err(if response.status().as_u16() == 401 {
            SyncError::unauthorized("gmail_request_failed")
        } else {
            SyncError::upstream()
        });
    }
    response.json().await.map_err(|_| SyncError::upstream())
}

async fn refresh_google(auth: &OAuthCredentials) -> Result<TokenReply, SyncError> {
    let refresh_token = auth
        .refresh_token
        .as_deref()
        .ok_or_else(|| SyncError::unauthorized("reauthorization_required"))?;
    let client_id = auth
        .client_id
        .clone()
        .or_else(|| std::env::var("COURRIER_GOOGLE_CLIENT_ID").ok())
        .filter(|value| !value.trim().is_empty())
        .ok_or_else(|| SyncError::unavailable("google_oauth_not_configured"))?;
    let client_secret = auth
        .client_secret
        .clone()
        .or_else(|| std::env::var("COURRIER_GOOGLE_CLIENT_SECRET").ok())
        .unwrap_or_default();
    let response = reqwest::Client::new()
        .post("https://oauth2.googleapis.com/token")
        .form(&[
            ("client_id", client_id.as_str()),
            ("client_secret", client_secret.as_str()),
            ("refresh_token", refresh_token),
            ("grant_type", "refresh_token"),
        ])
        .send()
        .await
        .map_err(|_| SyncError::upstream())?;
    if !response.status().is_success() {
        return Err(SyncError::unauthorized("reauthorization_required"));
    }
    response.json().await.map_err(|_| SyncError::upstream())
}

async fn refresh_microsoft(refresh_token: &str) -> Result<TokenReply, SyncError> {
    let client_id = std::env::var("COURRIER_MICROSOFT_CLIENT_ID")
        .unwrap_or_else(|_| "d3590ed6-52b3-4102-aeff-aad2292ab01c".into());
    let response = reqwest::Client::new()
        .post("https://login.microsoftonline.com/common/oauth2/v2.0/token")
        .form(&[
            ("client_id", client_id.as_str()),
            ("grant_type", "refresh_token"),
            ("refresh_token", refresh_token),
            (
                "scope",
                "https://outlook.office.com/EWS.AccessAsUser.All offline_access",
            ),
        ])
        .send()
        .await
        .map_err(|_| SyncError::upstream())?;
    if !response.status().is_success() {
        return Err(SyncError::unauthorized("reauthorization_required"));
    }
    response.json().await.map_err(|_| SyncError::upstream())
}

fn apply_token(auth: &mut OAuthCredentials, token: TokenReply) {
    auth.access_token = token.access_token;
    auth.expires_at = Some(expiry(token.expires_in));
    if token.refresh_token.is_some() {
        auth.refresh_token = token.refresh_token;
    }
}

fn oauth_update(auth: &OAuthCredentials) -> Value {
    serde_json::json!({ "accessToken": &auth.access_token, "refreshToken": &auth.refresh_token, "expiresAt": &auth.expires_at })
}

fn token_expired(expires_at: Option<u64>) -> bool {
    expires_at.is_some_and(|value| value <= now_ms() + 60_000)
}
fn expiry(expires_in: Option<u64>) -> u64 {
    now_ms() + expires_in.unwrap_or(3600).saturating_sub(60) * 1000
}
fn now_ms() -> u64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis() as u64
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

    #[tokio::test]
    async fn rejects_unknown_provider_without_echoing_credentials() {
        let result = detect(SyncRequest {
            provider: "unknown".into(),
            credentials: serde_json::json!({ "password": "secret" }),
            cursor: None,
            max_count: None,
        })
        .await
        .unwrap_err();
        assert_eq!(result.kind, SyncErrorKind::InvalidRequest);
        assert_eq!(result.code, "unsupported_provider");
    }
}
