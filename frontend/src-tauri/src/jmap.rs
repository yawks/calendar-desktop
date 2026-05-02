use serde::{Deserialize, Serialize};
use tauri::command;
use jmap_client::client::{Client, Credentials};
use jmap_client::email::Property as EmailProperty;
use jmap_client::email::query::Filter as EmailFilter;
use jmap_client::email::query::Comparator as EmailComparator;
use jmap_client::mailbox::Role;
use jmap_client::URI;
use std::collections::HashMap;
use std::sync::Arc;
use base64::Engine;
use chrono::DateTime;
use futures::future::join_all;
use tokio::sync::Mutex;

#[derive(Deserialize, Debug, Clone)]
pub struct JmapConfig {
    pub email: String,
    pub session_url: String,
    pub token: String,
    pub auth_type: Option<String>, // "bearer" (default) or "basic"
    pub color: Option<String>,
}

#[derive(Serialize, Debug)]
pub struct JmapIdentity {
    pub id: String,
    pub name: String,
    pub email: String,
    pub may_delete: bool,
}

#[derive(Serialize, Debug, Clone)]
pub struct JmapFolder {
    pub folder_id: String,
    pub display_name: String,
    pub total_count: u32,
    pub unread_count: u32,
}

#[derive(Serialize, Debug, Clone)]
pub struct JmapThread {
    pub conversation_id: String,
    pub topic: String,
    pub snippet: String,
    pub last_delivery_time: String,
    pub message_count: u32,
    pub unread_count: u32,
    pub from_name: Option<String>,
    pub has_attachments: bool,
}

#[derive(Serialize, Debug, Clone)]
pub struct JmapMessage {
    pub item_id: String,
    pub change_key: String,
    pub subject: String,
    pub from_name: Option<String>,
    pub from_email: Option<String>,
    pub to_recipients: Vec<JmapRecipient>,
    pub cc_recipients: Vec<JmapRecipient>,
    pub body_html: String,
    pub date_time_received: String,
    pub is_read: bool,
    pub has_attachments: bool,
    pub attachments: Vec<JmapAttachment>,
    pub message_id: Option<String>,
    pub references: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub body_text: Option<String>,
}

#[derive(Serialize, Debug, Clone)]
pub struct JmapRecipient {
    pub name: Option<String>,
    pub email: String,
}

#[derive(Serialize, Debug, Clone)]
pub struct JmapAttachment {
    pub attachment_id: String,
    pub name: String,
    pub content_type: String,
    pub size: u64,
    pub is_inline: bool,
}

#[derive(Deserialize, Debug)]
pub struct MailSearchQuery {
    pub from:    Option<String>,
    pub to:      Option<String>,
    pub cc:      Option<String>,
    pub bcc:     Option<String>,
    pub subject: Option<String>,
    pub text:    Option<String>,
    pub folder:  Option<String>,
    pub date:    Option<String>,
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
            Role::Inbox  => { folders.insert("inbox".to_string(),       id.to_string()); }
            Role::Sent   => { folders.insert("sentitems".to_string(),   id.to_string()); }
            Role::Trash  => { folders.insert("deleteditems".to_string(), id.to_string()); }
            Role::Drafts => { folders.insert("drafts".to_string(),      id.to_string()); }
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

// ── Commands ──────────────────────────────────────────────────────────────────

#[command]
pub async fn jmap_list_folders(
    state: tauri::State<'_, JmapClientState>,
    config: JmapConfig,
) -> Result<Vec<JmapFolder>, String> {
    let client = get_client(&state, &config).await?;
    let mut request = client.build();
    request.get_mailbox();
    let mut response = request.send().await.map_err(|e| e.to_string())?;
    let mailboxes = response.method_response_by_pos(0).unwrap_get_mailbox().map_err(|e| e.to_string())?;

    let mut folders = Vec::new();
    for mailbox in mailboxes.list() {
        folders.push(JmapFolder {
            folder_id: mailbox.id().unwrap_or_default().to_string(),
            display_name: mailbox.name().unwrap_or_default().to_string(),
            total_count: mailbox.total_emails() as u32,
            unread_count: mailbox.unread_emails() as u32,
        });
    }
    Ok(folders)
}

#[command]
pub async fn jmap_get_inbox_unread(
    state: tauri::State<'_, JmapClientState>,
    config: JmapConfig,
) -> Result<u32, String> {
    let client = get_client(&state, &config).await?;
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

#[command]
pub async fn jmap_list_threads(
    state: tauri::State<'_, JmapClientState>,
    config: JmapConfig,
    folder: String,
    max_count: Option<u32>,
) -> Result<Vec<JmapThread>, String> {
    let client = get_client(&state, &config).await?;
    let count = max_count.unwrap_or(50);
    let email_limit = count * 4;

    let mailbox_id = match folder.as_str() {
        "inbox" | "sentitems" | "deleteditems" | "drafts" => {
            let ids = get_folder_ids(&state, &client, &config).await?;
            ids.get(&folder).cloned().unwrap_or(folder.clone())
        }
        "snoozed" => get_or_create_snoozed_id(&state, &client, &config).await?,
        _ => folder.clone(),
    };

    // For snoozed we collapse by thread so the server returns exactly one email
    // per thread (the most recent). Without this, a thread with N messages in
    // the Snoozed mailbox would consume N slots of the limit, causing many
    // snoozed conversations to be invisible.
    let is_snoozed = folder == "snoozed";
    let query_limit = if is_snoozed { count as usize } else { email_limit as usize };

    let mut request = client.build();
    {
        let q = request.query_email()
            .filter(EmailFilter::in_mailbox(&mailbox_id))
            .sort([EmailComparator::received_at().descending()])
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
            EmailProperty::ReceivedAt,
            EmailProperty::Preview,
            EmailProperty::HasAttachment,
            EmailProperty::Keywords,
        ]);

    let mut response = request.send().await.map_err(|e| e.to_string())?;
    let emails = response.method_response_by_pos(1).unwrap_get_email().map_err(|e| e.to_string())?;

    let mut thread_map: HashMap<String, JmapThread> = HashMap::new();
    let mut thread_order: Vec<String> = Vec::new();

    for email in emails.list() {
        let thread_id = email.thread_id().unwrap_or_default().to_string();
        if let Some(thread) = thread_map.get_mut(&thread_id) {
            thread.message_count += 1;
            if !email.keywords().contains(&"$seen") {
                thread.unread_count += 1;
            }
            if email.has_attachment() {
                thread.has_attachments = true;
            }
        } else {
            thread_order.push(thread_id.clone());
            let from_name = email.from().and_then(|f| f.first()).and_then(|a| a.name().map(|s| s.to_string()));
            thread_map.insert(thread_id.clone(), JmapThread {
                conversation_id: thread_id,
                topic: email.subject().map(|s| s.to_string()).unwrap_or_default(),
                snippet: email.preview().map(|s| s.to_string()).unwrap_or_default(),
                last_delivery_time: email.received_at().map(timestamp_to_rfc3339).unwrap_or_default(),
                message_count: 1,
                unread_count: if email.keywords().contains(&"$seen") { 0 } else { 1 },
                from_name,
                has_attachments: email.has_attachment(),
            });
        }
    }

    let mut threads: Vec<JmapThread> = thread_order.into_iter().filter_map(|id| thread_map.remove(&id)).collect();
    threads.truncate(count as usize);
    Ok(threads)
}

#[command]
pub async fn jmap_search_threads(
    state: tauri::State<'_, JmapClientState>,
    config: JmapConfig,
    query: MailSearchQuery,
    max_count: Option<u32>,
) -> Result<Vec<JmapThread>, String> {
    use jmap_client::core::query::Filter as QFilter;

    let client = get_client(&state, &config).await?;
    let count = max_count.unwrap_or(50);

    let mut filters: Vec<EmailFilter> = Vec::new();
    if let Some(from) = query.from { filters.push(EmailFilter::from(from)); }
    if let Some(to) = query.to { filters.push(EmailFilter::to(to)); }
    if let Some(subject) = query.subject { filters.push(EmailFilter::subject(subject)); }
    if let Some(text) = query.text { filters.push(EmailFilter::body(text)); }

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
            EmailProperty::ReceivedAt,
            EmailProperty::Preview,
            EmailProperty::HasAttachment,
            EmailProperty::Keywords,
        ]);

    let mut response = request.send().await.map_err(|e| e.to_string())?;
    let emails = response.method_response_by_pos(1).unwrap_get_email().map_err(|e| e.to_string())?;

    let mut thread_map: HashMap<String, JmapThread> = HashMap::new();
    let mut thread_order: Vec<String> = Vec::new();

    for email in emails.list() {
        let thread_id = email.thread_id().unwrap_or_default().to_string();
        if !thread_map.contains_key(&thread_id) {
            thread_order.push(thread_id.clone());
            let from_name = email.from().and_then(|f| f.first()).and_then(|a| a.name().map(|s| s.to_string()));
            thread_map.insert(thread_id.clone(), JmapThread {
                conversation_id: thread_id,
                topic: email.subject().map(|s| s.to_string()).unwrap_or_default(),
                snippet: email.preview().map(|s| s.to_string()).unwrap_or_default(),
                last_delivery_time: email.received_at().map(timestamp_to_rfc3339).unwrap_or_default(),
                message_count: 1,
                unread_count: if email.keywords().contains(&"$seen") { 0 } else { 1 },
                from_name,
                has_attachments: email.has_attachment(),
            });
        }
    }

    Ok(thread_order.into_iter().filter_map(|id| thread_map.remove(&id)).collect())
}

#[command]
pub async fn jmap_get_thread(
    state: tauri::State<'_, JmapClientState>,
    config: JmapConfig,
    conversation_id: String,
) -> Result<Vec<JmapMessage>, String> {
    let client = get_client(&state, &config).await?;

    let mut thread_request = client.build();
    thread_request.get_thread().ids([conversation_id.as_str()]);
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

    let auth_header = build_auth_header(&config);
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

        let mut body_html = email.html_body()
            .and_then(|b| b.first())
            .and_then(|p| p.part_id())
            .and_then(|id| email.body_value(id))
            .map(|v| v.value().to_string())
            .or_else(|| body_text.as_deref().map(|t| format!("<pre>{}</pre>", t)))
            .unwrap_or_default();

        // Collect inline images that need to be resolved (cid: → data URI).
        // All downloads are launched in parallel to minimize latency.
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
                Some(InlinePart {
                    needle_dq,
                    needle_sq,
                    url,
                    content_type: ct.to_string(),
                })
            })
            .collect();

        // Download all inline images in parallel.
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
            attachments.push(JmapAttachment {
                attachment_id: part.blob_id().unwrap_or_default().to_string(),
                name: part.name().unwrap_or_default().to_string(),
                content_type: part.content_type().unwrap_or_default().to_string(),
                size: part.size() as u64,
                is_inline: false,
            });
        }

        messages.push(JmapMessage {
            item_id: email.id().unwrap_or_default().to_string(),
            change_key: String::new(),
            subject: email.subject().unwrap_or_default().to_string(),
            from_name: email.from().and_then(|f| f.first()).and_then(|a| a.name().map(|s| s.to_string())),
            from_email: email.from().and_then(|f| f.first()).map(|a| a.email().to_string()),
            to_recipients: email.to().map(|list| list.iter().map(|a| JmapRecipient { name: a.name().map(|s| s.to_string()), email: a.email().to_string() }).collect()).unwrap_or_default(),
            cc_recipients: email.cc().map(|list| list.iter().map(|a| JmapRecipient { name: a.name().map(|s| s.to_string()), email: a.email().to_string() }).collect()).unwrap_or_default(),
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
        });
    }

    messages.sort_by(|a, b| a.date_time_received.cmp(&b.date_time_received));
    Ok(messages)
}

#[command]
pub async fn jmap_mark_read(
    state: tauri::State<'_, JmapClientState>,
    config: JmapConfig,
    ids: Vec<String>,
) -> Result<(), String> {
    let client = get_client(&state, &config).await?;
    let mut request = client.build();
    let set = request.set_email();
    for id in &ids {
        set.update(id).keyword("$seen", true);
    }
    request.send().await.map_err(|e| e.to_string())?;
    Ok(())
}

#[command]
pub async fn jmap_mark_unread(
    state: tauri::State<'_, JmapClientState>,
    config: JmapConfig,
    ids: Vec<String>,
) -> Result<(), String> {
    let client = get_client(&state, &config).await?;
    let mut request = client.build();
    let set = request.set_email();
    for id in &ids {
        set.update(id).keyword("$seen", false);
    }
    request.send().await.map_err(|e| e.to_string())?;
    Ok(())
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

    // Skip emails that live exclusively in Sent — they should not be moved.
    if let Some(sent_id) = sent_mailbox_id {
        let non_sent: Vec<&String> = current_mailbox_ids.iter()
            .filter(|mid| mid.as_str() != sent_id)
            .collect();
        if non_sent.is_empty() {
            return Ok(false);
        }
    }

    // Full mailboxIds replacement: target + Sent (if email was already in Sent).
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

#[command]
pub async fn jmap_move_to_trash(
    state: tauri::State<'_, JmapClientState>,
    config: JmapConfig,
    id: String,
) -> Result<(), String> {
    let client = get_client(&state, &config).await?;
    let folder_ids = get_folder_ids(&state, &client, &config).await?;
    let trash_id = folder_ids.get("deleteditems").cloned().ok_or("Trash mailbox not found")?;
    let sent_id = folder_ids.get("sentitems").cloned();
    jmap_move_email(&client, &id, &trash_id, sent_id.as_deref()).await?;
    Ok(())
}

#[command]
pub async fn jmap_move_to_folder(
    state: tauri::State<'_, JmapClientState>,
    config: JmapConfig,
    id: String,
    folder_id: String,
) -> Result<(), String> {
    let client = get_client(&state, &config).await?;
    let folder_ids = get_folder_ids(&state, &client, &config).await?;
    let sent_id = folder_ids.get("sentitems").cloned();
    // Translate role names ("inbox", "sentitems", …) to actual JMAP mailbox IDs.
    // Callers like handleUnsnooze pass "inbox" rather than the server-assigned ID.
    let resolved_folder_id = folder_ids.get(&folder_id).cloned().unwrap_or(folder_id);
    jmap_move_email(&client, &id, &resolved_folder_id, sent_id.as_deref()).await?;
    Ok(())
}

#[command]
pub async fn jmap_permanently_delete(
    state: tauri::State<'_, JmapClientState>,
    config: JmapConfig,
    id: String,
) -> Result<(), String> {
    let client = get_client(&state, &config).await?;
    let mut request = client.build();
    request.set_email().destroy([id.as_str()]);
    let mut response = request.send().await.map_err(|e| e.to_string())?;
    let set_resp = response.method_response_by_pos(0)
        .unwrap_set_email()
        .map_err(|e| format!("Email/set response error: {}", e))?;
    // Only fail on an explicit server refusal. Some servers (including Fastmail)
    // omit the `destroyed` confirmation list when all requested IDs succeeded,
    // so asserting presence in that list would produce false errors.
    if let Some(mut not_destroyed) = set_resp.not_destroyed_ids() {
        if not_destroyed.any(|i| i == &id) {
            return Err(format!("Email/set destroy refused by server for {}", id));
        }
    }
    Ok(())
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
pub async fn jmap_bulk_move_to_trash(
    state: tauri::State<'_, JmapClientState>,
    config: JmapConfig,
    thread_ids: Vec<String>,
) -> Result<(), String> {
    if thread_ids.is_empty() {
        return Ok(());
    }
    let client = get_client(&state, &config).await?;
    let folder_ids = get_folder_ids(&state, &client, &config).await?;
    let trash_id = folder_ids.get("deleteditems").cloned().ok_or("Trash mailbox not found")?;

    let email_ids = jmap_thread_ids_to_email_ids(&client, &thread_ids).await?;
    if email_ids.is_empty() {
        return Ok(());
    }

    let trash_ref = trash_id.as_str();
    let mut request = client.build();
    let set = request.set_email();
    for id in &email_ids {
        set.update(id.as_str()).mailbox_ids([trash_ref]);
    }
    request.send().await.map_err(|e| e.to_string())?;
    Ok(())
}

#[command]
pub async fn jmap_bulk_permanently_delete(
    state: tauri::State<'_, JmapClientState>,
    config: JmapConfig,
    thread_ids: Vec<String>,
) -> Result<(), String> {
    if thread_ids.is_empty() {
        return Ok(());
    }
    let client = get_client(&state, &config).await?;
    let email_ids = jmap_thread_ids_to_email_ids(&client, &thread_ids).await?;
    if email_ids.is_empty() {
        return Ok(());
    }
    let mut request = client.build();
    request.set_email().destroy(email_ids.iter().map(|s| s.as_str()));
    request.send().await.map_err(|e| e.to_string())?;
    Ok(())
}

#[command]
pub async fn jmap_bulk_move_to_folder(
    state: tauri::State<'_, JmapClientState>,
    config: JmapConfig,
    thread_ids: Vec<String>,
    folder_id: String,
) -> Result<(), String> {
    if thread_ids.is_empty() {
        return Ok(());
    }
    let client = get_client(&state, &config).await?;
    let email_ids = jmap_thread_ids_to_email_ids(&client, &thread_ids).await?;
    if email_ids.is_empty() {
        return Ok(());
    }
    let folder_ids_map = get_folder_ids(&state, &client, &config).await?;
    let resolved_folder_id = folder_ids_map.get(&folder_id).cloned().unwrap_or(folder_id);
    let folder_ref = resolved_folder_id.as_str();
    let mut request = client.build();
    let set = request.set_email();
    for id in &email_ids {
        set.update(id.as_str()).mailbox_ids([folder_ref]);
    }
    request.send().await.map_err(|e| e.to_string())?;
    Ok(())
}

#[command]
pub async fn jmap_find_or_create_snoozed_folder(
    state: tauri::State<'_, JmapClientState>,
    config: JmapConfig,
) -> Result<String, String> {
    let client = get_client(&state, &config).await?;
    get_or_create_snoozed_id(&state, &client, &config).await
}

#[command]
pub async fn jmap_snooze(
    state: tauri::State<'_, JmapClientState>,
    config: JmapConfig,
    id: String,
) -> Result<String, String> {
    let client = get_client(&state, &config).await?;
    // get_or_create_snoozed_id calls get_folder_ids internally, populating the cache.
    let snoozed_id = get_or_create_snoozed_id(&state, &client, &config).await?;
    let folder_ids = get_folder_ids(&state, &client, &config).await?;
    let sent_id = folder_ids.get("sentitems").cloned();
    jmap_move_email(&client, &id, &snoozed_id, sent_id.as_deref()).await?;
    Ok(snoozed_id)
}

#[command]
pub async fn jmap_list_identities(
    state: tauri::State<'_, JmapClientState>,
    config: JmapConfig,
) -> Result<Vec<JmapIdentity>, String> {
    let client = get_client(&state, &config).await?;
    let mut request = client.build();
    request.add_capability(URI::Submission);
    request.get_identity();
    let mut response = request.send().await.map_err(|e| e.to_string())?;
    let identity_get = response.method_response_by_pos(0)
        .unwrap_get_identity()
        .map_err(|e| e.to_string())?;
    Ok(identity_get.list().iter().map(|i| JmapIdentity {
        id: i.id().unwrap_or_default().to_string(),
        name: i.name().unwrap_or_default().to_string(),
        email: i.email().unwrap_or_default().to_string(),
        may_delete: i.may_delete(),
    }).collect())
}

#[command]
pub async fn jmap_send(
    state: tauri::State<'_, JmapClientState>,
    config: JmapConfig,
    to: Vec<String>,
    cc: Vec<String>,
    bcc: Vec<String>,
    subject: String,
    body_html: String,
    identity_id: Option<String>,
    in_reply_to: Option<String>,
    references: Option<String>,
) -> Result<(), String> {
    let client = get_client(&state, &config).await?;

    // Step 1+2 – resolve identity and find Sent mailbox in a single round trip.
    let mut req = client.build();
    req.add_capability(URI::Submission);
    req.get_identity(); // method 0
    req.get_mailbox();  // method 1
    let mut resp = req.send().await
        .map_err(|e| format!("Identity+Mailbox/get: {}", e))?;
    let identities = resp.method_response_by_pos(0)
        .unwrap_get_identity()
        .map_err(|e| format!("Identity/get: {}", e))?;
    let mailboxes = resp.method_response_by_pos(1)
        .unwrap_get_mailbox()
        .map_err(|e| format!("Mailbox/get: {}", e))?;

    let identity = if let Some(ref id) = identity_id {
        identities.list().iter().find(|i| i.id() == Some(id.as_str()))
            .or_else(|| identities.list().iter().find(|i| !i.may_delete()))
            .or_else(|| identities.list().first())
    } else {
        identities.list().iter().find(|i| !i.may_delete())
            .or_else(|| identities.list().first())
    };

    let from_email = identity.and_then(|i| i.email()).unwrap_or(config.email.as_str());
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

    // Step 3 – build RFC 5322 raw message and import into Sent.
    let normalised_body = body_html.replace('\r', "").replace('\n', "\r\n");
    let safe_subject = subject.replace(['\r', '\n'], " ");

    let mut headers = format!(
        "From: {}\r\nTo: {}\r\nSubject: {}\r\nMIME-Version: 1.0\r\nContent-Type: text/html; charset=utf-8\r\n",
        from_header,
        to.join(", "),
        safe_subject,
    );
    if !cc.is_empty() {
        headers.push_str(&format!("Cc: {}\r\n", cc.join(", ")));
    }
    if !bcc.is_empty() {
        headers.push_str(&format!("Bcc: {}\r\n", bcc.join(", ")));
    }
    if let Some(ref irt) = in_reply_to {
        headers.push_str(&format!("In-Reply-To: {}\r\n", irt));
    }
    if let Some(ref refs) = references {
        headers.push_str(&format!("References: {}\r\n", refs));
    }
    let raw_message = format!("{}\r\n{}", headers, normalised_body).into_bytes();

    let mailbox_ids: Vec<String> = sent_id.into_iter().collect();
    let email = client.email_import(raw_message, mailbox_ids, None::<Vec<&str>>, None)
        .await
        .map_err(|e| format!("Email/import: {}", e))?;
    let email_id = email.id().unwrap_or_default().to_string();

    // Step 4 – submit for delivery via EmailSubmission/set.
    client.email_submission_create(&email_id, &resolved_identity_id)
        .await
        .map_err(|e| format!("EmailSubmission/set: {}", e))?;

    Ok(())
}

#[command]
pub async fn jmap_get_attachment_data(
    state: tauri::State<'_, JmapClientState>,
    config: JmapConfig,
    blob_id: String,
) -> Result<String, String> {
    let client = get_client(&state, &config).await?;
    let account_id = client.session().primary_accounts().next()
        .map(|a| a.1.as_str().to_string()).unwrap_or_default();
    let dl_template = client.session().download_url().to_string();
    let download_url = dl_template
        .replace("{blobId}", &blob_id)
        .replace("{accountId}", &account_id)
        .replace("{name}", "attachment")
        .replace("{type}", "application/octet-stream");

    let auth_header = build_auth_header(&config);
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
