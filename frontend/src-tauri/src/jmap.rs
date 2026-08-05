use serde::Deserialize;
use tauri::command;
use jmap_client::client::{Client, Credentials};
use jmap_client::email::Property as EmailProperty;
use jmap_client::email::query::Filter as EmailFilter;
use jmap_client::email::query::Comparator as EmailComparator;
use jmap_client::email_submission::Property as SubmissionProperty;
use jmap_client::email_submission::query::Comparator as SubmissionComparator;
use jmap_client::mailbox::Role;
use jmap_client::URI;
use std::collections::HashMap;
use std::sync::Arc;
use base64::Engine;
use chrono::DateTime;
use futures::future::join_all;
use tokio::sync::Mutex;
use crate::mail_provider::*;

#[derive(Deserialize, Debug, Clone)]
pub struct JmapConfig {
    pub email: String,
    pub session_url: String,
    pub token: String,
    pub auth_type: Option<String>,
    pub color: Option<String>,
    pub fastmail_token: Option<String>,
    /// Internal cursor used only by jmap_list_threads; never persisted in an account.
    #[serde(default)]
    pub list_offset: u32,
}

fn fastmail_config(config: &JmapConfig) -> Option<JmapConfig> {
    let token = config.fastmail_token.as_deref()?.trim();
    if token.is_empty() { return None; }
    let mut private = config.clone();
    private.token = token.to_string();
    private.auth_type = Some("bearer".to_string());
    Some(private)
}

// ── Persistent client + folder-ID cache ──────────────────────────────────────

pub struct JmapClientState {
    /// One Arc<Client> per account (key = session_url|token). Connecting is
    /// expensive (well-known fetch + auth), so we reuse across commands.
    clients: Mutex<HashMap<String, Arc<Client>>>,
    /// Maps role/name strings ("inbox", "sentitems", "deleteditems", "drafts",
    /// "snoozed") to JMAP mailbox IDs, per account. Avoids a Mailbox/get
    /// round-trip on every list_threads / move_to_trash / etc.
    folder_ids: Mutex<HashMap<String, HashMap<String, String>>>,
}

impl JmapClientState {
    pub fn new() -> Self {
        Self {
            clients: Mutex::new(HashMap::new()),
            folder_ids: Mutex::new(HashMap::new()),
        }
    }
}

pub struct JmapProvider {
    config: JmapConfig,
    state: Arc<JmapClientState>,
}

fn account_key(config: &JmapConfig) -> String {
    format!("{}|{}", config.session_url, config.token)
}

// ── Helpers ───────────────────────────────────────────────────────────────────

fn extract_host(url: &str) -> Option<String> {
    let after_scheme = url.strip_prefix("https://").or_else(|| url.strip_prefix("http://"))?;
    let host = after_scheme.split('/').next().filter(|h| !h.is_empty())?;
    Some(host.to_string())
}

fn jmap_base_url(session_url: &str) -> String {
    if let Some(after_scheme) = session_url.strip_prefix("https://").or_else(|| session_url.strip_prefix("http://")) {
        let scheme = if session_url.starts_with("https") { "https" } else { "http" };
        let host = after_scheme.split('/').next().unwrap_or(after_scheme);
        return format!("{}://{}", scheme, host);
    }
    session_url.to_string()
}

fn timestamp_to_rfc3339(ts: i64) -> String {
    DateTime::from_timestamp(ts, 0)
        .map(|dt| dt.to_rfc3339())
        .unwrap_or_default()
}

fn sanitise_mime_header(value: &str) -> String {
    value.replace(['\r', '\n'], " ")
}

fn wrap_base64(value: &str) -> String {
    value.as_bytes().chunks(76)
        .map(|chunk| std::str::from_utf8(chunk).unwrap_or_default())
        .collect::<Vec<_>>()
        .join("\r\n")
}

fn build_mime_message(
    from: &str,
    params: &SendMailParams,
) -> Result<Vec<u8>, String> {
    let mut headers = format!(
        "From: {}\r\nTo: {}\r\nSubject: {}\r\nMIME-Version: 1.0\r\n",
        sanitise_mime_header(from),
        params.to.iter().map(|v| sanitise_mime_header(v)).collect::<Vec<_>>().join(", "),
        sanitise_mime_header(&params.subject),
    );
    if !params.cc.is_empty() {
        headers.push_str(&format!("Cc: {}\r\n", params.cc.iter().map(|v| sanitise_mime_header(v)).collect::<Vec<_>>().join(", ")));
    }
    if !params.bcc.is_empty() {
        headers.push_str(&format!("Bcc: {}\r\n", params.bcc.iter().map(|v| sanitise_mime_header(v)).collect::<Vec<_>>().join(", ")));
    }
    if let Some(ref value) = params.in_reply_to {
        headers.push_str(&format!("In-Reply-To: {}\r\n", sanitise_mime_header(value)));
    }
    if let Some(ref value) = params.references {
        headers.push_str(&format!("References: {}\r\n", sanitise_mime_header(value)));
    }

    let body = params.body_html.replace('\r', "").replace('\n', "\r\n");
    let attachments = params.attachments.as_deref().unwrap_or_default();
    if attachments.is_empty() {
        headers.push_str("Content-Type: text/html; charset=utf-8\r\n\r\n");
        return Ok(format!("{}{}", headers, body).into_bytes());
    }

    let boundary = format!("calendar-desktop-{}", chrono::Utc::now().timestamp_nanos_opt().unwrap_or_default());
    headers.push_str(&format!("Content-Type: multipart/mixed; boundary=\"{}\"\r\n\r\n", boundary));
    let mut message = format!(
        "{}--{}\r\nContent-Type: text/html; charset=utf-8\r\nContent-Transfer-Encoding: 8bit\r\n\r\n{}\r\n",
        headers, boundary, body,
    );
    for attachment in attachments {
        let compact: String = attachment.data.chars().filter(|c| !c.is_ascii_whitespace()).collect();
        let bytes = base64::engine::general_purpose::STANDARD.decode(compact.as_bytes())
            .map_err(|e| format!("Invalid base64 attachment '{}': {}", attachment.name, e))?;
        let encoded = base64::engine::general_purpose::STANDARD.encode(bytes);
        let filename = sanitise_mime_header(&attachment.name).replace(['"', '\\'], "_");
        let content_type = sanitise_mime_header(&attachment.content_type);
        let disposition = if attachment.is_inline.unwrap_or(false) { "inline" } else { "attachment" };
        message.push_str(&format!(
            "--{}\r\nContent-Type: {}; name=\"{}\"\r\nContent-Transfer-Encoding: base64\r\nContent-Disposition: {}; filename=\"{}\"\r\n",
            boundary, content_type, filename, disposition, filename,
        ));
        if let Some(content_id) = attachment.content_id.as_deref() {
            message.push_str(&format!("Content-ID: <{}>\r\n", sanitise_mime_header(content_id).trim_matches(['<', '>'])));
        }
        message.push_str(&format!("\r\n{}\r\n", wrap_base64(&encoded)));
    }
    message.push_str(&format!("--{}--\r\n", boundary));
    Ok(message.into_bytes())
}

#[cfg(test)]
mod mime_tests {
    use super::*;

    #[test]
    fn builds_multipart_message_with_attachment() {
        let params = SendMailParams {
            to: vec!["recipient@example.com".into()],
            cc: vec![],
            bcc: vec![],
            subject: "Attachment test".into(),
            body_html: "<p>Hello</p>".into(),
            attachments: Some(vec![ComposerAttachment {
                name: "hello.txt".into(),
                content_type: "text/plain".into(),
                data: base64::engine::general_purpose::STANDARD.encode(b"hello"),
                is_inline: Some(false),
                content_id: None,
            }]),
            reply_to_item_id: None,
            reply_to_change_key: None,
            is_forward: None,
            identity_id: None,
            in_reply_to: None,
            references: None,
            send_at: None,
        };

        let raw = String::from_utf8(build_mime_message("sender@example.com", &params).unwrap()).unwrap();
        assert!(raw.contains("Content-Type: multipart/mixed"));
        assert!(raw.contains("Content-Disposition: attachment; filename=\"hello.txt\""));
        assert!(raw.contains("\r\naGVsbG8=\r\n"));
    }
}

fn build_auth_header(config: &JmapConfig) -> String {
    match config.auth_type.as_deref() {
        Some("basic") => {
            let creds = base64::engine::general_purpose::STANDARD
                .encode(format!("{}:{}", config.email, config.token));
            format!("Basic {}", creds)
        }
        _ => format!("Bearer {}", config.token),
    }
}

// ── Client cache ──────────────────────────────────────────────────────────────

async fn connect_client(config: &JmapConfig) -> Result<Client, String> {
    let base_url = jmap_base_url(&config.session_url);
    let mut trusted: Vec<String> = Vec::new();
    for url in [config.session_url.as_str(), base_url.as_str()] {
        if let Some(host) = extract_host(url) {
            if !trusted.contains(&host) {
                trusted.push(host.clone());
            }
            let parts: Vec<&str> = host.split('.').collect();
            if parts.len() >= 2 {
                let base = format!("{}.{}", parts[parts.len() - 2], parts[parts.len() - 1]);
                for sub in ["jmap", "api", "mail", "imap", "smtp", "www"] {
                    let sibling = format!("{}.{}", sub, base);
                    if !trusted.contains(&sibling) {
                        trusted.push(sibling);
                    }
                }
            }
        }
    }
    let credentials = match config.auth_type.as_deref() {
        Some("basic") => Credentials::basic(&config.email, &config.token),
        _ => Credentials::Bearer(config.token.clone()),
    };
    Client::new()
        .credentials(credentials)
        .follow_redirects(trusted)
        .connect(&base_url)
        .await
        .map_err(|e| format!("JMAP connection error: {}", e))
}

async fn get_client(state: &JmapClientState, config: &JmapConfig) -> Result<Arc<Client>, String> {
    let key = account_key(config);
    {
        let cache = state.clients.lock().await;
        if let Some(client) = cache.get(&key) {
            return Ok(Arc::clone(client));
        }
    }
    let client = Arc::new(connect_client(config).await?);
    state.clients.lock().await.insert(key, Arc::clone(&client));
    Ok(client)
}

// ── Folder ID cache ───────────────────────────────────────────────────────────

/// Returns a map of role/name → JMAP mailbox ID for the account.
/// Keys: "inbox", "sentitems", "deleteditems", "drafts", and "snoozed" when present.
/// Fetches from server only on first call per session; subsequent calls hit the cache.
async fn get_folder_ids(
    state: &JmapClientState,
    client: &Client,
    config: &JmapConfig,
) -> Result<HashMap<String, String>, String> {
    let key = account_key(config);
    {
        let cache = state.folder_ids.lock().await;
        if let Some(folders) = cache.get(&key) {
            return Ok(folders.clone());
        }
    }
    let mut req = client.build();
    req.get_mailbox();
    let mut resp = req.send().await.map_err(|e| e.to_string())?;
    let mailboxes = resp.method_response_by_pos(0).unwrap_get_mailbox().map_err(|e| e.to_string())?;

    let mut folders: HashMap<String, String> = HashMap::new();
    for m in mailboxes.list() {
        let Some(id) = m.id() else { continue };
        match m.role() {
            Role::Inbox  => { folders.insert("inbox".to_string(),        id.to_string()); }
            Role::Sent   => { folders.insert("sentitems".to_string(),    id.to_string()); }
            Role::Trash  => { folders.insert("deleteditems".to_string(), id.to_string()); }
            Role::Drafts => { folders.insert("drafts".to_string(),       id.to_string()); }
            Role::Junk   => { folders.insert("spam".to_string(),         id.to_string()); }
            _ => {}
        }
        if let Some(name) = m.name() {
            if name.eq_ignore_ascii_case("Snoozed") {
                folders.insert("snoozed".to_string(), id.to_string());
            }
        }
    }
    state.folder_ids.lock().await.insert(key, folders.clone());
    Ok(folders)
}

/// Returns the Snoozed mailbox ID, creating the mailbox if it doesn't exist.
async fn get_or_create_snoozed_id(
    state: &JmapClientState,
    client: &Client,
    config: &JmapConfig,
) -> Result<String, String> {
    let folder_ids = get_folder_ids(state, client, config).await?;
    if let Some(id) = folder_ids.get("snoozed") {
        return Ok(id.clone());
    }
    let created = client.mailbox_create("Snoozed", None::<String>, Role::None)
        .await
        .map_err(|e| format!("JMAP create Snoozed mailbox: {}", e))?;
    let id = created.id().map(|s| s.to_string())
        .ok_or_else(|| "No ID in JMAP mailbox create response".to_string())?;
    state.folder_ids.lock().await
        .entry(account_key(config))
        .or_default()
        .insert("snoozed".to_string(), id.clone());
    Ok(id)
}

// ── MailProvider impl ─────────────────────────────────────────────────────────

impl MailProvider for JmapProvider {
    async fn list_folders(&self) -> Result<Vec<MailFolder>, String> {
        let client = get_client(&self.state, &self.config).await?;
        let mut request = client.build();
        request.get_mailbox();
        let mut response = request.send().await.map_err(|e| e.to_string())?;
        let mailboxes = response.method_response_by_pos(0).unwrap_get_mailbox().map_err(|e| e.to_string())?;

        let mut folders = Vec::new();
        for mailbox in mailboxes.list() {
            let raw_id = mailbox.id().unwrap_or_default().to_string();
            let folder_id = match mailbox.role() {
                Role::Inbox => "inbox".to_string(),
                Role::Sent => "sentitems".to_string(),
                Role::Drafts => "drafts".to_string(),
                Role::Trash => "deleteditems".to_string(),
                Role::Junk => "spam".to_string(),
                _ => raw_id,
            };
            folders.push(MailFolder {
                folder_id,
                display_name: mailbox.name().unwrap_or_default().to_string(),
                total_count: mailbox.total_emails() as u32,
                unread_count: mailbox.unread_emails() as u32,
            });
        }
        Ok(folders)
    }

    async fn get_inbox_unread(&self) -> Result<u32, String> {
        let client = get_client(&self.state, &self.config).await?;
        let mut request = client.build();
        request.get_mailbox();
        let mut response = request.send().await.map_err(|e| e.to_string())?;
        let mailboxes = response.method_response_by_pos(0).unwrap_get_mailbox().map_err(|e| e.to_string())?;
        for mailbox in mailboxes.list() {
            if mailbox.role() == Role::Inbox || mailbox.name().map(|n| n.to_lowercase() == "inbox").unwrap_or(false) {
                return Ok(mailbox.unread_emails() as u32);
            }
        }
        Ok(0)
    }

    async fn list_threads(&self, folder: &str, max_count: Option<u32>) -> Result<Vec<MailThread>, String> {
        let client = get_client(&self.state, &self.config).await?;
        let count = max_count.unwrap_or(50);
        let email_limit = count * 4;

        if folder == "scheduled" {
            let mut query_request = client.build();
            query_request.query_email_submission()
                .sort([SubmissionComparator::sent_at().descending()])
                .limit((count * 4) as usize);
            let mut query_response = query_request.send().await.map_err(|e| e.to_string())?;
            let submission_ids = query_response.method_response_by_pos(0)
                .unwrap_query_email_submission().map_err(|e| e.to_string())?.take_ids();
            if submission_ids.is_empty() { return Ok(vec![]); }

            let mut submission_request = client.build();
            submission_request.get_email_submission()
                .ids(submission_ids.iter().map(String::as_str))
                .properties([SubmissionProperty::EmailId, SubmissionProperty::ThreadId, SubmissionProperty::Envelope, SubmissionProperty::SendAt]);
            let mut submission_response = submission_request.send().await.map_err(|e| e.to_string())?;
            let submissions = submission_response.method_response_by_pos(0)
                .unwrap_get_email_submission().map_err(|e| e.to_string())?;
            let now = chrono::Utc::now();
            let scheduled: Vec<(String, String, String)> = submissions.list().iter().filter_map(|submission| {
                let hold_until = submission.send_at()
                    .and_then(|timestamp| chrono::DateTime::<chrono::Utc>::from_timestamp(timestamp, 0))
                    .or_else(|| submission.mail_from()
                        .and_then(|from| from.parameter("HOLDUNTIL"))
                        .and_then(|value| chrono::DateTime::parse_from_rfc3339(value).ok())
                        .map(|date| date.with_timezone(&chrono::Utc)))?;
                if hold_until <= now { return None; }
                Some((submission.email_id()?.to_string(), submission.thread_id()?.to_string(), hold_until.to_rfc3339()))
            }).collect();
            if scheduled.is_empty() { return Ok(vec![]); }

            let mut email_request = client.build();
            email_request.get_email()
                .ids(scheduled.iter().map(|(email_id, _, _)| email_id.as_str()))
                .properties([EmailProperty::Id, EmailProperty::Subject, EmailProperty::From, EmailProperty::To, EmailProperty::Cc, EmailProperty::Preview, EmailProperty::HasAttachment]);
            let mut email_response = email_request.send().await.map_err(|e| e.to_string())?;
            let emails = email_response.method_response_by_pos(0).unwrap_get_email().map_err(|e| e.to_string())?;
            let schedule_by_email: HashMap<&str, (&str, &str)> = scheduled.iter()
                .map(|(email_id, thread_id, date)| (email_id.as_str(), (thread_id.as_str(), date.as_str())))
                .collect();
            let mut threads: Vec<MailThread> = emails.list().iter().filter_map(|email| {
                let (thread_id, scheduled_at) = schedule_by_email.get(email.id()?)?;
                let from = email.from().and_then(|addresses| addresses.first());
                let recipients = |addresses: Option<&[jmap_client::email::EmailAddress]>| addresses.unwrap_or_default().iter().map(|address| MailRecipient {
                    name: address.name().map(str::to_string), email: address.email().to_string(),
                }).collect();
                Some(MailThread {
                    conversation_id: (*thread_id).to_string(),
                    topic: email.subject().unwrap_or_default().to_string(),
                    snippet: email.preview().unwrap_or_default().to_string(),
                    last_delivery_time: (*scheduled_at).to_string(),
                    message_count: 1, unread_count: 0,
                    from_name: from.and_then(|address| address.name().map(str::to_string)),
                    from_email: from.map(|address| address.email().to_string()),
                    has_attachments: email.has_attachment(),
                    to_recipients: recipients(email.to()), cc_recipients: recipients(email.cc()), unique_senders: vec![],
                })
            }).collect();
            threads.sort_by(|a, b| a.last_delivery_time.cmp(&b.last_delivery_time));
            threads.truncate(count as usize);
            return Ok(threads);
        }

        let mailbox_id = match folder {
            "inbox" | "sentitems" | "deleteditems" | "drafts" | "spam" => {
                let ids = get_folder_ids(&self.state, &client, &self.config).await?;
                ids.get(folder).cloned().unwrap_or_else(|| folder.to_string())
            }
            "snoozed" => get_or_create_snoozed_id(&self.state, &client, &self.config).await?,
            _ => folder.to_string(),
        };

        let is_snoozed = folder == "snoozed";
        let query_limit = if is_snoozed { count as usize } else { email_limit as usize };
        let query_position = if is_snoozed {
            self.config.list_offset
        } else {
            self.config.list_offset.saturating_mul(4)
        };

        let mut request = client.build();
        {
            let q = request.query_email()
                .filter(EmailFilter::in_mailbox(&mailbox_id))
                .sort([EmailComparator::received_at().descending()])
                .position(query_position as i32)
                .limit(query_limit);
            if is_snoozed {
                q.arguments().collapse_threads(true);
            }
        }
        let ref_ = request.last_result_reference("/ids");
        request.get_email()
            .ids_ref(ref_)
            .properties([
                EmailProperty::Id,
                EmailProperty::ThreadId,
                EmailProperty::Subject,
                EmailProperty::From,
                EmailProperty::To,
                EmailProperty::Cc,
                EmailProperty::ReceivedAt,
                EmailProperty::Preview,
                EmailProperty::HasAttachment,
                EmailProperty::Keywords,
            ]);

        let mut response = request.send().await.map_err(|e| e.to_string())?;
        let emails = response.method_response_by_pos(1).unwrap_get_email().map_err(|e| e.to_string())?;

        let mut thread_map: HashMap<String, MailThread> = HashMap::new();
        let mut thread_order: Vec<String> = Vec::new();
        // Track unique senders per thread (excluding own email)
        let mut sender_seen: HashMap<String, std::collections::HashSet<String>> = HashMap::new();
        let own_email = self.config.email.to_lowercase();

        for email in emails.list() {
            let thread_id = email.thread_id().unwrap_or_default().to_string();
            let from_addr = email.from().and_then(|f| f.first());
            let from_email_str = from_addr.map(|a| a.email().to_string()).unwrap_or_default();

            if let Some(thread) = thread_map.get_mut(&thread_id) {
                thread.message_count += 1;
                if !email.keywords().contains(&"$seen") {
                    thread.unread_count += 1;
                }
                if email.has_attachment() {
                    thread.has_attachments = true;
                }
                // Accumulate additional unique senders
                let seen = sender_seen.entry(thread_id.clone()).or_default();
                let key = from_email_str.to_lowercase();
                if !key.is_empty() && key != own_email && !seen.contains(&key) {
                    seen.insert(key);
                    thread.unique_senders.push(MailRecipient {
                        name: from_addr.and_then(|a| a.name().map(|s| s.to_string())),
                        email: from_email_str,
                    });
                }
            } else {
                thread_order.push(thread_id.clone());
                let from_name = from_addr.and_then(|a| a.name().map(|s| s.to_string()));
                let from_email = from_addr.map(|a| a.email().to_string());
                let to_recipients = email.to().map(|list| list.iter().map(|a| MailRecipient {
                    name: a.name().map(|s| s.to_string()),
                    email: a.email().to_string(),
                }).collect::<Vec<_>>()).unwrap_or_default();
                let cc_recipients = email.cc().map(|list| list.iter().map(|a| MailRecipient {
                    name: a.name().map(|s| s.to_string()),
                    email: a.email().to_string(),
                }).collect::<Vec<_>>()).unwrap_or_default();
                // First sender for this thread
                let mut unique_senders = Vec::new();
                let key = from_email_str.to_lowercase();
                if !key.is_empty() && key != own_email {
                    let seen = sender_seen.entry(thread_id.clone()).or_default();
                    seen.insert(key);
                    unique_senders.push(MailRecipient {
                        name: from_addr.and_then(|a| a.name().map(|s| s.to_string())),
                        email: from_email_str,
                    });
                } else {
                    sender_seen.entry(thread_id.clone()).or_default();
                }
                thread_map.insert(thread_id.clone(), MailThread {
                    conversation_id: thread_id,
                    topic: email.subject().map(|s| s.to_string()).unwrap_or_default(),
                    snippet: email.preview().map(|s| s.to_string()).unwrap_or_default(),
                    last_delivery_time: email.received_at().map(timestamp_to_rfc3339).unwrap_or_default(),
                    message_count: 1,
                    unread_count: if email.keywords().contains(&"$seen") { 0 } else { 1 },
                    from_name,
                    from_email,
                    has_attachments: email.has_attachment(),
                    to_recipients,
                    cc_recipients,
                    unique_senders,
                });
            }
        }

        let mut threads: Vec<MailThread> = thread_order.into_iter().filter_map(|id| thread_map.remove(&id)).collect();
        threads.truncate(count as usize);

        // Email/query above is intentionally restricted to the selected mailbox,
        // so counting those rows alone misses messages that share the thread but
        // remain in another mailbox (notably Sent). Thread/get returns the global
        // emailIds for all visible rows in one batched request.
        if !threads.is_empty() {
            let thread_ids: Vec<String> = threads.iter()
                .map(|thread| thread.conversation_id.clone())
                .collect();
            let mut count_request = client.build();
            count_request.get_thread().ids(thread_ids.iter().map(|id| id.as_str()));
            let mut count_response = count_request.send().await.map_err(|e| e.to_string())?;
            let thread_get = count_response.method_response_by_pos(0)
                .unwrap_get_thread()
                .map_err(|e| e.to_string())?;
            let global_counts: HashMap<&str, u32> = thread_get.list().iter()
                .map(|thread| (thread.id(), thread.email_ids().len() as u32))
                .collect();
            for thread in &mut threads {
                if let Some(global_count) = global_counts.get(thread.conversation_id.as_str()) {
                    thread.message_count = *global_count;
                }
            }
        }
        Ok(threads)
    }

    async fn get_thread(
        &self,
        conversation_id: &str,
        _include_trash: Option<bool>,
        _is_draft: Option<bool>,
        _include_drafts: Option<bool>,
    ) -> Result<Vec<MailMessage>, String> {
        let client = get_client(&self.state, &self.config).await?;

        let mut thread_request = client.build();
        thread_request.get_thread().ids([conversation_id]);
        let mut thread_response = thread_request.send().await.map_err(|e| e.to_string())?;
        let thread_get = thread_response.method_response_by_pos(0).unwrap_get_thread().map_err(|e| e.to_string())?;
        let thread = thread_get.list().first().ok_or("Thread not found")?;
        let email_ids: Vec<String> = thread.email_ids().to_vec();

        let mut email_request = client.build();
        {
            let get_req = email_request.get_email();
            get_req.ids(email_ids.iter().map(|s| s.as_str()))
                .properties([
                    EmailProperty::Id,
                    EmailProperty::ThreadId,
                    EmailProperty::Subject,
                    EmailProperty::From,
                    EmailProperty::To,
                    EmailProperty::Cc,
                    EmailProperty::ReceivedAt,
                    EmailProperty::Preview,
                    EmailProperty::HasAttachment,
                    EmailProperty::Keywords,
                    EmailProperty::HtmlBody,
                    EmailProperty::TextBody,
                    EmailProperty::BodyValues,
                    EmailProperty::Attachments,
                    EmailProperty::MessageId,
                    EmailProperty::InReplyTo,
                    EmailProperty::References,
                ]);
            get_req.arguments()
                .fetch_html_body_values(true)
                .fetch_text_body_values(true)
                .fetch_all_body_values(true);
        }
        let mut response = email_request.send().await.map_err(|e| e.to_string())?;
        let emails = response.method_response_by_pos(0).unwrap_get_email().map_err(|e| e.to_string())?;

        let auth_header = build_auth_header(&self.config);
        let account_id = client.session().primary_accounts().next()
            .map(|a| a.1.as_str()).unwrap_or_default().to_string();
        let dl_template = client.session().download_url().to_string();
        let dl_client = reqwest::Client::new();

        let mut messages = Vec::new();
        for email in emails.list() {
            let body_text = email.text_body()
                .and_then(|b| b.first())
                .and_then(|p| p.part_id())
                .and_then(|id| email.body_value(id))
                .map(|v| v.value().to_string());

            let html_part = email.html_body().and_then(|b| b.first());
            let html_content_type = html_part.and_then(|p| p.content_type()).unwrap_or("text/html");
            let is_plain_text_part = html_content_type == "text/plain";

            let mut body_html = html_part
                .and_then(|p| p.part_id())
                .and_then(|id| email.body_value(id))
                .map(|v| {
                    let text = v.value().to_string();
                    if is_plain_text_part {
                        let escaped = text.replace('&', "&amp;").replace('<', "&lt;").replace('>', "&gt;");
                        format!("<pre style=\"white-space:pre-wrap;font-family:inherit\">{}</pre>", escaped)
                    } else {
                        text
                    }
                })
                .or_else(|| body_text.as_deref().map(|t| {
                    let escaped = t.replace('&', "&amp;").replace('<', "&lt;").replace('>', "&gt;");
                    format!("<pre style=\"white-space:pre-wrap;font-family:inherit\">{}</pre>", escaped)
                }))
                .unwrap_or_default();

            struct InlinePart {
                needle_dq: String,
                needle_sq: String,
                url: String,
                content_type: String,
            }
            let inline_parts: Vec<InlinePart> = email.attachments().unwrap_or(&[])
                .iter()
                .filter_map(|part| {
                    let cid = part.content_id()?;
                    let blob_id = part.blob_id()?;
                    let ct = part.content_type().unwrap_or("application/octet-stream");
                    let cid_clean = cid.trim_matches('<').trim_matches('>');
                    let needle_dq = format!("src=\"cid:{}\"", cid_clean);
                    let needle_sq = format!("src='cid:{}'", cid_clean);
                    if !body_html.contains(&needle_dq) && !body_html.contains(&needle_sq) {
                        return None;
                    }
                    let url = dl_template
                        .replace("{blobId}", blob_id)
                        .replace("{accountId}", &account_id)
                        .replace("{name}", cid_clean)
                        .replace("{type}", ct);
                    Some(InlinePart { needle_dq, needle_sq, url, content_type: ct.to_string() })
                })
                .collect();

            let dl_results: Vec<Option<String>> = join_all(inline_parts.iter().map(|p| {
                let auth_header = auth_header.clone();
                let dl_client = dl_client.clone();
                let url = p.url.clone();
                async move {
                    let resp = dl_client.get(&url).header("Authorization", auth_header).send().await.ok()?;
                    let bytes = resp.bytes().await.ok()?;
                    Some(base64::engine::general_purpose::STANDARD.encode(&bytes))
                }
            })).await;

            for (part, data_b64) in inline_parts.iter().zip(dl_results) {
                if let Some(b64) = data_b64 {
                    let data_uri = format!("data:{};base64,{}", part.content_type, b64);
                    body_html = body_html.replace(&part.needle_dq, &format!("src=\"{}\"", data_uri));
                    body_html = body_html.replace(&part.needle_sq, &format!("src='{}'", data_uri));
                }
            }

            let mut attachments = Vec::new();
            for part in email.attachments().unwrap_or(&[]) {
                if part.content_id().is_some() { continue; }
                attachments.push(MailAttachment {
                    attachment_id: part.blob_id().unwrap_or_default().to_string(),
                    name: part.name().unwrap_or_default().to_string(),
                    content_type: part.content_type().unwrap_or_default().to_string(),
                    size: part.size() as u64,
                    is_inline: false,
                });
            }

            messages.push(MailMessage {
                item_id: email.id().unwrap_or_default().to_string(),
                change_key: String::new(),
                subject: email.subject().unwrap_or_default().to_string(),
                from_name: email.from().and_then(|f| f.first()).and_then(|a| a.name().map(|s| s.to_string())),
                from_email: email.from().and_then(|f| f.first()).map(|a| a.email().to_string()),
                to_recipients: email.to().map(|list| list.iter().map(|a| MailRecipient { name: a.name().map(|s| s.to_string()), email: a.email().to_string() }).collect()).unwrap_or_default(),
                cc_recipients: email.cc().map(|list| list.iter().map(|a| MailRecipient { name: a.name().map(|s| s.to_string()), email: a.email().to_string() }).collect()).unwrap_or_default(),
                body_html,
                date_time_received: email.received_at().map(timestamp_to_rfc3339).unwrap_or_default(),
                is_read: email.keywords().contains(&"$seen"),
                has_attachments: !attachments.is_empty(),
                attachments,
                message_id: email.message_id()
                    .and_then(|ids| ids.first())
                    .map(|id| if id.starts_with('<') { id.to_string() } else { format!("<{}>", id) }),
                references: email.references()
                    .map(|ids| ids.iter()
                        .map(|id| if id.starts_with('<') { id.to_string() } else { format!("<{}>", id) })
                        .collect::<Vec<_>>()
                        .join(" ")),
                body_text,
                ics_mime: None,
                is_draft: None,
            });
        }

        messages.sort_by(|a, b| a.date_time_received.cmp(&b.date_time_received));
        Ok(messages)
    }

    async fn mark_read(&self, items: &[MailItemRef]) -> Result<(), String> {
        let client = get_client(&self.state, &self.config).await?;
        let mut request = client.build();
        let set = request.set_email();
        for item in items {
            set.update(&item.item_id).keyword("$seen", true);
        }
        request.send().await.map_err(|e| e.to_string())?;
        Ok(())
    }

    async fn mark_unread(&self, items: &[MailItemRef]) -> Result<(), String> {
        let client = get_client(&self.state, &self.config).await?;
        let mut request = client.build();
        let set = request.set_email();
        for item in items {
            set.update(&item.item_id).keyword("$seen", false);
        }
        request.send().await.map_err(|e| e.to_string())?;
        Ok(())
    }

    async fn move_to_trash(&self, item_id: &str) -> Result<(), String> {
        let client = get_client(&self.state, &self.config).await?;
        let folder_ids = get_folder_ids(&self.state, &client, &self.config).await?;
        let trash_id = folder_ids.get("deleteditems").cloned().ok_or("Trash mailbox not found")?;
        let sent_id = folder_ids.get("sentitems").cloned();
        jmap_move_email(&client, item_id, &trash_id, sent_id.as_deref()).await?;
        Ok(())
    }

    async fn permanently_delete(&self, item_id: &str) -> Result<(), String> {
        let client = get_client(&self.state, &self.config).await?;
        let mut request = client.build();
        request.set_email().destroy([item_id]);
        let mut response = request.send().await.map_err(|e| e.to_string())?;
        let set_resp = response.method_response_by_pos(0)
            .unwrap_set_email()
            .map_err(|e| format!("Email/set response error: {}", e))?;
        if let Some(mut not_destroyed) = set_resp.not_destroyed_ids() {
            if not_destroyed.any(|i| i == item_id) {
                return Err(format!("Email/set destroy refused by server for {}", item_id));
            }
        }
        Ok(())
    }

    async fn bulk_move_to_trash(&self, item_ids: Vec<String>) -> Result<(), String> {
        if item_ids.is_empty() { return Ok(()); }
        let client = get_client(&self.state, &self.config).await?;
        let folder_ids = get_folder_ids(&self.state, &client, &self.config).await?;
        let trash_id = folder_ids.get("deleteditems").cloned().ok_or("Trash mailbox not found")?;

        let email_ids = jmap_thread_ids_to_email_ids(&client, &item_ids).await?;
        if email_ids.is_empty() { return Ok(()); }

        let trash_ref = trash_id.as_str();
        let mut request = client.build();
        let set = request.set_email();
        for id in &email_ids {
            set.update(id.as_str()).mailbox_ids([trash_ref]);
        }
        request.send().await.map_err(|e| e.to_string())?;
        Ok(())
    }

    async fn bulk_permanently_delete(&self, item_ids: Vec<String>) -> Result<(), String> {
        if item_ids.is_empty() { return Ok(()); }
        let client = get_client(&self.state, &self.config).await?;
        let email_ids = jmap_thread_ids_to_email_ids(&client, &item_ids).await?;
        if email_ids.is_empty() { return Ok(()); }
        let mut request = client.build();
        request.set_email().destroy(email_ids.iter().map(|s| s.as_str()));
        request.send().await.map_err(|e| e.to_string())?;
        Ok(())
    }

    async fn send_mail(&self, params: SendMailParams) -> Result<(), String> {
        let action_config = if params.send_at.is_some() {
            fastmail_config(&self.config).ok_or_else(|| "Fastmail web token required for scheduled send".to_string())?
        } else {
            self.config.clone()
        };
        let client = get_client(&self.state, &action_config).await?;

        let mut req = client.build();
        req.add_capability(URI::Submission);
        req.get_identity();
        req.get_mailbox();
        let mut resp = req.send().await.map_err(|e| format!("Identity+Mailbox/get: {}", e))?;
        let identities = resp.method_response_by_pos(0)
            .unwrap_get_identity()
            .map_err(|e| format!("Identity/get: {}", e))?;
        let mailboxes = resp.method_response_by_pos(1)
            .unwrap_get_mailbox()
            .map_err(|e| format!("Mailbox/get: {}", e))?;

        let identity = if let Some(ref id) = params.identity_id {
            identities.list().iter().find(|i| i.id() == Some(id.as_str()))
                .or_else(|| identities.list().iter().find(|i| !i.may_delete()))
                .or_else(|| identities.list().first())
        } else {
            identities.list().iter().find(|i| !i.may_delete())
                .or_else(|| identities.list().first())
        };

        let from_email = identity.and_then(|i| i.email()).unwrap_or(self.config.email.as_str());
        let from_name = identity.and_then(|i| i.name()).unwrap_or_default();
        let resolved_identity_id = identity.and_then(|i| i.id())
            .map(|s| s.to_string())
            .unwrap_or_default();

        let from_header = if from_name.is_empty() {
            from_email.to_string()
        } else {
            format!("{} <{}>", from_name, from_email)
        };

        let sent_id = mailboxes.list().iter()
            .find(|m| m.role() == Role::Sent)
            .and_then(|m| m.id())
            .map(|s| s.to_string());

        let raw_message = build_mime_message(&from_header, &params)?;

        let mailbox_ids: Vec<String> = sent_id.into_iter().collect();
        let email = client.email_import(raw_message, mailbox_ids, None::<Vec<&str>>, None)
            .await
            .map_err(|e| format!("Email/import: {}", e))?;
        let email_id = email.id().unwrap_or_default().to_string();

        if let Some(send_at) = params.send_at.as_deref() {
            let send_at = chrono::DateTime::parse_from_rfc3339(send_at)
                .map_err(|e| format!("Invalid scheduled-send date: {e}"))?
                .with_timezone(&chrono::Utc);
            let session = client.session();
            let max_delay = session.submission_capabilities()
                .map(|c| c.max_delayed_send())
                .unwrap_or(0);
            let requested_delay = (send_at.timestamp() - chrono::Utc::now().timestamp()).max(0) as usize;
            if max_delay == 0 || requested_delay > max_delay {
                return Err(format!("JMAP delayed send unsupported or exceeds server limit ({max_delay}s)"));
            }
            let mut submission = client.build();
            submission.add_capability(URI::Submission);
            let hold_until = send_at.to_rfc3339_opts(chrono::SecondsFormat::Secs, true);
            let mail_from = jmap_client::email_submission::Address::new(from_email)
                .parameter("HOLDUNTIL", Some(hold_until));
            let recipients = params.to.iter().chain(&params.cc).chain(&params.bcc)
                .map(|address| jmap_client::email_submission::Address::new(address));
            submission.set_email_submission().create()
                .email_id(&email_id)
                .identity_id(&resolved_identity_id)
                .envelope(mail_from, recipients);
            let mut response = submission.send().await.map_err(|e| format!("EmailSubmission/set: {e}"))?;
            let set_response = response.method_response_by_pos(0)
                .unwrap_set_email_submission()
                .map_err(|e| format!("EmailSubmission/set response: {e}"))?;
            set_response.unwrap_create_errors().map_err(|e| format!("EmailSubmission/set rejected: {e}"))?;
        } else {
            client.email_submission_create(&email_id, &resolved_identity_id)
                .await
                .map_err(|e| format!("EmailSubmission/set: {}", e))?;
        }
        Ok(())
    }

    async fn get_attachment_data(
        &self,
        attachment_id: &str,
        _message_id: Option<&str>,
        _folder: Option<&str>,
    ) -> Result<String, String> {
        let client = get_client(&self.state, &self.config).await?;
        let account_id = client.session().primary_accounts().next()
            .map(|a| a.1.as_str().to_string()).unwrap_or_default();
        let dl_template = client.session().download_url().to_string();
        let download_url = dl_template
            .replace("{blobId}", attachment_id)
            .replace("{accountId}", &account_id)
            .replace("{name}", "attachment")
            .replace("{type}", "application/octet-stream");

        let auth_header = build_auth_header(&self.config);
        let response = reqwest::Client::new()
            .get(&download_url)
            .header("Authorization", &auth_header)
            .send()
            .await
            .map_err(|e| e.to_string())?;

        let status = response.status();
        if !status.is_success() {
            return Err(format!("{}", status));
        }
        let bytes = response.bytes().await.map_err(|e| e.to_string())?;
        Ok(base64::engine::general_purpose::STANDARD.encode(bytes))
    }

    async fn search_threads(&self, query: &MailSearchQuery, max_count: Option<u32>) -> Result<Vec<MailThread>, String> {
        use jmap_client::core::query::Filter as QFilter;

        let client = get_client(&self.state, &self.config).await?;
        let count = max_count.unwrap_or(50);

        let mut filters: Vec<EmailFilter> = Vec::new();
        if let Some(ref from) = query.from { filters.push(EmailFilter::from(from.clone())); }
        if let Some(ref to) = query.to { filters.push(EmailFilter::to(to.clone())); }
        if let Some(ref subject) = query.subject { filters.push(EmailFilter::subject(subject.clone())); }
        if let Some(ref text) = query.text { filters.push(EmailFilter::body(text.clone())); }

        let mut request = client.build();
        {
            let q = request.query_email();
            match filters.len() {
                0 => {}
                1 => { q.filter(filters.remove(0)); }
                _ => { q.filter(QFilter::and(filters)); }
            }
            q.sort([EmailComparator::received_at().descending()])
                .limit(count as usize);
        }
        let ref_ = request.last_result_reference("/ids");
        request.get_email()
            .ids_ref(ref_)
            .properties([
                EmailProperty::Id,
                EmailProperty::ThreadId,
                EmailProperty::Subject,
                EmailProperty::From,
                EmailProperty::To,
                EmailProperty::Cc,
                EmailProperty::ReceivedAt,
                EmailProperty::Preview,
                EmailProperty::HasAttachment,
                EmailProperty::Keywords,
            ]);

        let mut response = request.send().await.map_err(|e| e.to_string())?;
        let emails = response.method_response_by_pos(1).unwrap_get_email().map_err(|e| e.to_string())?;

        let mut thread_map: HashMap<String, MailThread> = HashMap::new();
        let mut thread_order: Vec<String> = Vec::new();

        let own_email = self.config.email.to_lowercase();
        for email in emails.list() {
            let thread_id = email.thread_id().unwrap_or_default().to_string();
            if !thread_map.contains_key(&thread_id) {
                thread_order.push(thread_id.clone());
                let from_addr = email.from().and_then(|f| f.first());
                let from_name = from_addr.and_then(|a| a.name().map(|s| s.to_string()));
                let from_email_str = from_addr.map(|a| a.email().to_string()).unwrap_or_default();
                let to_recipients = email.to().map(|list| list.iter().map(|a| MailRecipient {
                    name: a.name().map(|s| s.to_string()),
                    email: a.email().to_string(),
                }).collect::<Vec<_>>()).unwrap_or_default();
                let cc_recipients = email.cc().map(|list| list.iter().map(|a| MailRecipient {
                    name: a.name().map(|s| s.to_string()),
                    email: a.email().to_string(),
                }).collect::<Vec<_>>()).unwrap_or_default();
                let unique_senders = if !from_email_str.is_empty() && from_email_str.to_lowercase() != own_email {
                    vec![MailRecipient {
                        name: from_addr.and_then(|a| a.name().map(|s| s.to_string())),
                        email: from_email_str.clone(),
                    }]
                } else { vec![] };
                thread_map.insert(thread_id.clone(), MailThread {
                    conversation_id: thread_id,
                    topic: email.subject().map(|s| s.to_string()).unwrap_or_default(),
                    snippet: email.preview().map(|s| s.to_string()).unwrap_or_default(),
                    last_delivery_time: email.received_at().map(timestamp_to_rfc3339).unwrap_or_default(),
                    message_count: 1,
                    unread_count: if email.keywords().contains(&"$seen") { 0 } else { 1 },
                    from_name,
                    from_email: if from_email_str.is_empty() { None } else { Some(from_email_str) },
                    has_attachments: email.has_attachment(),
                    to_recipients,
                    cc_recipients,
                    unique_senders,
                });
            }
        }

        Ok(thread_order.into_iter().filter_map(|id| thread_map.remove(&id)).collect())
    }

    async fn move_to_folder(&self, item_id: &str, folder_id: &str) -> Result<(), String> {
        let client = get_client(&self.state, &self.config).await?;
        let folder_ids = get_folder_ids(&self.state, &client, &self.config).await?;
        let sent_id = folder_ids.get("sentitems").cloned();
        let resolved_folder_id = folder_ids.get(folder_id).cloned().unwrap_or_else(|| folder_id.to_string());
        jmap_move_email(&client, item_id, &resolved_folder_id, sent_id.as_deref()).await?;
        Ok(())
    }

    async fn bulk_move_to_folder(&self, item_ids: Vec<String>, folder_id: &str) -> Result<(), String> {
        if item_ids.is_empty() { return Ok(()); }
        let client = get_client(&self.state, &self.config).await?;
        let email_ids = jmap_thread_ids_to_email_ids(&client, &item_ids).await?;
        if email_ids.is_empty() { return Ok(()); }
        let folder_ids_map = get_folder_ids(&self.state, &client, &self.config).await?;
        // `snoozed` is an application-level well-known key, not a JMAP mailbox
        // ID. Resolve (or create) it before building Email/set; sending the
        // literal string "snoozed" makes standards-compliant servers reject the
        // whole update.
        let resolved_folder_id = if folder_id == "snoozed" {
            get_or_create_snoozed_id(&self.state, &client, &self.config).await?
        } else {
            folder_ids_map.get(folder_id).cloned().unwrap_or_else(|| folder_id.to_string())
        };
        let sent_id = folder_ids_map.get("sentitems").cloned();

        // Find which emails have Sent membership so we can preserve it.
        let sent_email_ids: std::collections::HashSet<String> = if let Some(ref sid) = sent_id {
            let mut fetch = client.build();
            fetch.get_email()
                .ids(email_ids.iter().map(|s| s.as_str()))
                .properties([EmailProperty::Id, EmailProperty::MailboxIds]);
            let mut fetch_resp = fetch.send().await.map_err(|e| format!("Email/get mailboxIds: {}", e))?;
            let fetched = fetch_resp.method_response_by_pos(0)
                .unwrap_get_email()
                .map_err(|e| format!("Email/get mailboxIds parse: {}", e))?;
            fetched.list().iter()
                .filter(|e| {
                    let mids: Vec<String> = e.mailbox_ids().iter().map(|s| s.to_string()).collect();
                    mids.iter().any(|m| m == sid)
                })
                .filter_map(|e| e.id().map(|s| s.to_string()))
                .collect()
        } else {
            std::collections::HashSet::new()
        };

        let folder_ref = resolved_folder_id.as_str();
        let mut request = client.build();
        let set = request.set_email();
        for id in &email_ids {
            if sent_email_ids.contains(id.as_str()) {
                if let Some(ref sid) = sent_id {
                    set.update(id.as_str()).mailbox_ids([folder_ref, sid.as_str()]);
                } else {
                    set.update(id.as_str()).mailbox_ids([folder_ref]);
                }
            } else {
                set.update(id.as_str()).mailbox_ids([folder_ref]);
            }
        }
        request.send().await.map_err(|e| e.to_string())?;
        Ok(())
    }

    async fn find_or_create_snoozed_folder(&self) -> Result<String, String> {
        let client = get_client(&self.state, &self.config).await?;
        get_or_create_snoozed_id(&self.state, &client, &self.config).await
    }

    async fn snooze(&self, item_id: &str) -> Result<String, String> {
        let client = get_client(&self.state, &self.config).await?;
        let snoozed_id = get_or_create_snoozed_id(&self.state, &client, &self.config).await?;
        let folder_ids = get_folder_ids(&self.state, &client, &self.config).await?;
        let sent_id = folder_ids.get("sentitems").cloned();
        jmap_move_email(&client, item_id, &snoozed_id, sent_id.as_deref()).await?;
        Ok(snoozed_id)
    }

    async fn list_identities(&self) -> Result<Vec<MailIdentity>, String> {
        let client = get_client(&self.state, &self.config).await?;
        let mut request = client.build();
        request.add_capability(URI::Submission);
        request.get_identity();
        let mut response = request.send().await.map_err(|e| e.to_string())?;
        let identity_get = response.method_response_by_pos(0)
            .unwrap_get_identity()
            .map_err(|e| e.to_string())?;
        Ok(identity_get.list().iter().map(|i| MailIdentity {
            id: i.id().unwrap_or_default().to_string(),
            name: i.name().unwrap_or_default().to_string(),
            email: i.email().unwrap_or_default().to_string(),
            may_delete: i.may_delete(),
        }).collect())
    }
}

// ── Tauri commands (thin wrappers) ────────────────────────────────────────────

#[command]
pub async fn jmap_list_folders(
    state: tauri::State<'_, Arc<JmapClientState>>,
    config: JmapConfig,
) -> Result<Vec<MailFolder>, String> {
    JmapProvider { config, state: Arc::clone(&state) }.list_folders().await
}

#[command]
pub async fn jmap_get_inbox_unread(
    state: tauri::State<'_, Arc<JmapClientState>>,
    config: JmapConfig,
) -> Result<u32, String> {
    JmapProvider { config, state: Arc::clone(&state) }.get_inbox_unread().await
}

#[command]
pub async fn jmap_list_threads(
    state: tauri::State<'_, Arc<JmapClientState>>,
    mut config: JmapConfig,
    folder: String,
    max_count: Option<u32>,
    offset: Option<u32>,
) -> Result<Vec<MailThread>, String> {
    config.list_offset = offset.unwrap_or(0);
    JmapProvider { config, state: Arc::clone(&state) }.list_threads(&folder, max_count).await
}

#[command]
pub async fn jmap_search_threads(
    state: tauri::State<'_, Arc<JmapClientState>>,
    config: JmapConfig,
    query: MailSearchQuery,
    max_count: Option<u32>,
) -> Result<Vec<MailThread>, String> {
    JmapProvider { config, state: Arc::clone(&state) }.search_threads(&query, max_count).await
}

#[command]
pub async fn jmap_get_thread(
    state: tauri::State<'_, Arc<JmapClientState>>,
    config: JmapConfig,
    conversation_id: String,
) -> Result<Vec<MailMessage>, String> {
    JmapProvider { config, state: Arc::clone(&state) }.get_thread(&conversation_id, None, None, None).await
}

#[command]
pub async fn jmap_mark_read(
    state: tauri::State<'_, Arc<JmapClientState>>,
    config: JmapConfig,
    ids: Vec<String>,
) -> Result<(), String> {
    let items: Vec<MailItemRef> = ids.into_iter()
        .map(|id| MailItemRef { item_id: id, change_key: String::new(), conversation_id: None, folder: None })
        .collect();
    JmapProvider { config, state: Arc::clone(&state) }.mark_read(&items).await
}

#[command]
pub async fn jmap_mark_unread(
    state: tauri::State<'_, Arc<JmapClientState>>,
    config: JmapConfig,
    ids: Vec<String>,
) -> Result<(), String> {
    let items: Vec<MailItemRef> = ids.into_iter()
        .map(|id| MailItemRef { item_id: id, change_key: String::new(), conversation_id: None, folder: None })
        .collect();
    JmapProvider { config, state: Arc::clone(&state) }.mark_unread(&items).await
}

/// Move a single email to `target_mailbox_id`, preserving Sent membership.
async fn jmap_move_email(
    client: &Client,
    id: &str,
    target_mailbox_id: &str,
    sent_mailbox_id: Option<&str>,
) -> Result<bool, String> {
    let mut fetch = client.build();
    fetch.get_email().ids([id]).properties([EmailProperty::Id, EmailProperty::MailboxIds]);
    let mut fetch_resp = fetch.send().await.map_err(|e| format!("Email/get mailboxIds: {}", e))?;
    let emails = fetch_resp.method_response_by_pos(0)
        .unwrap_get_email()
        .map_err(|e| format!("Email/get mailboxIds parse: {}", e))?;

    let current_mailbox_ids: Vec<String> = emails.list()
        .first()
        .map(|e| e.mailbox_ids().iter().map(|s| s.to_string()).collect())
        .unwrap_or_default();

    // Full mailboxIds replacement: target + Sent (if email was already in Sent).
    // Sent-only emails are included — they get [target, Sent] so the full thread
    // is visible in the destination folder while remaining in Sent.
    // We avoid the patch API because jmap-client serialises `false` instead of
    // `null`, and JMAP servers require `null` to remove map entries.
    let mut new_ids: Vec<&str> = vec![target_mailbox_id];
    if let Some(sent_id) = sent_mailbox_id {
        if current_mailbox_ids.iter().any(|m| m.as_str() == sent_id) {
            new_ids.push(sent_id);
        }
    }

    let mut request = client.build();
    let update = request.set_email().update(id);
    update.mailbox_ids(new_ids);

    let mut response = request.send().await.map_err(|e| e.to_string())?;
    let set_resp = response.method_response_by_pos(0)
        .unwrap_set_email()
        .map_err(|e| format!("Email/set response error: {}", e))?;
    set_resp.unwrap_update_errors().map_err(|e| format!("Email/set update error: {}", e))?;
    Ok(true)
}

/// Resolve thread IDs → email IDs via Thread/get in a single JMAP call.
async fn jmap_thread_ids_to_email_ids(client: &Client, thread_ids: &[String]) -> Result<Vec<String>, String> {
    let mut thread_req = client.build();
    thread_req.get_thread().ids(thread_ids.iter().map(|s| s.as_str()));
    let mut thread_resp = thread_req.send().await.map_err(|e| e.to_string())?;
    let thread_get = thread_resp.method_response_by_pos(0)
        .unwrap_get_thread()
        .map_err(|e| e.to_string())?;
    Ok(thread_get.list().iter().flat_map(|t| t.email_ids().to_vec()).collect())
}

#[command]
pub async fn jmap_move_to_trash(
    state: tauri::State<'_, Arc<JmapClientState>>,
    config: JmapConfig,
    id: String,
) -> Result<(), String> {
    JmapProvider { config, state: Arc::clone(&state) }.move_to_trash(&id).await
}

#[command]
pub async fn jmap_move_to_folder(
    state: tauri::State<'_, Arc<JmapClientState>>,
    config: JmapConfig,
    id: String,
    folder_id: String,
) -> Result<(), String> {
    JmapProvider { config, state: Arc::clone(&state) }.move_to_folder(&id, &folder_id).await
}

#[command]
pub async fn jmap_permanently_delete(
    state: tauri::State<'_, Arc<JmapClientState>>,
    config: JmapConfig,
    id: String,
) -> Result<(), String> {
    JmapProvider { config, state: Arc::clone(&state) }.permanently_delete(&id).await
}

#[command]
pub async fn jmap_bulk_move_to_trash(
    state: tauri::State<'_, Arc<JmapClientState>>,
    config: JmapConfig,
    thread_ids: Vec<String>,
) -> Result<(), String> {
    JmapProvider { config, state: Arc::clone(&state) }.bulk_move_to_trash(thread_ids).await
}

#[command]
pub async fn jmap_bulk_permanently_delete(
    state: tauri::State<'_, Arc<JmapClientState>>,
    config: JmapConfig,
    thread_ids: Vec<String>,
) -> Result<(), String> {
    JmapProvider { config, state: Arc::clone(&state) }.bulk_permanently_delete(thread_ids).await
}

#[command]
pub async fn jmap_bulk_move_to_folder(
    state: tauri::State<'_, Arc<JmapClientState>>,
    config: JmapConfig,
    thread_ids: Vec<String>,
    folder_id: String,
) -> Result<(), String> {
    JmapProvider { config, state: Arc::clone(&state) }.bulk_move_to_folder(thread_ids, &folder_id).await
}

#[command]
pub async fn jmap_find_or_create_snoozed_folder(
    state: tauri::State<'_, Arc<JmapClientState>>,
    config: JmapConfig,
) -> Result<String, String> {
    JmapProvider { config, state: Arc::clone(&state) }.find_or_create_snoozed_folder().await
}

#[command]
pub async fn jmap_snooze(
    state: tauri::State<'_, Arc<JmapClientState>>,
    config: JmapConfig,
    id: String,
    until: Option<String>,
) -> Result<String, String> {
    let private_config = fastmail_config(&config).ok_or_else(|| "Fastmail web token required for snooze".to_string())?;
    let client = get_client(&state, &private_config).await?;
    let snoozed_id = get_or_create_snoozed_id(&state, &client, &private_config).await?;
    let folders = get_folder_ids(&state, &client, &private_config).await?;
    let inbox_id = folders.get("inbox").cloned();
    let sent_id = folders.get("sentitems").cloned();
    let until = until.ok_or_else(|| "JMAP snooze requires an awaken time".to_string())?;
    let until = chrono::DateTime::parse_from_rfc3339(&until)
        .map_err(|e| format!("Invalid snooze date: {e}"))?
        .with_timezone(&chrono::Utc);

    let mut fetch = client.build();
    fetch.get_email().ids([id.as_str()]).properties([EmailProperty::Id, EmailProperty::MailboxIds]);
    let mut fetch_response = fetch.send().await.map_err(|e| format!("Email/get before snooze: {e}"))?;
    let emails = fetch_response.method_response_by_pos(0)
        .unwrap_get_email()
        .map_err(|e| format!("Email/get before snooze parse: {e}"))?;
    let was_sent = sent_id.as_ref().is_some_and(|sent| {
        emails.list().first().is_some_and(|email| email.mailbox_ids().iter().any(|mailbox| mailbox == sent))
    });

    let mut request = client.build();
    request.add_capability(URI::FastmailMail);
    let update = request.set_email().update(id.as_str());
    if was_sent {
        update.mailbox_ids([snoozed_id.as_str(), sent_id.as_deref().unwrap_or_default()]);
    } else {
        update.mailbox_ids([snoozed_id.as_str()]);
    }
    update.snoozed(until, inbox_id);

    let mut response = request.send().await.map_err(|e| format!("Email/set snooze: {e}"))?;
    let set_response = response.method_response_by_pos(0)
        .unwrap_set_email()
        .map_err(|e| format!("Email/set snooze response: {e}"))?;
    set_response.unwrap_update_errors().map_err(|e| format!("Email/set snooze rejected: {e}"))?;
    if !set_response.has_updated() {
        return Err("Email/set snooze returned no updated email".to_string());
    }
    Ok(snoozed_id)
}

#[command]
pub async fn jmap_list_identities(
    state: tauri::State<'_, Arc<JmapClientState>>,
    config: JmapConfig,
) -> Result<Vec<MailIdentity>, String> {
    JmapProvider { config, state: Arc::clone(&state) }.list_identities().await
}

#[command]
pub async fn jmap_send(
    state: tauri::State<'_, Arc<JmapClientState>>,
    config: JmapConfig,
    to: Vec<String>,
    cc: Vec<String>,
    bcc: Vec<String>,
    subject: String,
    body_html: String,
    attachments: Option<Vec<ComposerAttachment>>,
    identity_id: Option<String>,
    in_reply_to: Option<String>,
    references: Option<String>,
    send_at: Option<String>,
) -> Result<(), String> {
    JmapProvider { config, state: Arc::clone(&state) }.send_mail(SendMailParams {
        to,
        cc,
        bcc,
        subject,
        body_html,
        identity_id,
        in_reply_to,
        references,
        reply_to_item_id: None,
        reply_to_change_key: None,
        attachments,
        is_forward: None,
        send_at,
    }).await
}

#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct JmapProviderCapabilities {
    snooze: bool,
    scheduled_send: ScheduledSendCapability,
}

#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ScheduledSendCapability {
    supported: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    max_delay_seconds: Option<usize>,
}

#[command]
pub async fn jmap_get_capabilities(
    state: tauri::State<'_, Arc<JmapClientState>>,
    config: JmapConfig,
) -> Result<JmapProviderCapabilities, String> {
    let client = get_client(&state, &config).await?;
    let session = client.session();
    // maxDelayedSend is a server-level capability, not account-level.
    let max_delay = session.submission_capabilities()
        .map(|c| c.max_delayed_send())
        .unwrap_or(0);
    Ok(JmapProviderCapabilities {
        snooze: false,
        scheduled_send: ScheduledSendCapability {
            supported: max_delay > 0,
            max_delay_seconds: (max_delay > 0).then_some(max_delay),
        },
    })
}

#[command]
pub async fn jmap_get_attachment_data(
    state: tauri::State<'_, Arc<JmapClientState>>,
    config: JmapConfig,
    blob_id: String,
) -> Result<String, String> {
    JmapProvider { config, state: Arc::clone(&state) }.get_attachment_data(&blob_id, None, None).await
}
