use axum::{extract::State, http::{header, StatusCode}, Json};
use reqwest::Client;
use serde::{Deserialize, Serialize};
use std::{collections::HashSet, sync::Arc, time::Duration};
use url::Url;

#[derive(Clone)]
pub struct CalendarHttpState {
    client: Client,
    allowed_hosts: Arc<HashSet<String>>,
}

#[derive(Debug, Serialize)]
pub struct ApiError { error: String }

type ApiResult<T> = Result<Json<T>, (StatusCode, Json<ApiError>)>;

#[derive(Deserialize)]
pub struct UrlRequest { url: String }

#[derive(Deserialize)]
pub struct AuthRequest { url: String, username: String, password: String }

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PutRequest { url: String, username: String, password: String, ics_content: String }
#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ConfigPutRequest { url: String, username: String, password: String, content: String, if_match: Option<String> }

#[derive(Serialize)]
pub struct TextResponse { text: String }

#[derive(Serialize)]
pub struct StatusResponse { status: u16 }
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ConfigResponse { exists: bool, content: Option<String>, etag: Option<String> }

impl CalendarHttpState {
    pub fn from_env() -> Self {
        let allowed_hosts = std::env::var("COURRIER_ALLOWED_PROVIDER_HOSTS")
            .unwrap_or_default().split(',').map(str::trim).filter(|host| !host.is_empty())
            .map(|host| host.to_ascii_lowercase()).collect();
        let client = Client::builder().user_agent("Courrier/0.1")
            .timeout(Duration::from_secs(30)).redirect(reqwest::redirect::Policy::none())
            .build().expect("HTTP provider client");
        Self { client, allowed_hosts: Arc::new(allowed_hosts) }
    }

    fn checked_url(&self, raw: &str) -> Result<Url, (StatusCode, Json<ApiError>)> {
        let url = Url::parse(raw).map_err(|_| bad_request("invalid_provider_url"))?;
        if !matches!(url.scheme(), "http" | "https") || !url.username().is_empty() || url.password().is_some() {
            return Err(bad_request("invalid_provider_url"));
        }
        let host = url.host_str().ok_or_else(|| bad_request("invalid_provider_url"))?.to_ascii_lowercase();
        if self.allowed_hosts.is_empty() || !self.allowed_hosts.contains(&host) {
            return Err((StatusCode::FORBIDDEN, Json(ApiError { error: "provider_host_not_allowed".into() })));
        }
        Ok(url)
    }
}

fn bad_request(message: &str) -> (StatusCode, Json<ApiError>) {
    (StatusCode::BAD_REQUEST, Json(ApiError { error: message.into() }))
}

fn upstream(message: impl ToString) -> (StatusCode, Json<ApiError>) {
    (StatusCode::BAD_GATEWAY, Json(ApiError { error: message.to_string() }))
}

pub async fn fetch_ics(State(state): State<CalendarHttpState>, Json(body): Json<UrlRequest>) -> ApiResult<TextResponse> {
    let url = state.checked_url(&body.url)?;
    let response = state.client.get(url).send().await.map_err(upstream)?;
    if !response.status().is_success() { return Err(upstream(format!("provider_http_{}", response.status().as_u16()))); }
    Ok(Json(TextResponse { text: response.text().await.map_err(upstream)? }))
}

pub async fn fetch_authenticated(State(state): State<CalendarHttpState>, Json(body): Json<AuthRequest>) -> ApiResult<TextResponse> {
    let url = state.checked_url(&body.url)?;
    let response = state.client.get(url).basic_auth(body.username, Some(body.password)).send().await.map_err(upstream)?;
    if !response.status().is_success() { return Err(upstream(format!("provider_http_{}", response.status().as_u16()))); }
    Ok(Json(TextResponse { text: response.text().await.map_err(upstream)? }))
}

pub async fn status(State(state): State<CalendarHttpState>, Json(body): Json<AuthRequest>) -> ApiResult<StatusResponse> {
    let url = state.checked_url(&body.url)?;
    let response = state.client.get(url).basic_auth(body.username, Some(body.password)).send().await.map_err(upstream)?;
    Ok(Json(StatusResponse { status: response.status().as_u16() }))
}

pub async fn put(State(state): State<CalendarHttpState>, Json(body): Json<PutRequest>) -> ApiResult<serde_json::Value> {
    let url = state.checked_url(&body.url)?;
    let response = state.client.put(url).basic_auth(body.username, Some(body.password))
        .header("content-type", "text/calendar; charset=utf-8").body(body.ics_content)
        .send().await.map_err(upstream)?;
    if !response.status().is_success() { return Err(upstream(format!("provider_http_{}", response.status().as_u16()))); }
    Ok(Json(serde_json::json!({ "ok": true })))
}

pub async fn delete(State(state): State<CalendarHttpState>, Json(body): Json<AuthRequest>) -> ApiResult<serde_json::Value> {
    let url = state.checked_url(&body.url)?;
    let response = state.client.delete(url).basic_auth(body.username, Some(body.password)).send().await.map_err(upstream)?;
    if !response.status().is_success() && response.status() != StatusCode::NOT_FOUND {
        return Err(upstream(format!("provider_http_{}", response.status().as_u16())));
    }
    Ok(Json(serde_json::json!({ "ok": true })))
}

pub async fn config_fetch(State(state): State<CalendarHttpState>, Json(body): Json<AuthRequest>) -> ApiResult<ConfigResponse> {
    let url = state.checked_url(&body.url)?;
    let response = state.client.get(url).basic_auth(body.username, Some(body.password)).send().await.map_err(upstream)?;
    if response.status() == StatusCode::NOT_FOUND { return Ok(Json(ConfigResponse { exists: false, content: None, etag: None })); }
    if !response.status().is_success() { return Err(upstream(format!("provider_http_{}", response.status().as_u16()))); }
    let etag = response.headers().get(header::ETAG).and_then(|value| value.to_str().ok()).map(str::to_owned);
    Ok(Json(ConfigResponse { exists: true, content: Some(response.text().await.map_err(upstream)?), etag }))
}

pub async fn config_put(State(state): State<CalendarHttpState>, Json(body): Json<ConfigPutRequest>) -> ApiResult<serde_json::Value> {
    let url = state.checked_url(&body.url)?;
    let mut request = state.client.put(url).basic_auth(body.username, Some(body.password))
        .header(header::CONTENT_TYPE, "application/json; charset=utf-8").body(body.content);
    request = match body.if_match { Some(etag) => request.header(header::IF_MATCH, etag), None => request.header(header::IF_NONE_MATCH, "*") };
    let response = request.send().await.map_err(upstream)?;
    if response.status() == StatusCode::PRECONDITION_FAILED { return Ok(Json(serde_json::json!({ "ok": false, "conflict": true }))); }
    if !response.status().is_success() { return Err(upstream(format!("provider_http_{}", response.status().as_u16()))); }
    let etag = response.headers().get(header::ETAG).and_then(|value| value.to_str().ok()).map(str::to_owned);
    Ok(Json(serde_json::json!({ "ok": true, "etag": etag })))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn provider_urls_are_restricted_to_the_configured_allowlist() {
        std::env::set_var("COURRIER_ALLOWED_PROVIDER_HOSTS", "calendar.example.com");
        let state = CalendarHttpState::from_env();
        assert!(state.checked_url("https://calendar.example.com/dav/user").is_ok());
        assert!(state.checked_url("https://attacker.example/dav/user").is_err());
        assert!(state.checked_url("file:///etc/passwd").is_err());
        assert!(state.checked_url("https://user:secret@calendar.example.com/dav").is_err());
    }
}
