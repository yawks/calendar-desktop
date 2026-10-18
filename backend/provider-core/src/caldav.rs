//! Read-only DAV discovery, shared by the web adapter and native transports.
use serde::Deserialize;

#[derive(Deserialize)]
pub struct Query {
    pub url: String,
    pub username: String,
    pub password: String,
    pub method: String,
    pub depth: String,
    pub body: String,
}

pub async fn query(request: Query) -> Result<serde_json::Value, String> {
    let url = reqwest::Url::parse(&request.url).map_err(|_| "invalid_provider_url")?;
    if !matches!(url.scheme(), "http" | "https") || !url.username().is_empty() || url.password().is_some() {
        return Err("invalid_provider_url".into());
    }
    if !matches!(request.method.as_str(), "PROPFIND" | "REPORT") || !matches!(request.depth.as_str(), "0" | "1") {
        return Err("invalid_dav_query".into());
    }
    let client = reqwest::Client::builder().timeout(std::time::Duration::from_secs(30))
        .redirect(reqwest::redirect::Policy::none()).build().map_err(|_| "provider_request_failed")?;
    let response = client.request(reqwest::Method::from_bytes(request.method.as_bytes()).map_err(|_| "invalid_dav_query")?, url)
        .basic_auth(request.username, Some(request.password)).header("Depth", request.depth)
        .header("Content-Type", "application/xml; charset=utf-8").body(request.body)
        .send().await.map_err(|_| "provider_request_failed")?;
    if !response.status().is_success() { return Err(format!("provider_http_{}", response.status().as_u16())); }
    Ok(serde_json::json!({ "text": response.text().await.map_err(|_| "provider_invalid_response")? }))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn discovery_rejects_unsafe_urls_and_write_methods_without_a_request() {
        for (url, method, depth, expected) in [
            ("file:///etc/passwd", "PROPFIND", "0", "invalid_provider_url"),
            ("https://user:secret@example.test/dav/", "PROPFIND", "0", "invalid_provider_url"),
            ("https://example.test/dav/", "DELETE", "0", "invalid_dav_query"),
            ("https://example.test/dav/", "REPORT", "infinity", "invalid_dav_query"),
        ] {
            let error = query(Query { url: url.into(), username: "test-user".into(), password: "test-secret".into(), method: method.into(), depth: depth.into(), body: String::new() }).await.unwrap_err();
            assert_eq!(error, expected);
            assert!(!error.contains("test-secret"));
        }
    }
}
