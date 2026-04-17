use serde::{Deserialize, Serialize};
use tauri::command;
use jmap_client::client::Client;
use jmap_client::core::query::Filter;
use jmap_client::core::query::Comparator;
use jmap_client::core::query::QueryRequest;
use jmap_client::mail::email::Email;
use jmap_client::mail::email::get::GetEmailRequest;
use jmap_client::mail::email::query::FilterEmail;
use jmap_client::mail::email::set::CreateEmailRequest;
use jmap_client::mail::email_submission::set::CreateEmailSubmissionRequest;
use jmap_client::mail::thread::get::GetThreadRequest;
use jmap_client::mail::mailbox::Role;
use std::collections::HashMap;

#[derive(Deserialize, Debug, Clone)]
pub struct JmapConfig {
    pub email: String,
    pub session_url: String,
    pub token: String,
    pub color: Option<String>,
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

async fn get_client(config: &JmapConfig) -> Result<Client, String> {
    Client::new()
        .credentials(&config.token)
        .session_url(&config.session_url)
        .connect()
        .await
        .map_err(|e| format!("JMAP connection error: {}", e))
}

#[command]
pub async fn jmap_list_folders(config: JmapConfig) -> Result<Vec<JmapFolder>, String> {
    let client = get_client(&config).await?;
    let mut request = client.build();
    let get_mailbox_id = request.get_mailbox();
    let response = request.send().await.map_err(|e| e.to_string())?;
    let mailboxes = response.get_mailbox(get_mailbox_id).ok_or("No mailboxes in response")?;

    let mut folders = Vec::new();
    for mailbox in mailboxes.list() {
        folders.push(JmapFolder {
            folder_id: mailbox.id().to_string(),
            display_name: mailbox.name().to_string(),
            total_count: mailbox.total_emails().map(|n| n.get() as u32).unwrap_or(0),
            unread_count: mailbox.unread_emails().map(|n| n.get() as u32).unwrap_or(0),
        });
    }

    Ok(folders)
}

#[command]
pub async fn jmap_get_inbox_unread(config: JmapConfig) -> Result<u32, String> {
    let client = get_client(&config).await?;
    let mut request = client.build();
    let get_mailbox_id = request.get_mailbox();
    let response = request.send().await.map_err(|e| e.to_string())?;
    let mailboxes = response.get_mailbox(get_mailbox_id).ok_or("No mailboxes in response")?;

    for mailbox in mailboxes.list() {
        if mailbox.role() == Some(&Role::Inbox) || mailbox.name().to_lowercase() == "inbox" {
            return Ok(mailbox.unread_emails().map(|n| n.get() as u32).unwrap_or(0));
        }
    }

    Ok(0)
}

#[command]
pub async fn jmap_list_threads(config: JmapConfig, folder: String, max_count: Option<u32>) -> Result<Vec<JmapThread>, String> {
    let client = get_client(&config).await?;
    let count = max_count.unwrap_or(50);

    let mut request = client.build();

    let mailbox_id = if folder == "inbox" || folder == "sentitems" || folder == "deleteditems" || folder == "drafts" {
        let target_role = match folder.as_str() {
            "inbox" => Some(Role::Inbox),
            "sentitems" => Some(Role::Sent),
            "deleteditems" => Some(Role::Trash),
            "drafts" => Some(Role::Drafts),
            _ => None,
        };

        let get_mailbox_id = request.get_mailbox();
        let response = request.clone().send().await.map_err(|e| e.to_string())?;
        let mailboxes = response.get_mailbox(get_mailbox_id).ok_or("No mailboxes in response")?;

        mailboxes.list().iter()
            .find(|m| (target_role.is_some() && m.role() == target_role.as_ref()) || m.name().to_lowercase() == folder.replace("items", "").to_lowercase())
            .map(|m| m.id().to_string())
            .unwrap_or(folder)
    } else {
        folder
    };

    let mut filter = FilterEmail::default();
    filter.in_mailbox(mailbox_id);

    let mut query_request = QueryRequest::default();
    query_request.filter(Filter::Condition(filter));
    query_request.sort(vec![Comparator::received_at().descending()]);
    query_request.limit(count as usize);

    let query_id = request.query_email(query_request);

    let mut get_email_request = GetEmailRequest::default();
    get_email_request.ids_ref(request.result_reference(query_id));
    get_email_request.properties(vec!["id", "threadId", "subject", "from", "receivedAt", "preview", "hasAttachment", "keywords"]);
    let get_emails_id = request.get_email(get_email_request);

    let response = request.send().await.map_err(|e| e.to_string())?;
    let emails = response.get_email(get_emails_id).ok_or("No emails in response")?;

    let mut thread_map: HashMap<String, JmapThread> = HashMap::new();
    let mut thread_order: Vec<String> = Vec::new();

    for email in emails.list() {
        let thread_id = email.thread_id().to_string();
        if let Some(thread) = thread_map.get_mut(&thread_id) {
            thread.message_count += 1;
            if !email.keywords().contains(&jmap_client::mail::email::Keyword::Seen) {
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
                last_delivery_time: email.received_at().map(|d| d.to_rfc3339()).unwrap_or_default(),
                message_count: 1,
                unread_count: if email.keywords().contains(&jmap_client::mail::email::Keyword::Seen) { 0 } else { 1 },
                from_name,
                has_attachments: email.has_attachment(),
            });
        }
    }

    Ok(thread_order.into_iter().filter_map(|id| thread_map.remove(&id)).collect())
}

#[command]
pub async fn jmap_search_threads(config: JmapConfig, query: MailSearchQuery, max_count: Option<u32>) -> Result<Vec<JmapThread>, String> {
    let client = get_client(&config).await?;
    let count = max_count.unwrap_or(50);

    let mut request = client.build();

    let mut filter = FilterEmail::default();
    if let Some(from) = query.from { filter.from(from); }
    if let Some(to) = query.to { filter.to(to); }
    if let Some(subject) = query.subject { filter.subject(subject); }
    if let Some(text) = query.text { filter.text(text); }

    let mut query_request = QueryRequest::default();
    query_request.filter(Filter::Condition(filter));
    query_request.sort(vec![Comparator::received_at().descending()]);
    query_request.limit(count as usize);

    let query_id = request.query_email(query_request);

    let mut get_email_request = GetEmailRequest::default();
    get_email_request.ids_ref(request.result_reference(query_id));
    get_email_request.properties(vec!["id", "threadId", "subject", "from", "receivedAt", "preview", "hasAttachment", "keywords"]);
    let get_emails_id = request.get_email(get_email_request);

    let response = request.send().await.map_err(|e| e.to_string())?;
    let emails = response.get_email(get_emails_id).ok_or("No emails in response")?;

    let mut thread_map: HashMap<String, JmapThread> = HashMap::new();
    let mut thread_order: Vec<String> = Vec::new();

    for email in emails.list() {
        let thread_id = email.thread_id().to_string();
        if !thread_map.contains_key(&thread_id) {
            thread_order.push(thread_id.clone());
            let from_name = email.from().and_then(|f| f.first()).and_then(|a| a.name().map(|s| s.to_string()));
            thread_map.insert(thread_id.clone(), JmapThread {
                conversation_id: thread_id,
                topic: email.subject().map(|s| s.to_string()).unwrap_or_default(),
                snippet: email.preview().map(|s| s.to_string()).unwrap_or_default(),
                last_delivery_time: email.received_at().map(|d| d.to_rfc3339()).unwrap_or_default(),
                message_count: 1,
                unread_count: if email.keywords().contains(&jmap_client::mail::email::Keyword::Seen) { 0 } else { 1 },
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
    let mut request = client.build();

    let mut get_thread_request = GetThreadRequest::default();
    get_thread_request.ids(vec![conversation_id]);
    let get_thread_id = request.get_thread(get_thread_request);

    let mut get_email_request = GetEmailRequest::default();
    get_email_request.ids_ref(request.result_reference(get_thread_id));
    get_email_request.properties(vec!["id", "threadId", "subject", "from", "receivedAt", "preview", "hasAttachment", "keywords", "htmlBody", "textBody", "attachments", "to", "cc", "bcc"]);
    let get_emails_id = request.get_email(get_email_request);

    let response = request.send().await.map_err(|e| e.to_string())?;
    let emails = response.get_email(get_emails_id).ok_or("No emails in response")?;

    let mut messages = Vec::new();
    for email in emails.list() {
        let body_html = email.html_body().first()
            .and_then(|part| part.value())
            .map(|v| v.to_string())
            .or_else(|| email.text_body().first().and_then(|part| part.value()).map(|v| format!("<pre>{}</pre>", v)))
            .unwrap_or_default();

        let mut attachments = Vec::new();
        for part in email.attachments() {
            attachments.push(JmapAttachment {
                attachment_id: part.part_id().to_string(),
                name: part.name().map(|s| s.to_string()).unwrap_or_default(),
                content_type: part.type_().to_string(),
                size: part.size().get() as u64,
                is_inline: part.content_id().is_some(),
            });
        }

        messages.push(JmapMessage {
            item_id: email.id().to_string(),
            change_key: String::new(),
            subject: email.subject().map(|s| s.to_string()).unwrap_or_default(),
            from_name: email.from().and_then(|f| f.first()).and_then(|a| a.name().map(|s| s.to_string())),
            from_email: email.from().and_then(|f| f.first()).map(|a| a.email().to_string()),
            to_recipients: email.to().map(|list| list.iter().map(|a| JmapRecipient { name: a.name().map(|s| s.to_string()), email: a.email().to_string() }).collect()).unwrap_or_default(),
            cc_recipients: email.cc().map(|list| list.iter().map(|a| JmapRecipient { name: a.name().map(|s| s.to_string()), email: a.email().to_string() }).collect()).unwrap_or_default(),
            body_html,
            date_time_received: email.received_at().map(|d| d.to_rfc3339()).unwrap_or_default(),
            is_read: email.keywords().contains(&jmap_client::mail::email::Keyword::Seen),
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

    let mut patch = HashMap::new();
    patch.insert(format!("keywords/{}", jmap_client::mail::email::Keyword::Seen.as_str()), serde_json::Value::Bool(true));

    for id in ids {
        request.update_email(id, patch.clone());
    }

    request.send().await.map_err(|e| e.to_string())?;
    Ok(())
}

#[command]
pub async fn jmap_mark_unread(config: JmapConfig, ids: Vec<String>) -> Result<(), String> {
    let client = get_client(&config).await?;
    let mut request = client.build();

    let mut patch = HashMap::new();
    patch.insert(format!("keywords/{}", jmap_client::mail::email::Keyword::Seen.as_str()), serde_json::Value::Null);

    for id in ids {
        request.update_email(id, patch.clone());
    }

    request.send().await.map_err(|e| e.to_string())?;
    Ok(())
}

#[command]
pub async fn jmap_move_to_trash(config: JmapConfig, id: String) -> Result<(), String> {
    let client = get_client(&config).await?;
    let mut request = client.build();
    let get_mailbox_id = request.get_mailbox();
    let response = request.clone().send().await.map_err(|e| e.to_string())?;
    let mailboxes = response.get_mailbox(get_mailbox_id).ok_or("No mailboxes in response")?;
    let trash_id = mailboxes.list().iter()
        .find(|m| m.role() == Some(&Role::Trash) || m.name().to_lowercase().contains("trash") || m.name().to_lowercase().contains("corbeille"))
        .map(|m| m.id().to_string())
        .ok_or("Trash mailbox not found")?;

    let mut patch = HashMap::new();
    let mut mailbox_ids = HashMap::new();
    mailbox_ids.insert(trash_id, true);
    patch.insert("mailboxIds".to_string(), serde_json::to_value(mailbox_ids).unwrap());

    let mut request = client.build();
    request.update_email(id, patch);
    request.send().await.map_err(|e| e.to_string())?;

    Ok(())
}

#[command]
pub async fn jmap_permanently_delete(config: JmapConfig, id: String) -> Result<(), String> {
    let client = get_client(&config).await?;
    let mut request = client.build();
    request.destroy_email(id);
    request.send().await.map_err(|e| e.to_string())?;
    Ok(())
}

#[command]
pub async fn jmap_send(
    config: JmapConfig,
    to: Vec<String>,
    cc: Vec<String>,
    bcc: Vec<String>,
    subject: String,
    body_html: String,
) -> Result<(), String> {
    let client = get_client(&config).await?;
    let mut request = client.build();

    let mut email = CreateEmailRequest::default();
    email.from(vec![jmap_client::mail::email::Address::default().email(&config.email)]);
    email.to(to.iter().map(|t| jmap_client::mail::email::Address::default().email(t)).collect());
    if !cc.is_empty() {
        email.cc(cc.iter().map(|t| jmap_client::mail::email::Address::default().email(t)).collect());
    }
    if !bcc.is_empty() {
        email.bcc(bcc.iter().map(|t| jmap_client::mail::email::Address::default().email(t)).collect());
    }
    email.subject(&subject);
    email.html_body(vec![jmap_client::mail::email::BodyPart::default().value(&body_html)]);

    let create_email_id = request.create_email(email);

    let mut submission = CreateEmailSubmissionRequest::default();
    submission.email_id_ref(request.result_reference(create_email_id));
    request.create_email_submission(submission);

    request.send().await.map_err(|e| e.to_string())?;

    Ok(())
}

#[command]
pub async fn jmap_get_attachment_data(config: JmapConfig, blob_id: String) -> Result<String, String> {
    let client = get_client(&config).await?;
    let download_url = client.session().download_url()
        .replace("{blobId}", &blob_id)
        .replace("{accountId}", client.session().primary_accounts().get(&jmap_client::core::capability::Capability::Mail).map(|a| a.as_str()).unwrap_or_default())
        .replace("{name}", "attachment");

    let response = reqwest::Client::new()
        .get(download_url)
        .header("Authorization", format!("Bearer {}", config.token))
        .send()
        .await
        .map_err(|e| e.to_string())?;

    let bytes = response.bytes().await.map_err(|e| e.to_string())?;
    Ok(base64::engine::general_purpose::STANDARD.encode(bytes))
}
