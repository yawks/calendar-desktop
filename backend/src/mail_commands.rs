//! HTTP adapter for native mail commands.

use axum::{extract::Path, http::StatusCode, Json};
use serde_json::Value;

pub async fn dispatch(
    Path(command): Path<String>,
    Json(value): Json<Value>,
) -> Result<Json<Value>, (StatusCode, Json<Value>)> {
    app_lib::command::dispatch(&command, value)
        .await
        .map(Json)
        .map_err(|error| {
            let status = if error.code == "unknown_mail_command" {
                StatusCode::NOT_FOUND
            } else if error.code == "invalid_arguments" {
                StatusCode::BAD_REQUEST
            } else {
                StatusCode::BAD_GATEWAY
            };
            (status, Json(serde_json::json!({ "error": error.detail })))
        })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn rejects_unknown_commands() {
        let (status, body) = dispatch(Path("not_a_command".into()), Json(Value::Null))
            .await
            .unwrap_err();
        assert_eq!(status, StatusCode::NOT_FOUND);
        assert_eq!(body.0["error"], "unknown mail command");
    }
}
