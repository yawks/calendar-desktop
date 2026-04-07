use std::sync::Mutex;
use tokio::sync::oneshot;

// ── Google OAuth ──────────────────────────────────────────────────────────────

#[derive(Debug, serde::Serialize)]
pub struct OAuthCallback {
    pub code: Option<String>,
    pub state: Option<String>,
    pub error: Option<String>,
}

/// Shared state: holds the oneshot receiver for the OAuth callback result.
pub struct OAuthState {
    pub rx: Mutex<Option<oneshot::Receiver<OAuthCallback>>>,
}

/// Step 1 — Opens a TCP listener on a random localhost port.
/// Returns the port so the frontend can build the redirect_uri and open the browser.
/// The listener runs in the background; call `wait_oauth_code` to block until
/// the callback arrives.
#[tauri::command]
pub async fn start_oauth_listener(state: tauri::State<'_, OAuthState>) -> Result<u16, String> {
    use tokio::io::{AsyncReadExt, AsyncWriteExt};
    use tokio::net::TcpListener;

    let listener = TcpListener::bind("127.0.0.1:0")
        .await
        .map_err(|e| e.to_string())?;
    let port = listener.local_addr().map_err(|e| e.to_string())?.port();

    let (tx, rx) = oneshot::channel::<OAuthCallback>();

    // Store the receiver so `wait_oauth_code` can pick it up
    *state.rx.lock().map_err(|_| "Lock poisoned")? = Some(rx);

    tokio::spawn(async move {
        match listener.accept().await {
            Ok((mut stream, _)) => {
                let mut buf = vec![0u8; 8192];
                let result = match stream.read(&mut buf).await {
                    Ok(n) => {
                        let request = String::from_utf8_lossy(&buf[..n]);
                        let code = extract_query_param(&request, "code");
                        let st = extract_query_param(&request, "state");
                        let error = extract_query_param(&request, "error");

                        let html = if code.is_some() {
                            include_str!("oauth_success.html")
                        } else {
                            include_str!("oauth_error.html")
                        };
                        let response = format!(
                            "HTTP/1.1 200 OK\r\nContent-Type: text/html; charset=utf-8\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{}",
                            html.len(), html
                        );
                        let _ = stream.write_all(response.as_bytes()).await;
                        let _ = stream.flush().await;

                        OAuthCallback { code, state: st, error }
                    }
                    Err(e) => OAuthCallback {
                        code: None,
                        state: None,
                        error: Some(format!("Read error: {}", e)),
                    },
                };
                let _ = tx.send(result);
            }
            Err(e) => {
                let _ = tx.send(OAuthCallback {
                    code: None,
                    state: None,
                    error: Some(format!("Accept error: {}", e)),
                });
            }
        }
    });

    Ok(port)
}

/// Step 2 — Blocks until the OAuth callback is received (up to 5 minutes).
/// Returns { code, state, error }.
#[tauri::command]
pub async fn wait_oauth_code(state: tauri::State<'_, OAuthState>) -> Result<OAuthCallback, String> {
    // Take the receiver out of the mutex without holding the lock during the await
    let rx = {
        let mut guard = state.rx.lock().map_err(|_| "Lock poisoned")?;
        guard.take().ok_or("Aucun flux OAuth en attente — appelez start_oauth_listener d'abord")?
    };

    tokio::time::timeout(std::time::Duration::from_secs(300), rx)
        .await
        .map_err(|_| "Timeout: aucune réponse OAuth en 5 minutes".to_string())?
        .map_err(|_| "Le channel OAuth a été fermé sans réponse".to_string())
}

/// Opens a URL in the system default browser.
#[tauri::command]
pub fn open_url(url: String) -> Result<(), String> {
    webbrowser::open(&url).map_err(|e| e.to_string())
}

// ── Helpers ───────────────────────────────────────────────────────────────────

fn extract_query_param(request: &str, param: &str) -> Option<String> {
    let first_line = request.lines().next()?;
    // e.g. "GET /?code=xxx&state=yyy HTTP/1.1"
    let path = first_line.split_whitespace().nth(1)?;
    let query = path.split('?').nth(1)?;
    for pair in query.split('&') {
        let mut kv = pair.splitn(2, '=');
        let key = kv.next()?;
        if key == param {
            let raw = kv.next().unwrap_or("").trim_end_matches(" HTTP/1.1");
            return Some(urlencoding::decode(raw).unwrap_or_default().into_owned());
        }
    }
    None
}
