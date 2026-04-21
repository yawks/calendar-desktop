use serde::{Deserialize, Serialize};
use tauri::command;
use jmap_client::client::{Client, Credentials};
use jmap_client::email::Property as EmailProperty;
use jmap_client::email::query::Filter as EmailFilter;
use jmap_client::email::query::Comparator as EmailComparator;
use jmap_client::mailbox::Role;
use std::collections::HashMap;
use base64::Engine;
use chrono::DateTime;

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

fn extract_host(url: &str) -> Option<String> {
    let after_scheme = url.strip_prefix("https://").or_else(|| url.strip_prefix("http://"))?;
    let host = after_scheme.split('/').next().filter(|h| !h.is_empty())?;
    Some(host.to_string())
}

fn jmap_base_url(session_url: &str) -> String {
    // jmap-client appends /.well-known/jmap to the URL it receives, so we
    // must pass only the scheme+host, not the full session path.
    if let Some(after_scheme) = session_url.strip_prefix("https://").or_else(|| session_url.strip_prefix("http://")) {
        let scheme = if session_url.starts_with("https") { "https" } else { "http" };
        let host = after_scheme.split('/').next().unwrap_or(after_scheme);
        return format!("{}://{}", scheme, host);
    }
    session_url.to_string()
}

async fn get_client(config: &JmapConfig) -> Result<Client, String> {
    let base_url = jmap_base_url(&config.session_url);
    let well_known = format!("{}/.well-known/jmap", base_url);

    // Diagnostic: probe the session URL directly (no redirect) to check auth.
    // This distinguishes a bad token from the redirect stripping the header.
    let auth_header = match config.auth_type.as_deref() {
        Some("basic") => {
            use base64::Engine;
            let creds = base64::engine::general_purpose::STANDARD
                .encode(format!("{}:{}", config.email, config.token));
            format!("Basic {}", creds)
        }
        _ => format!("Bearer {}", config.token),
    };
    let probe_client = reqwest::Client::builder()
        .redirect(reqwest::redirect::Policy::none())
        .build()
        .map_err(|e| e.to_string())?;

    // 1) Hit the user-provided session URL directly (no redirect needed)
    let direct = probe_client
        .get(&config.session_url)
        .header("Authorization", &auth_header)
        .send()
        .await;
    match &direct {
        Ok(resp) => eprintln!("[JMAP direct] GET {} → {}", config.session_url, resp.status()),
        Err(e)   => eprintln!("[JMAP direct] GET {} → error: {}", config.session_url, e),
    }

    // 2) Hit well-known (no follow) to see the raw redirect
    let wk = probe_client
        .get(&well_known)
        .header("Authorization", &auth_header)
        .send()
        .await;
    match &wk {
        Ok(resp) => eprintln!(
            "[JMAP wk] GET {} → {} location={:?}",
            well_known, resp.status(),
            resp.headers().get("location").and_then(|v| v.to_str().ok())
        ),
        Err(e) => eprintln!("[JMAP wk] GET {} → error: {}", well_known, e),
    }

    // jmap-client blocks ALL redirects unless hosts are explicitly trusted.
    let mut trusted: Vec<String> = Vec::new();
    for url in [config.session_url.as_str(), base_url.as_str()] {
        if let Some(host) = extract_host(url) {
            if !trusted.contains(&host) {
                trusted.push(host.clone());
            }
            // Also trust sibling subdomains on the same base domain.
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
    eprintln!("[JMAP] connecting base_url={} auth_type={}", base_url, config.auth_type.as_deref().unwrap_or("bearer"));

    Client::new()
        .credentials(credentials)
        .follow_redirects(trusted)
        .connect(&base_url)
        .await
        .map_err(|e| format!("JMAP connection error: {}", e))
}

fn timestamp_to_rfc3339(ts: i64) -> String {
    DateTime::from_timestamp(ts, 0)
        .map(|dt| dt.to_rfc3339())
        .unwrap_or_default()
}

#[command]
pub async fn jmap_list_folders(config: JmapConfig) -> Result<Vec<JmapFolder>, String> {
    let client = get_client(&config).await?;
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
pub async fn jmap_get_inbox_unread(config: JmapConfig) -> Result<u32, String> {
    let client = get_client(&config).await?;
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
pub async fn jmap_list_threads(config: JmapConfig, folder: String, max_count: Option<u32>) -> Result<Vec<JmapThread>, String> {
    let client = get_client(&config).await?;
    let count = max_count.unwrap_or(50);

    let mailbox_id = if folder == "inbox" || folder == "sentitems" || folder == "deleteditems" || folder == "drafts" {
        let target_role = match folder.as_str() {
            "inbox" => Role::Inbox,
            "sentitems" => Role::Sent,
            "deleteditems" => Role::Trash,
            "drafts" => Role::Drafts,
            _ => Role::None,
        };

        let mut mailbox_request = client.build();
        mailbox_request.get_mailbox();
        let mut response = mailbox_request.send().await.map_err(|e| e.to_string())?;
        let mailboxes = response.method_response_by_pos(0).unwrap_get_mailbox().map_err(|e| e.to_string())?;

        mailboxes.list().iter()
            .find(|m| m.role() == target_role || m.name().map(|n| n.to_lowercase() == folder.replace("items", "")).unwrap_or(false))
            .and_then(|m| m.id())
            .map(|id| id.to_string())
            .unwrap_or(folder)
    } else {
        folder
    };

    let mut request = client.build();
    request.query_email()
        .filter(EmailFilter::in_mailbox(&mailbox_id))
        .sort([EmailComparator::received_at().descending()])
        .limit(count as usize);
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

    Ok(thread_order.into_iter().filter_map(|id| thread_map.remove(&id)).collect())
}

#[command]
pub async fn jmap_search_threads(config: JmapConfig, query: MailSearchQuery, max_count: Option<u32>) -> Result<Vec<JmapThread>, String> {
    use jmap_client::core::query::Filter as QFilter;

    let client = get_client(&config).await?;
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
pub async fn jmap_get_thread(config: JmapConfig, conversation_id: String) -> Result<Vec<JmapMessage>, String> {
    let client = get_client(&config).await?;

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
            ]);
        get_req.arguments()
            .fetch_html_body_values(true)
            .fetch_text_body_values(true)
            .fetch_all_body_values(true);
    }
    let mut response = email_request.send().await.map_err(|e| e.to_string())?;
    let emails = response.method_response_by_pos(0).unwrap_get_email().map_err(|e| e.to_string())?;

    let auth_header = match config.auth_type.as_deref() {
        Some("basic") => {
            let creds = base64::engine::general_purpose::STANDARD
                .encode(format!("{}:{}", config.email, config.token));
            format!("Basic {}", creds)
        }
        _ => format!("Bearer {}", config.token),
    };
    let account_id = client.session().primary_accounts().next()
        .map(|a| a.1.as_str()).unwrap_or_default().to_string();
    let dl_template = client.session().download_url().to_string();
    let dl_client = reqwest::Client::new();

    let mut messages = Vec::new();
    for email in emails.list() {
        let body_html = email.html_body()
            .and_then(|b| b.first())
            .and_then(|p| p.part_id())
            .and_then(|id| email.body_value(id))
            .map(|v| v.value().to_string())
            .or_else(|| {
                email.text_body()
                    .and_then(|b| b.first())
                    .and_then(|p| p.part_id())
                    .and_then(|id| email.body_value(id))
                    .map(|v| format!("<pre>{}</pre>", v.value()))
            })
            .unwrap_or_default();

        // Resolve cid: inline image references
        let mut body_html = body_html;
        for part in email.attachments().unwrap_or(&[]) {
            let Some(cid) = part.content_id() else { continue };
            let Some(blob_id) = part.blob_id() else { continue };
            let ct = part.content_type().unwrap_or("application/octet-stream");
            let cid_clean = cid.trim_matches('<').trim_matches('>');
            let needle_dq = format!("src=\"cid:{}\"", cid_clean);
            let needle_sq = format!("src='cid:{}'", cid_clean);
            if !body_html.contains(&needle_dq) && !body_html.contains(&needle_sq) {
                continue;
            }
            let url = dl_template
                .replace("{blobId}", blob_id)
                .replace("{accountId}", &account_id)
                .replace("{name}", cid_clean)
                .replace("{type}", ct);
            if let Ok(resp) = dl_client.get(&url).header("Authorization", &auth_header).send().await {
                if let Ok(bytes) = resp.bytes().await {
                    let data_uri = format!("data:{};base64,{}",
                        ct, base64::engine::general_purpose::STANDARD.encode(&bytes));
                    body_html = body_html.replace(&needle_dq, &format!("src=\"{}\"", data_uri));
                    body_html = body_html.replace(&needle_sq, &format!("src='{}'", data_uri));
                }
            }
        }

        let mut attachments = Vec::new();
        for part in email.attachments().unwrap_or(&[]) {
            if part.content_id().is_some() { continue; } // inline, not a user-facing attachment
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
        });
    }

    messages.sort_by(|a, b| a.date_time_received.cmp(&b.date_time_received));

    Ok(messages)
}

#[command]
pub async fn jmap_mark_read(config: JmapConfig, ids: Vec<String>) -> Result<(), String> {
    let client = get_client(&config).await?;
    let mut request = client.build();
    let set = request.set_email();
    for id in &ids {
        set.update(id).keyword("$seen", true);
    }
    request.send().await.map_err(|e| e.to_string())?;
    Ok(())
}

#[command]
pub async fn jmap_mark_unread(config: JmapConfig, ids: Vec<String>) -> Result<(), String> {
    let client = get_client(&config).await?;
    let mut request = client.build();
    let set = request.set_email();
    for id in &ids {
        set.update(id).keyword("$seen", false);
    }
    request.send().await.map_err(|e| e.to_string())?;
    Ok(())
}

#[command]
pub async fn jmap_move_to_trash(config: JmapConfig, id: String) -> Result<(), String> {
    let client = get_client(&config).await?;

    let mut mailbox_request = client.build();
    mailbox_request.get_mailbox();
    let mut response = mailbox_request.send().await.map_err(|e| e.to_string())?;
    let mailboxes = response.method_response_by_pos(0).unwrap_get_mailbox().map_err(|e| e.to_string())?;
    let trash_id = mailboxes.list().iter()
        .find(|m| m.role() == Role::Trash || m.name().map(|n| n.to_lowercase().contains("trash") || n.to_lowercase().contains("corbeille")).unwrap_or(false))
        .and_then(|m| m.id())
        .map(|s| s.to_string())
        .ok_or("Trash mailbox not found")?;

    let mut request = client.build();
    request.set_email().update(&id).mailbox_ids([trash_id.as_str()]);
    request.send().await.map_err(|e| e.to_string())?;

    Ok(())
}

#[command]
pub async fn jmap_permanently_delete(config: JmapConfig, id: String) -> Result<(), String> {
    let client = get_client(&config).await?;
    let mut request = client.build();
    request.set_email().destroy([id.as_str()]);
    request.send().await.map_err(|e| e.to_string())?;
    Ok(())
}

#[command]
pub async fn jmap_list_identities(config: JmapConfig) -> Result<Vec<JmapIdentity>, String> {
    let client = get_client(&config).await?;
    let mut request = client.build();
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
    config: JmapConfig,
    to: Vec<String>,
    cc: Vec<String>,
    bcc: Vec<String>,
    subject: String,
    body_html: String,
    identity_id: Option<String>,
) -> Result<(), String> {
    let client = get_client(&config).await?;

    // Resolve identity: prefer the explicitly requested one, then the non-deletable
    // (primary) identity, then the first one.
    let mut id_request = client.build();
    id_request.get_identity();
    let mut id_response = id_request.send().await.map_err(|e| e.to_string())?;
    let identities = id_response.method_response_by_pos(0)
        .unwrap_get_identity()
        .map_err(|e| e.to_string())?;

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

    // Build a minimal RFC 5322 message
    let mut headers = format!(
        "From: {}\r\nTo: {}\r\nSubject: {}\r\nMIME-Version: 1.0\r\nContent-Type: text/html; charset=utf-8\r\n",
        from_header,
        to.join(", "),
        subject,
    );
    if !cc.is_empty() {
        headers.push_str(&format!("Cc: {}\r\n", cc.join(", ")));
    }
    if !bcc.is_empty() {
        headers.push_str(&format!("Bcc: {}\r\n", bcc.join(", ")));
    }
    let raw_message = format!("{}\r\n{}", headers, body_html).into_bytes();

    // Find Sent mailbox
    let mut mbox_req = client.build();
    mbox_req.get_mailbox();
    let mut mbox_resp = mbox_req.send().await.map_err(|e| e.to_string())?;
    let mailboxes = mbox_resp.method_response_by_pos(0).unwrap_get_mailbox().map_err(|e| e.to_string())?;
    let sent_id = mailboxes.list().iter()
        .find(|m| m.role() == Role::Sent)
        .and_then(|m| m.id())
        .map(|s| s.to_string());

    // Import email into Sent folder
    let mailbox_ids: Vec<String> = sent_id.into_iter().collect();
    let email = client.email_import(raw_message, mailbox_ids, None::<Vec<&str>>, None)
        .await
        .map_err(|e| e.to_string())?;
    let email_id = email.id().unwrap_or_default().to_string();

    // Submit for delivery
    client.email_submission_create(&email_id, &resolved_identity_id)
        .await
        .map_err(|e| e.to_string())?;

    Ok(())
}

#[command]
pub async fn jmap_get_attachment_data(config: JmapConfig, blob_id: String) -> Result<String, String> {
    let client = get_client(&config).await?;
    let account_id = client.session().primary_accounts().next()
        .map(|a| a.1.as_str().to_string()).unwrap_or_default();
    let dl_template = client.session().download_url().to_string();
    let download_url = dl_template
        .replace("{blobId}", &blob_id)
        .replace("{accountId}", &account_id)
        .replace("{name}", "attachment")
        .replace("{type}", "application/octet-stream");

    let auth_type = config.auth_type.as_deref().unwrap_or("bearer");
    let auth_header = match auth_type {
        "basic" => {
            let creds = base64::engine::general_purpose::STANDARD
                .encode(format!("{}:{}", config.email, config.token));
            format!("Basic {}", creds)
        }
        _ => format!("Bearer {}", config.token),
    };

    eprintln!("[JMAP dl] blob_id={}", blob_id);
    eprintln!("[JMAP dl] account_id={}", account_id);
    eprintln!("[JMAP dl] template={}", dl_template);
    eprintln!("[JMAP dl] url={}", download_url);
    eprintln!("[JMAP dl] auth_type={}", auth_type);

    let response = reqwest::Client::new()
        .get(&download_url)
        .header("Authorization", &auth_header)
        .send()
        .await
        .map_err(|e| e.to_string())?;

    let status = response.status();
    eprintln!("[JMAP dl] status={}", status);
    if !status.is_success() {
        let body = response.text().await.unwrap_or_default();
        eprintln!("[JMAP dl] error body={}", body);
        return Err(format!("{}", status));
    }
    let bytes = response.bytes().await.map_err(|e| e.to_string())?;
    Ok(base64::engine::general_purpose::STANDARD.encode(bytes))
}
