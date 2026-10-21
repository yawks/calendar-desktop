use serde::Serialize;
use std::sync::Mutex;
use tauri::State;
use tokio::{
    io::{AsyncReadExt, AsyncWriteExt},
    net::TcpListener,
    sync::oneshot,
};

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct OAuthCallback {
    code: Option<String>,
    state: Option<String>,
    error: Option<String>,
}

pub struct OAuthState(pub Mutex<Option<oneshot::Receiver<OAuthCallback>>>);

#[tauri::command]
pub async fn start_oauth_listener(state: State<'_, OAuthState>) -> Result<u16, String> {
    let listener = TcpListener::bind("127.0.0.1:0")
        .await
        .map_err(|error| error.to_string())?;
    let port = listener
        .local_addr()
        .map_err(|error| error.to_string())?
        .port();
    let (sender, receiver) = oneshot::channel();
    *state.0.lock().map_err(|_| "OAuth state lock poisoned")? = Some(receiver);

    tokio::spawn(async move {
        let callback = match listener.accept().await {
            Ok((mut stream, _)) => {
                let mut buffer = vec![0_u8; 16_384];
                match stream.read(&mut buffer).await {
                    Ok(length) => {
                        let request = String::from_utf8_lossy(&buffer[..length]);
                        let callback = OAuthCallback {
                            code: query_parameter(&request, "code"),
                            state: query_parameter(&request, "state"),
                            error: query_parameter(&request, "error"),
                        };
                        let success = callback.code.is_some();
                        let html = if success {
                            "<!doctype html><meta charset=utf-8><title>Courrier</title><p>Autorisation terminée. Vous pouvez fermer cette fenêtre.</p>"
                        } else {
                            "<!doctype html><meta charset=utf-8><title>Courrier</title><p>L’autorisation a échoué. Revenez dans Courrier.</p>"
                        };
                        let response = format!(
                            "HTTP/1.1 200 OK\r\nContent-Type: text/html; charset=utf-8\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{}",
                            html.len(), html
                        );
                        let _ = stream.write_all(response.as_bytes()).await;
                        let _ = stream.flush().await;
                        callback
                    }
                    Err(error) => failed(error.to_string()),
                }
            }
            Err(error) => failed(error.to_string()),
        };
        let _ = sender.send(callback);
    });
    Ok(port)
}

#[tauri::command]
pub async fn wait_oauth_code(state: State<'_, OAuthState>) -> Result<OAuthCallback, String> {
    let receiver = state
        .0
        .lock()
        .map_err(|_| "OAuth state lock poisoned")?
        .take()
        .ok_or("No OAuth flow is pending")?;
    tokio::time::timeout(std::time::Duration::from_secs(300), receiver)
        .await
        .map_err(|_| "OAuth callback timed out".to_string())?
        .map_err(|_| "OAuth callback channel closed".to_string())
}

#[tauri::command]
pub fn open_external_url(url: String) -> Result<(), String> {
    if !(url.starts_with("https://") || url.starts_with("http://") || url.starts_with("mailto:")) {
        return Err("Unsupported external URL".into());
    }
    webbrowser::open(&url).map_err(|error| error.to_string())
}

fn query_parameter(request: &str, name: &str) -> Option<String> {
    let path = request.lines().next()?.split_whitespace().nth(1)?;
    let query = path.split_once('?')?.1;
    query.split('&').find_map(|part| {
        let (key, value) = part.split_once('=').unwrap_or((part, ""));
        (key == name).then(|| urlencoding::decode(value).unwrap_or_default().into_owned())
    })
}

fn failed(error: String) -> OAuthCallback {
    OAuthCallback {
        code: None,
        state: None,
        error: Some(error),
    }
}
