use axum::{http::StatusCode, Json};
use serde::{Deserialize, Serialize};

const DEFAULT_CLIENT_ID: &str = "d3590ed6-52b3-4102-aeff-aad2292ab01c";
const SCOPE: &str = "https://outlook.office.com/EWS.AccessAsUser.All offline_access";
const TOKEN_ENDPOINT: &str = "https://login.microsoftonline.com/common/oauth2/v2.0/token";
const DEVICE_ENDPOINT: &str = "https://login.microsoftonline.com/common/oauth2/v2.0/devicecode";

#[derive(Serialize, Deserialize)]
pub struct DeviceAuthResponse {
    device_code: String,
    user_code: String,
    verification_uri: String,
    expires_in: u64,
    interval: u64,
    message: String,
}

#[derive(Serialize, Deserialize)]
pub struct TokenResponse {
    access_token: String,
    refresh_token: Option<String>,
    expires_in: u64,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DeviceTokenRequest { device_code: String }

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RefreshRequest { refresh_token: String }

#[derive(Serialize)]
pub struct AuthError { error: String }

type AuthResult<T> = Result<Json<T>, (StatusCode, Json<AuthError>)>;

fn client_id() -> String {
    std::env::var("COURRIER_MICROSOFT_CLIENT_ID").unwrap_or_else(|_| DEFAULT_CLIENT_ID.into())
}

fn upstream(error: impl ToString) -> (StatusCode, Json<AuthError>) {
    (StatusCode::BAD_GATEWAY, Json(AuthError { error: error.to_string() }))
}

async fn token_request(body: String) -> AuthResult<TokenResponse> {
    let response = reqwest::Client::new().post(TOKEN_ENDPOINT)
        .header("content-type", "application/x-www-form-urlencoded")
        .body(body).send().await.map_err(upstream)?;
    let value: serde_json::Value = response.json().await.map_err(upstream)?;
    if let Some(error) = value.get("error").and_then(|item| item.as_str()) {
        let description = value.get("error_description").and_then(|item| item.as_str()).unwrap_or("");
        let status = if error == "authorization_pending" { StatusCode::CONFLICT } else { StatusCode::BAD_REQUEST };
        return Err((status, Json(AuthError { error: if description.is_empty() { error.into() } else { format!("{error}: {description}") } })));
    }
    Ok(Json(TokenResponse {
        access_token: value["access_token"].as_str().unwrap_or_default().into(),
        refresh_token: value["refresh_token"].as_str().map(Into::into),
        expires_in: value["expires_in"].as_u64().unwrap_or(3600),
    }))
}

pub async fn start_device_auth() -> AuthResult<DeviceAuthResponse> {
    let body = format!("client_id={}&scope={}", client_id(), urlencoding::encode(SCOPE));
    let response = reqwest::Client::new().post(DEVICE_ENDPOINT)
        .header("content-type", "application/x-www-form-urlencoded")
        .body(body).send().await.map_err(upstream)?;
    let value: serde_json::Value = response.json().await.map_err(upstream)?;
    if let Some(error) = value.get("error_description").and_then(|item| item.as_str()) {
        return Err((StatusCode::BAD_REQUEST, Json(AuthError { error: error.into() })));
    }
    Ok(Json(DeviceAuthResponse {
        device_code: value["device_code"].as_str().unwrap_or_default().into(),
        user_code: value["user_code"].as_str().unwrap_or_default().into(),
        verification_uri: value["verification_uri"].as_str().unwrap_or_default().into(),
        expires_in: value["expires_in"].as_u64().unwrap_or(900),
        interval: value["interval"].as_u64().unwrap_or(5),
        message: value["message"].as_str().unwrap_or_default().into(),
    }))
}

pub async fn poll_device_token(Json(request): Json<DeviceTokenRequest>) -> AuthResult<TokenResponse> {
    token_request(format!(
        "client_id={}&grant_type=urn:ietf:params:oauth:grant-type:device_code&device_code={}",
        client_id(), urlencoding::encode(&request.device_code)
    )).await
}

pub async fn refresh(Json(request): Json<RefreshRequest>) -> AuthResult<TokenResponse> {
    token_request(format!(
        "client_id={}&grant_type=refresh_token&refresh_token={}&scope={}",
        client_id(), urlencoding::encode(&request.refresh_token), urlencoding::encode(SCOPE)
    )).await
}
