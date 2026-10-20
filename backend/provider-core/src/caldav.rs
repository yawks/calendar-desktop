//! Read-only DAV discovery, shared by the web adapter and native transports.
use serde::Deserialize;

pub fn conditional_put(request: reqwest::RequestBuilder, if_match: Option<&str>) -> reqwest::RequestBuilder {
    match if_match { Some(etag) => request.header(reqwest::header::IF_MATCH, etag), None => request }
}

pub fn status_request(client: &reqwest::Client, url: reqwest::Url) -> reqwest::RequestBuilder {
    // DAV collections need not support GET (OpenTodo, among others).
    client.request(reqwest::Method::from_bytes(b"PROPFIND").unwrap(), url)
        .header("Depth", "0")
        .header("Content-Type", "application/xml; charset=utf-8")
        .body(r#"<?xml version="1.0" encoding="utf-8"?><d:propfind xmlns:d="DAV:"><d:prop><d:resourcetype/></d:prop></d:propfind>"#)
}

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

    #[test]
    fn conditional_calendar_writes_preserve_the_exact_etag_and_leave_legacy_writes_unconditional() {
        let client = reqwest::Client::new();
        let request = conditional_put(client.put("https://example.test/dav/task.ics"), Some("\"version-2\"")).build().unwrap();
        assert_eq!(request.headers()[reqwest::header::IF_MATCH], "\"version-2\"");
        let request = conditional_put(client.put("https://example.test/dav/event.ics"), None).build().unwrap();
        assert!(!request.headers().contains_key(reqwest::header::IF_MATCH));
    }

    #[test]
    fn connection_probe_uses_propfind_on_the_exact_dav_url() {
        let request = status_request(&reqwest::Client::new(), "http://localhost:8080/dav/".parse().unwrap())
            .basic_auth("user@example.test", Some("test-app-password")).build().unwrap();
        assert_eq!(request.method().as_str(), "PROPFIND");
        assert_eq!(request.url().as_str(), "http://localhost:8080/dav/");
        assert_eq!(request.headers()["depth"], "0");
        assert_eq!(request.headers()["content-type"], "application/xml; charset=utf-8");
        assert!(request.headers().contains_key("authorization"));
        let body = std::str::from_utf8(request.body().unwrap().as_bytes().unwrap()).unwrap();
        assert!(body.contains("<d:resourcetype/>"));
        assert!(!body.contains("test-app-password"));
    }

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
