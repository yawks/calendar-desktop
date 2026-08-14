use axum::{extract::{Query, State}, http::{header, HeaderMap, StatusCode}, response::{Html, IntoResponse, Redirect}, Json};
use serde::{Deserialize, Serialize};
use std::{collections::HashMap, sync::Arc};
use tokio::sync::Mutex;

const AUTH_URL: &str = "https://accounts.google.com/o/oauth2/v2/auth";
const TOKEN_URL: &str = "https://oauth2.googleapis.com/token";
const USERINFO_URL: &str = "https://www.googleapis.com/oauth2/v2/userinfo";

#[derive(Clone, Default)]
pub struct GoogleOAuthState { pending: Arc<Mutex<HashMap<String, Credentials>>> }

#[derive(Clone)]
struct Credentials { client_id: String, client_secret: String }

#[derive(Deserialize)]
pub struct StartQuery { capabilities: Option<String> }

#[derive(Deserialize)]
pub struct StartRequest { capabilities: Option<Vec<String>>, client_id: Option<String>, client_secret: Option<String> }

#[derive(Deserialize)]
pub struct CallbackQuery { code: Option<String>, state: String, error: Option<String> }

#[derive(Deserialize)]
pub struct RefreshRequest { refresh_token: String, client_id: Option<String>, client_secret: Option<String> }

#[derive(Deserialize)]
struct Tokens { access_token: String, refresh_token: Option<String>, expires_in: u64 }

#[derive(Deserialize)]
struct Profile { email: String, name: String, picture: Option<String> }

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct Account { email: String, name: String, picture: Option<String>, access_token: String, refresh_token: String, expires_at: u64 }

fn credentials() -> Result<Credentials, StatusCode> {
    let client_id = std::env::var("COURRIER_GOOGLE_CLIENT_ID").map_err(|_| StatusCode::SERVICE_UNAVAILABLE)?;
    let client_secret = std::env::var("COURRIER_GOOGLE_CLIENT_SECRET").map_err(|_| StatusCode::SERVICE_UNAVAILABLE)?;
    if client_id.trim().is_empty() || client_secret.trim().is_empty() { return Err(StatusCode::SERVICE_UNAVAILABLE); }
    Ok(Credentials { client_id, client_secret })
}

pub async fn configuration() -> Json<serde_json::Value> {
    Json(serde_json::json!({ "configured": credentials().is_ok() }))
}

fn redirect_uri(headers: &HeaderMap) -> String {
    std::env::var("COURRIER_GOOGLE_REDIRECT_URI").ok().filter(|value| !value.trim().is_empty()).unwrap_or_else(|| {
        let host = headers.get("x-forwarded-host").or_else(|| headers.get("host")).and_then(|value| value.to_str().ok()).unwrap_or("localhost:8080");
        let scheme = headers.get("x-forwarded-proto").and_then(|value| value.to_str().ok()).unwrap_or("http");
        format!("{scheme}://{host}/auth/google/callback")
    })
}

pub async fn start(State(state): State<GoogleOAuthState>, headers: HeaderMap, Query(query): Query<StartQuery>) -> Result<Redirect, StatusCode> {
    let credentials = credentials()?;
    let url = authorization_url(&state, &headers, query.capabilities.unwrap_or_else(|| "calendar,email".into()), credentials).await?;
    Ok(Redirect::temporary(&url))
}

pub async fn prepare(State(state): State<GoogleOAuthState>, headers: HeaderMap, Json(request): Json<StartRequest>) -> Result<Json<serde_json::Value>, StatusCode> {
    let credentials = match (request.client_id, request.client_secret) {
        (Some(client_id), Some(client_secret)) if !client_id.trim().is_empty() && !client_secret.trim().is_empty() => Credentials { client_id, client_secret },
        (None, None) => credentials()?,
        _ => return Err(StatusCode::BAD_REQUEST),
    };
    let capabilities = request.capabilities.unwrap_or_else(|| vec!["calendar".into(), "email".into()]).join(",");
    let url = authorization_url(&state, &headers, capabilities, credentials).await?;
    Ok(Json(serde_json::json!({ "authorizationUrl": url })))
}

async fn authorization_url(state: &GoogleOAuthState, headers: &HeaderMap, capabilities: String, credentials: Credentials) -> Result<String, StatusCode> {
    let mut random = [0_u8; 24];
    getrandom::getrandom(&mut random).map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;
    let oauth_state = random.iter().map(|byte| format!("{byte:02x}")).collect::<String>();
    let client_id = credentials.client_id.clone();
    state.pending.lock().await.insert(oauth_state.clone(), credentials);
    let mut scopes = vec!["openid", "email", "profile"];
    if capabilities.split(',').any(|value| value == "calendar") { scopes.push("https://www.googleapis.com/auth/calendar"); }
    if capabilities.split(',').any(|value| value == "email") { scopes.extend(["https://mail.google.com/", "https://www.googleapis.com/auth/contacts.readonly", "https://www.googleapis.com/auth/contacts.other.readonly"]); }
    let params = [("client_id", client_id), ("redirect_uri", redirect_uri(&headers)), ("response_type", "code".into()), ("scope", scopes.join(" ")), ("access_type", "offline".into()), ("prompt", "consent".into()), ("state", oauth_state)];
    let url = format!("{AUTH_URL}?{}", serde_urlencoded::to_string(params).map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?);
    Ok(url)
}

pub async fn callback(State(state): State<GoogleOAuthState>, headers: HeaderMap, Query(query): Query<CallbackQuery>) -> impl IntoResponse {
    let Some(credentials) = state.pending.lock().await.remove(&query.state) else { return (StatusCode::BAD_REQUEST, Html(oauth_html("google-oauth-error", serde_json::json!({ "error": "invalid_state" })))); };
    if let Some(error) = query.error { return (StatusCode::BAD_REQUEST, Html(oauth_html("google-oauth-error", serde_json::json!({ "error": error })))); }
    let result = async {
        let client_id = credentials.client_id;
        let client_secret = credentials.client_secret;
        let callback_url = redirect_uri(&headers);
        let response = reqwest::Client::new().post(TOKEN_URL).form(&[("client_id", client_id.as_str()), ("client_secret", client_secret.as_str()), ("code", query.code.as_deref().unwrap_or_default()), ("redirect_uri", callback_url.as_str()), ("grant_type", "authorization_code")]).send().await.map_err(|error| error.to_string())?;
        let tokens: Tokens = response.json().await.map_err(|error| error.to_string())?;
        let profile: Profile = reqwest::Client::new().get(USERINFO_URL).bearer_auth(&tokens.access_token).send().await.map_err(|error| error.to_string())?.json().await.map_err(|error| error.to_string())?;
        Ok::<_, String>(Account { email: profile.email, name: profile.name, picture: profile.picture, access_token: tokens.access_token, refresh_token: tokens.refresh_token.unwrap_or_default(), expires_at: now_ms() + tokens.expires_in.saturating_sub(60) * 1000 })
    }.await;
    match result {
        Ok(account) => (StatusCode::OK, Html(oauth_html("google-oauth-success", serde_json::json!({ "account": account })))),
        Err(error) => (StatusCode::BAD_GATEWAY, Html(oauth_html("google-oauth-error", serde_json::json!({ "error": error })))),
    }
}

pub async fn refresh(Json(request): Json<RefreshRequest>) -> Result<Json<serde_json::Value>, StatusCode> {
    let credentials = match (request.client_id, request.client_secret) {
        (Some(client_id), Some(client_secret)) if !client_id.trim().is_empty() && !client_secret.trim().is_empty() => Credentials { client_id, client_secret },
        (None, None) => credentials()?,
        _ => return Err(StatusCode::BAD_REQUEST),
    };
    let client_id = credentials.client_id;
    let client_secret = credentials.client_secret;
    let tokens: Tokens = reqwest::Client::new().post(TOKEN_URL).form(&[("client_id", client_id.as_str()), ("client_secret", client_secret.as_str()), ("refresh_token", request.refresh_token.as_str()), ("grant_type", "refresh_token")]).send().await.map_err(|_| StatusCode::BAD_GATEWAY)?.json().await.map_err(|_| StatusCode::BAD_GATEWAY)?;
    Ok(Json(serde_json::json!({ "access_token": tokens.access_token, "expires_at": now_ms() + tokens.expires_in.saturating_sub(60) * 1000 })))
}

fn now_ms() -> u64 { std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).unwrap_or_default().as_millis() as u64 }
fn oauth_html(kind: &str, payload: serde_json::Value) -> String {
    let message = serde_json::json!({ "type": kind, "account": payload.get("account"), "error": payload.get("error") }).to_string().replace('<', "\\u003c");
    format!(r#"<!doctype html><meta charset="utf-8"><div id="oauth-result" hidden>{message}</div><script src="/auth/google/complete.js"></script>"#)
}

pub async fn complete_script() -> impl IntoResponse {
    (
        [(header::CONTENT_TYPE, "application/javascript; charset=utf-8")],
        r#"const node=document.getElementById('oauth-result');try{const message=JSON.parse(node?.textContent||'{}');window.opener?.postMessage(message,window.location.origin)}finally{window.close()}"#,
    )
}
