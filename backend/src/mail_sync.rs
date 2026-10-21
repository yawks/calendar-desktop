//! HTTP adapter for the provider-neutral sync core.

use axum::{http::StatusCode, Json};
use serde_json::Value;

pub async fn detect(
    Json(request): Json<app_lib::sync::SyncRequest>,
) -> Result<Json<app_lib::sync::SyncResponse>, (StatusCode, Json<Value>)> {
    app_lib::sync::detect(request)
        .await
        .map(Json)
        .map_err(|error| {
            use app_lib::sync::SyncErrorKind;
            let status = match error.kind {
                SyncErrorKind::InvalidRequest => StatusCode::BAD_REQUEST,
                SyncErrorKind::Unauthorized => StatusCode::UNAUTHORIZED,
                SyncErrorKind::Unavailable => StatusCode::SERVICE_UNAVAILABLE,
                SyncErrorKind::Upstream => StatusCode::BAD_GATEWAY,
                SyncErrorKind::Internal => StatusCode::INTERNAL_SERVER_ERROR,
            };
            (status, Json(serde_json::json!({ "error": error.code })))
        })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn rejects_unknown_provider_without_echoing_credentials() {
        let result = detect(Json(app_lib::sync::SyncRequest {
            provider: "unknown".into(),
            credentials: serde_json::json!({ "password": "must-not-appear" }),
            cursor: None,
            max_count: None,
        }))
        .await
        .unwrap_err();
        assert_eq!(result.0, StatusCode::BAD_REQUEST);
        assert_eq!(
            result.1 .0,
            serde_json::json!({ "error": "unsupported_provider" })
        );
        assert!(!result.1 .0.to_string().contains("must-not-appear"));
    }
}
