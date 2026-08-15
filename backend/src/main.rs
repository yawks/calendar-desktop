mod calendar_http;
mod exchange_auth;
mod exchange_calendar;
mod google_auth;
mod mail_commands;

use axum::{extract::{DefaultBodyLimit, Request}, http::{Method, StatusCode}, middleware::{self, Next}, response::{IntoResponse, Response}, routing::{get, post, put}, Json, Router};
use serde::Serialize;
use std::{env, net::SocketAddr, path::PathBuf};
use tower_http::{services::{ServeDir, ServeFile}, trace::TraceLayer};

#[derive(Serialize)]
struct Health<'a> { status: &'a str, service: &'a str }

async fn health() -> Json<Health<'static>> {
    Json(Health { status: "ok", service: "courrier-server" })
}

async fn api_not_found() -> impl IntoResponse {
    (StatusCode::NOT_FOUND, Json(serde_json::json!({ "error": "unknown_api_route" })))
}

async fn security_headers(request: Request, next: Next) -> Response {
    let sensitive = request.uri().path().starts_with("/api/") || request.uri().path().starts_with("/auth/");
    if sensitive && !matches!(*request.method(), Method::GET | Method::HEAD | Method::OPTIONS) && !same_origin(&request) {
        return (StatusCode::FORBIDDEN, Json(serde_json::json!({ "error": "cross_origin_request_rejected" }))).into_response();
    }
    let mut response = next.run(request).await;
    let headers = response.headers_mut();
    headers.insert("x-content-type-options", "nosniff".parse().unwrap());
    headers.insert("referrer-policy", "same-origin".parse().unwrap());
    headers.insert("permissions-policy", "camera=(), microphone=(), geolocation=()".parse().unwrap());
    headers.insert("content-security-policy", "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob: https:; connect-src 'self' https:; font-src 'self' data:; frame-src 'self' blob:; object-src 'none'; base-uri 'self'; frame-ancestors 'none'; form-action 'self'".parse().unwrap());
    if sensitive {
        headers.insert("cache-control", "no-store, max-age=0".parse().unwrap());
        headers.insert("pragma", "no-cache".parse().unwrap());
    }
    response
}

fn same_origin(request: &Request) -> bool {
    let headers = request.headers();
    if headers.get("sec-fetch-site").and_then(|v| v.to_str().ok()) == Some("cross-site") { return false; }
    let Some(origin) = headers.get("origin").and_then(|v| v.to_str().ok()) else { return true };
    if origin == "null" { return false; }
    let Some(host) = headers.get("x-forwarded-host").or_else(|| headers.get("host")).and_then(|v| v.to_str().ok()) else { return false };
    let scheme = headers.get("x-forwarded-proto").and_then(|v| v.to_str().ok()).unwrap_or("http");
    let Ok(origin_url) = url::Url::parse(origin) else { return false };
    let Ok(target_url) = url::Url::parse(&format!("{scheme}://{host}")) else { return false };
    origin_url.scheme() == target_url.scheme()
        && origin_url.host_str() == target_url.host_str()
        && origin_url.port_or_known_default() == target_url.port_or_known_default()
}

#[tokio::main]
async fn main() {
    let dist = PathBuf::from(env::var("COURRIER_WEB_ROOT").unwrap_or_else(|_| "../frontend/dist".into()));
    let static_files = ServeDir::new(&dist).not_found_service(ServeFile::new(dist.join("index.html")));
    let calendar_state = calendar_http::CalendarHttpState::from_env();
    let calendar_api = Router::new()
        .route("/ics/fetch", post(calendar_http::fetch_ics))
        .route("/caldav/fetch", post(calendar_http::fetch_authenticated))
        .route("/caldav/status", post(calendar_http::status))
        .route("/caldav/resource", put(calendar_http::put).delete(calendar_http::delete))
        .with_state(calendar_state);
    let api = Router::new().route("/health", get(health))
        .nest("/calendar", calendar_api)
        .route("/auth/exchange/device", post(exchange_auth::start_device_auth))
        .route("/auth/exchange/token", post(exchange_auth::poll_device_token))
        .route("/auth/exchange/refresh", post(exchange_auth::refresh))
        .route("/calendar/exchange/events", post(exchange_calendar::create))
        .route("/calendar/exchange/list", post(exchange_calendar::list))
        .route("/calendar/exchange/free-busy", post(exchange_calendar::free_busy))
        .route("/calendar/exchange/update", post(exchange_calendar::update))
        .route("/calendar/exchange/delete", post(exchange_calendar::delete))
        .route("/calendar/exchange/cancel", post(exchange_calendar::cancel))
        .route("/calendar/exchange/respond", post(exchange_calendar::respond))
        .route("/mail/commands/:command", post(mail_commands::dispatch))
        .fallback(api_not_found);
    let google_state = google_auth::GoogleOAuthState::default();
    let google_routes = Router::new().route("/", get(google_auth::start)).route("/configuration", get(google_auth::configuration)).route("/prepare", post(google_auth::prepare)).route("/callback", get(google_auth::callback)).route("/complete.js", get(google_auth::complete_script)).route("/refresh", post(google_auth::refresh)).with_state(google_state);
    let app = Router::new().nest("/api", api).nest("/auth/google", google_routes).fallback_service(static_files)
        .layer(DefaultBodyLimit::max(32 * 1024 * 1024))
        .layer(middleware::from_fn(security_headers)).layer(TraceLayer::new_for_http());
    let port = env::var("PORT").ok().and_then(|value| value.parse().ok()).unwrap_or(8080);
    let address = SocketAddr::from(([0, 0, 0, 0], port));
    let listener = tokio::net::TcpListener::bind(address).await.expect("bind HTTP server");
    println!("Courrier listening on http://{address}");
    axum::serve(listener, app).await.expect("serve HTTP application");
}

#[cfg(test)]
mod tests {
    use super::*;
    use axum::http::Request as HttpRequest;

    #[test]
    fn accepts_forwarded_same_origin() {
        let request = HttpRequest::builder().uri("/api/test").header("origin", "https://mail.example.test")
            .header("host", "127.0.0.1:8080").header("x-forwarded-host", "mail.example.test")
            .header("x-forwarded-proto", "https").body(axum::body::Body::empty()).unwrap();
        assert!(same_origin(&request));
    }

    #[test]
    fn accepts_forwarded_same_origin_with_non_default_port() {
        let request = HttpRequest::builder().uri("/api/test").header("origin", "https://localhost:8443")
            .header("host", "courrier:8080").header("x-forwarded-host", "localhost:8443")
            .header("x-forwarded-proto", "https").body(axum::body::Body::empty()).unwrap();
        assert!(same_origin(&request));
    }

    #[test]
    fn rejects_cross_site_and_null_origins() {
        for origin in ["https://evil.example", "null"] {
            let request = HttpRequest::builder().uri("/api/test").header("origin", origin)
                .header("host", "mail.example.test").header("x-forwarded-proto", "https")
                .body(axum::body::Body::empty()).unwrap();
            assert!(!same_origin(&request));
        }
    }
}
