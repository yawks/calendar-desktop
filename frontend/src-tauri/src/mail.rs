use base64::{engine::general_purpose::STANDARD as BASE64, Engine as _};
use serde::{Deserialize, Serialize};
use tauri::command;

use crate::ews::{xml_all_ns, xml_attr, xml_content, xml_content_ns};

const EWS_ENDPOINT: &str = "https://outlook.office365.com/EWS/Exchange.asmx";
const CLIENT_ID: &str = "d3590ed6-52b3-4102-aeff-aad2292ab01c";
const TOKEN_ENDPOINT: &str = "https://login.microsoftonline.com/common/oauth2/v2.0/token";
const GRAPH_ENDPOINT: &str = "https://graph.microsoft.com/v1.0";

/// Like `ews::send_ews_request` but wraps the body in an envelope that declares
/// `RequestedServerVersion Exchange2013_SP1`.  FindConversation / GetConversationItems
/// were introduced in Exchange 2013 and are rejected when the server falls back to
/// the default (Exchange 2007) schema.
async fn send(access_token: &str, soap_body: &str) -> Result<String, String> {
    let envelope = format!(
        r#"<?xml version="1.0" encoding="utf-8"?>
<soap:Envelope xmlns:soap="http://schemas.xmlsoap.org/soap/envelope/"
               xmlns:t="http://schemas.microsoft.com/exchange/services/2006/types"
               xmlns:m="http://schemas.microsoft.com/exchange/services/2006/messages">
  <soap:Header>
    <t:RequestServerVersion Version="Exchange2013_SP1"/>
  </soap:Header>
  <soap:Body>
    {}
  </soap:Body>
</soap:Envelope>"#,
        soap_body
    );

    let client = reqwest::Client::new();
    let response = client
        .post(EWS_ENDPOINT)
        .header("Authorization", format!("Bearer {}", access_token))
        .header("Content-Type", "text/xml; charset=utf-8")
        .body(envelope)
        .send()
        .await
        .map_err(|e| e.to_string())?;

    let status = response.status();
    let body = response.text().await.map_err(|e| e.to_string())?;

    if status.as_u16() == 401 {
        return Err("ews_unauthorized".to_string());
    }
    if !status.is_success() {
        eprintln!("[EWS send] HTTP {} body:\n{}", status, &body);
        return Err(format!("EWS HTTP {}: {}", status, &body[..body.len().min(2000)]));
    }
    Ok(body)
}

/// Extract a human-readable error from a ResponseClass="Error" response.
fn ews_err(xml: &str, fallback: &str) -> String {
    let code = xml_content(xml, "m:ResponseCode").unwrap_or_default();
    let text = xml_content(xml, "m:MessageText").unwrap_or_default();
    if code.is_empty() && text.is_empty() {
        fallback.to_string()
    } else {
        format!("{}: {}", code, text)
    }
}

// ── Types ──────────────────────────────────────────────────────────────────────

/// Structured search query forwarded from the TypeScript provider.
#[derive(Deserialize, Debug)]
pub struct MailSearchQuery {
    pub from:    Option<String>,
    pub to:      Option<String>,
    pub cc:      Option<String>,
    pub bcc:     Option<String>,
    pub subject: Option<String>,
    /// Free-text search in body/subject.
    pub text:    Option<String>,
    /// Well-known folder key or arbitrary EWS FolderId.
    pub folder:  Option<String>,
    /// 'today', 'yesterday', or 'YYYY-MM-DD'.
    pub date:    Option<String>,
}

/// Minimal item reference used by mark-read / mark-unread commands.
#[derive(Deserialize, Debug)]
pub struct MailItemRef {
    pub item_id: String,
    pub change_key: String,
}

/// A file attachment supplied by the frontend composer (base64-encoded content).
#[derive(Deserialize, Debug)]
pub struct ComposerAttachment {
    pub name: String,
    pub content_type: String,
    pub data: String, // base64
}

#[derive(Serialize, Debug, Clone)]
pub struct MailThread {
    pub conversation_id: String,
    pub topic: String,
    /// Short preview text (may be empty if server doesn't return it).
    pub snippet: String,
    pub last_delivery_time: String,
    pub message_count: u32,
    pub unread_count: u32,
    /// Display name of the most recent sender (from UniqueSenders).
    pub from_name: Option<String>,
    pub has_attachments: bool,
}

#[derive(Serialize, Debug, Clone)]
pub struct MailMessage {
    pub item_id: String,
    pub change_key: String,
    pub subject: String,
    pub from_name: Option<String>,
    pub from_email: Option<String>,
    pub to_recipients: Vec<MailRecipient>,
    pub cc_recipients: Vec<MailRecipient>,
    pub body_html: String,
    pub date_time_received: String,
    pub is_read: bool,
    pub has_attachments: bool,
    pub attachments: Vec<MailAttachment>,
    /// ICS text extracted from a text/calendar MIME part (e.g. Teams meeting invitations
    /// that are delivered as plain emails rather than Exchange MeetingRequest items).
    #[serde(skip_serializing_if = "Option::is_none")]
    pub ics_mime: Option<String>,
}

#[derive(Serialize, Debug, Clone)]
pub struct MailRecipient {
    pub name: Option<String>,
    pub email: String,
}

#[derive(Serialize, Debug, Clone)]
pub struct MailFolder {
    pub folder_id: String,
    pub display_name: String,
    pub total_count: u32,
    pub unread_count: u32,
}

#[derive(Serialize, Debug, Clone)]
pub struct MailAttachment {
    pub attachment_id: String,
    pub name: String,
    pub content_type: String,
    pub size: u64,
    pub is_inline: bool,
}

// ── Commands ───────────────────────────────────────────────────────────────────

/// List the subfolders of the Inbox (shallow traversal).
#[command]
pub async fn mail_list_folders(access_token: String) -> Result<Vec<MailFolder>, String> {
    let soap_body = r#"<m:FindFolder Traversal="Shallow">
  <m:FolderShape>
    <t:BaseShape>AllProperties</t:BaseShape>
  </m:FolderShape>
  <m:ParentFolderIds>
    <t:DistinguishedFolderId Id="msgfolderroot"/>
  </m:ParentFolderIds>
</m:FindFolder>"#;

    let xml = send(&access_token, soap_body).await?;

    if xml.contains("ResponseClass=\"Error\"") {
        return Err(ews_err(&xml, "EWS error listing folders"));
    }

    // FindFolder response wraps items in <t:Folders> (or <Folders>).
    // We must extract that container first — otherwise xml_all_ns("t:Folder") would
    // also match <t:Folders> since the tag starts with the same prefix.
    let folders_container = xml_content_ns(&xml, "t:Folders").unwrap_or_default();

    let mut folders = Vec::new();
    for folder_xml in xml_all_ns(&folders_container, "t:Folder") {
        let id_elem = folder_xml
            .find("<t:FolderId ")
            .or_else(|| folder_xml.find("<FolderId "))
            .and_then(|s| folder_xml[s..].find("/>").map(|e| &folder_xml[s..s + e]));
        let folder_id = match id_elem.and_then(|e| xml_attr(e, "Id")) {
            Some(id) => id,
            None => continue,
        };

        let display_name = xml_content_ns(&folder_xml, "t:DisplayName").unwrap_or_default();
        if display_name.is_empty() {
            continue;
        }
        let total_count = xml_content_ns(&folder_xml, "t:TotalCount")
            .and_then(|v| v.parse().ok())
            .unwrap_or(0u32);
        let unread_count = xml_content_ns(&folder_xml, "t:UnreadCount")
            .and_then(|v| v.parse().ok())
            .unwrap_or(0u32);

        folders.push(MailFolder { folder_id, display_name, total_count, unread_count });
    }

    Ok(folders)
}

/// List conversation threads in a folder.
///
/// `folder` may be a distinguished folder name (`inbox`, `sentitems`, `deleteditems`)
/// or an arbitrary EWS FolderId returned by `mail_list_folders`.
#[command]
pub async fn mail_list_threads(
    access_token: String,
    folder: String,
    max_count: Option<u32>,
) -> Result<Vec<MailThread>, String> {
    let count = max_count.unwrap_or(50);

    // Drafts are not real conversations in EWS — use FindItem to list them as individual items.
    // We use IdOnly + targeted AdditionalProperties to get a compact, unambiguous response
    // where the very first <t:ItemId> in each <t:Message> is guaranteed to be the message's
    // own ItemId (not a ConversationId or any nested reference).
    if folder == "drafts" {
        let soap_body = format!(
            r#"<m:FindItem Traversal="Shallow">
  <m:ItemShape>
    <t:BaseShape>IdOnly</t:BaseShape>
    <t:AdditionalProperties>
      <t:FieldURI FieldURI="item:Subject"/>
      <t:FieldURI FieldURI="item:DateTimeReceived"/>
      <t:FieldURI FieldURI="item:HasAttachments"/>
      <t:FieldURI FieldURI="item:Preview"/>
      <t:FieldURI FieldURI="message:ToRecipients"/>
      <t:FieldURI FieldURI="message:Sender"/>
    </t:AdditionalProperties>
  </m:ItemShape>
  <m:IndexedPageItemView MaxEntriesReturned="{count}" Offset="0" BasePoint="Beginning"/>
  <m:SortOrder>
    <t:FieldOrder Order="Descending">
      <t:FieldURI FieldURI="item:DateTimeReceived"/>
    </t:FieldOrder>
  </m:SortOrder>
  <m:ParentFolderIds>
    <t:DistinguishedFolderId Id="drafts"/>
  </m:ParentFolderIds>
</m:FindItem>"#,
        );
        let xml = send(&access_token, &soap_body).await?;
        if xml.contains("ResponseClass=\"Error\"") {
            return Err(ews_err(&xml, "EWS error listing drafts"));
        }
        let mut threads = Vec::new();
        for msg_xml in xml_all_ns(&xml, "t:Message") {
            // ItemId is the first self-closing element in IdOnly shape — both prefixed and
            // unprefixed namespace variants are handled.
            let item_id_elem = msg_xml
                .find("<t:ItemId ")
                .or_else(|| msg_xml.find("<ItemId "))
                .and_then(|s| msg_xml[s..].find("/>").map(|e| &msg_xml[s..s + e]));
            let item_id = match item_id_elem.and_then(|e| xml_attr(e, "Id")) {
                Some(id) => id,
                None => continue,
            };
            let topic = xml_content_ns(&msg_xml, "t:Subject").unwrap_or_default();
            let last_delivery_time = xml_content_ns(&msg_xml, "t:DateTimeReceived").unwrap_or_default();
            let has_attachments = xml_content_ns(&msg_xml, "t:HasAttachments")
                .map(|v| v == "true")
                .unwrap_or(false);
            let snippet = xml_content_ns(&msg_xml, "t:Preview").unwrap_or_default();
            // Extract Sender mailbox (the account owner) as from_name
            let sender_xml = xml_content_ns(&msg_xml, "t:Sender").unwrap_or_default();
            let sender_mb = xml_content_ns(&sender_xml, "t:Mailbox").unwrap_or_default();
            let sender_name = xml_content_ns(&sender_mb, "t:Name")
                .filter(|s| !s.is_empty())
                .or_else(|| xml_content_ns(&sender_mb, "t:EmailAddress").filter(|s| !s.is_empty()));
            threads.push(MailThread {
                conversation_id: item_id,
                topic,
                snippet,
                last_delivery_time,
                message_count: 1,
                unread_count: 0,
                from_name: sender_name,
                has_attachments,
            });
        }
        return Ok(threads);
    }

    let parent_folder_id = match folder.as_str() {
        "inbox" | "sentitems" | "deleteditems" => {
            format!(r#"<t:DistinguishedFolderId Id="{}"/>"#, folder)
        }
        id => format!(r#"<t:FolderId Id="{}"/>"#, id),
    };

    let soap_body = format!(
        r#"<m:FindConversation>
  <m:IndexedPageItemView MaxEntriesReturned="{count}" Offset="0" BasePoint="Beginning"/>
  <m:SortOrder>
    <t:FieldOrder Order="Descending">
      <t:FieldURI FieldURI="conversation:LastDeliveryTime"/>
    </t:FieldOrder>
  </m:SortOrder>
  <m:ParentFolderId>
    {parent_folder_id}
  </m:ParentFolderId>
  <m:ConversationShape>
    <t:BaseShape>AllProperties</t:BaseShape>
  </m:ConversationShape>
</m:FindConversation>"#,
    );

    let xml = send(&access_token, &soap_body).await?;

    if xml.contains("ResponseClass=\"Error\"") {
        return Err(ews_err(&xml, "EWS error listing threads"));
    }

    // EWS responses use either <t:Conversation> or <Conversation> (default ns).
    // xml_all_ns tries the prefixed form first, then the unprefixed form.
    let mut threads = Vec::new();
    for conv_xml in xml_all_ns(&xml, "t:Conversation") {
        // ConversationId is self-closing: <t:ConversationId Id="…"/> or <ConversationId Id="…"/>
        let conv_id_elem = conv_xml
            .find("<t:ConversationId ")
            .or_else(|| conv_xml.find("<ConversationId "))
            .and_then(|s| conv_xml[s..].find("/>").map(|e| &conv_xml[s..s + e]));
        let conversation_id = match conv_id_elem.and_then(|e| xml_attr(e, "Id")) {
            Some(id) => id,
            None => continue,
        };

        // EWS returns the subject as <ConversationTopic> (no namespace prefix in
        // default-ns responses).  Fall back to t:Topic for servers that do prefix it.
        let topic = xml_content_ns(&conv_xml, "t:ConversationTopic")
            .filter(|s| !s.is_empty())
            .or_else(|| xml_content_ns(&conv_xml, "t:Topic"))
            .unwrap_or_default();
        let last_delivery_time =
            xml_content_ns(&conv_xml, "t:LastDeliveryTime").unwrap_or_default();
        let message_count = xml_content_ns(&conv_xml, "t:GlobalMessageCount")
            .and_then(|v| v.parse().ok())
            .unwrap_or(1u32);
        let unread_count = xml_content_ns(&conv_xml, "t:GlobalUnreadCount")
            .and_then(|v| v.parse().ok())
            .unwrap_or(0u32);
        let has_attachments = xml_content_ns(&conv_xml, "t:HasAttachments")
            .map(|v| v == "true")
            .unwrap_or(false);

        // GlobalPreview / Preview (Exchange 2013 SP1+)
        let snippet = xml_content_ns(&conv_xml, "t:GlobalPreview")
            .or_else(|| xml_content_ns(&conv_xml, "t:Preview"))
            .unwrap_or_default();

        // UniqueSenders / UniqueUnreadSenders contain <String> children
        let from_name = xml_content_ns(&conv_xml, "t:UniqueUnreadSenders")
            .as_deref()
            .and_then(|s| xml_content_ns(s, "t:String"))
            .filter(|s| !s.is_empty())
            .or_else(|| {
                xml_content_ns(&conv_xml, "t:UniqueSenders")
                    .as_deref()
                    .and_then(|s| xml_content_ns(s, "t:String"))
                    .filter(|s| !s.is_empty())
            });

        threads.push(MailThread {
            conversation_id,
            topic,
            snippet,
            last_delivery_time,
            message_count,
            unread_count,
            from_name,
            has_attachments,
        });
    }

    Ok(threads)
}

/// Return the EWS `FolderId Id="..."` XML fragment for every mail folder in the
/// mailbox (deep traversal, excludes calendar/contacts/tasks folders).
async fn find_all_mail_folder_ids(access_token: &str) -> Vec<String> {
    let soap_body = r#"<m:FindFolder Traversal="Deep">
  <m:FolderShape>
    <t:BaseShape>IdOnly</t:BaseShape>
  </m:FolderShape>
  <m:ParentFolderIds>
    <t:DistinguishedFolderId Id="msgfolderroot"/>
  </m:ParentFolderIds>
</m:FindFolder>"#;

    let xml = match send(access_token, soap_body).await {
        Ok(x) => x,
        Err(e) => { eprintln!("[find_all_mail_folder_ids] error: {}", e); return vec![]; }
    };

    let containers: Vec<String> = xml_all_ns(&xml, "t:Folders");
    let mut ids = Vec::new();
    for container in &containers {
        for folder_xml in xml_all_ns(container, "t:Folder") {
            let id_elem = folder_xml
                .find("<t:FolderId ")
                .or_else(|| folder_xml.find("<FolderId "))
                .and_then(|s| folder_xml[s..].find("/>").map(|e| &folder_xml[s..s + e]));
            if let Some(id) = id_elem.and_then(|e| xml_attr(e, "Id")) {
                ids.push(id);
            }
        }
    }
    ids
}

/// Search messages using `FindItem Traversal="Shallow"` + `QueryString` across all
/// mail folders. Results are grouped by `ConversationId` to produce thread summaries.
#[command]
pub async fn mail_search_threads(
    access_token: String,
    query: MailSearchQuery,
    max_count: Option<u32>,
) -> Result<Vec<MailThread>, String> {
    let thread_limit = max_count.unwrap_or(50) as usize;
    // Fetch up to 5× more messages than threads requested so we can aggregate properly.
    let _msg_limit = (thread_limit * 5).max(200);

    // ── Build AQS / KQL query string ──────────────────────────────────────────
    let mut aqs_parts: Vec<String> = Vec::new();

    if let Some(from) = &query.from { aqs_parts.push(format!("from:{}", from)); }
    if let Some(to)   = &query.to   { aqs_parts.push(format!("to:{}", to)); }
    if let Some(cc)   = &query.cc   { aqs_parts.push(format!("cc:{}", cc)); }
    if let Some(bcc)  = &query.bcc  { aqs_parts.push(format!("bcc:{}", bcc)); }
    if let Some(subj) = &query.subject {
        if subj.contains(' ') {
            aqs_parts.push(format!("subject:\"{}\"", subj));
        } else {
            aqs_parts.push(format!("subject:{}", subj));
        }
    }
    if let Some(text) = &query.text { aqs_parts.push(text.clone()); }
    if let Some(date) = &query.date {
        aqs_parts.push(format!("received:{}", date));
    }

    let aqs_query = aqs_parts.join(" ");
    if aqs_query.is_empty() {
        return Ok(vec![]);
    }

    let escaped_query = aqs_query
        .replace('&', "&amp;")
        .replace('<', "&lt;")
        .replace('>', "&gt;")
        .replace('"', "&quot;");

    eprintln!("[mail_search_threads] AQS query: {:?}", aqs_query);

    // ── Collect folders to search ──────────────────────────────────────────────
    // FindItem + QueryString only accepts one folder per request (Exchange Online
    // returns ErrorInvalidOperation for multiple). We discover all mail folders
    // via FindFolder Deep, then fan out one FindItem per folder in parallel.
    let folder_id_xmls: Vec<String> = if let Some(f) = &query.folder {
        vec![match f.as_str() {
            "inbox" | "sentitems" | "deleteditems" | "drafts" => {
                format!(r#"<t:DistinguishedFolderId Id="{}"/>"#, f)
            }
            id => format!(r#"<t:FolderId Id="{}"/>"#, id),
        }]
    } else {
        let discovered = find_all_mail_folder_ids(&access_token).await;
        eprintln!("[mail_search_threads] discovered {} mail folder(s)", discovered.len());
        if discovered.is_empty() {
            // Fallback to well-known folders if discovery failed.
            vec![
                r#"<t:DistinguishedFolderId Id="inbox"/>"#.to_string(),
                r#"<t:DistinguishedFolderId Id="sentitems"/>"#.to_string(),
                r#"<t:DistinguishedFolderId Id="drafts"/>"#.to_string(),
                r#"<t:DistinguishedFolderId Id="deleteditems"/>"#.to_string(),
            ]
        } else {
            discovered.into_iter().map(|id| format!(r#"<t:FolderId Id="{}"/>"#, id)).collect()
        }
    };

    // ── Fan out searches in parallel ───────────────────────────────────────────
    type Row = (String, String, String, bool, bool, Option<String>);

    fn search_xml_to_rows(xml: &str) -> Vec<Row> {
        let mut rows = Vec::new();
        for msg_xml in xml_all_ns(xml, "t:Message") {
            let conv_id_elem = msg_xml
                .find("<t:ConversationId ")
                .or_else(|| msg_xml.find("<ConversationId "))
                .and_then(|s| msg_xml[s..].find("/>").map(|e| &msg_xml[s..s + e]));
            let conv_id = match conv_id_elem.and_then(|e| xml_attr(e, "Id")) {
                Some(id) => id,
                None => continue,
            };
            let topic        = xml_content_ns(&msg_xml, "t:Subject").unwrap_or_default();
            let date         = xml_content_ns(&msg_xml, "t:DateTimeReceived").unwrap_or_default();
            let is_read      = xml_content_ns(&msg_xml, "t:IsRead").map(|v| v == "true").unwrap_or(true);
            let has_attach   = xml_content_ns(&msg_xml, "t:HasAttachments").map(|v| v == "true").unwrap_or(false);
            let from_name    = xml_content_ns(&msg_xml, "t:From")
                .as_deref()
                .and_then(|f| xml_content_ns(f, "t:Name"))
                .filter(|s| !s.is_empty());
            rows.push((conv_id, topic, date, is_read, has_attach, from_name));
        }
        rows
    }

    let handles: Vec<_> = folder_id_xmls.into_iter().map(|folder_id_xml| {
        let token = access_token.clone();
        let query_escaped = escaped_query.clone();
        tokio::spawn(async move {
            let soap_body = format!(
                r#"<m:FindItem Traversal="Shallow">
  <m:ItemShape>
    <t:BaseShape>AllProperties</t:BaseShape>
  </m:ItemShape>
  <m:ParentFolderIds>
    {folder_id_xml}
  </m:ParentFolderIds>
  <m:QueryString>{query_escaped}</m:QueryString>
</m:FindItem>"#,
            );
            match send(&token, &soap_body).await {
                Ok(xml) if !xml.contains("ResponseClass=\"Error\"") => search_xml_to_rows(&xml),
                _ => vec![],
            }
        })
    }).collect();

    let mut all_rows: Vec<Row> = Vec::new();
    for handle in handles {
        if let Ok(rows) = handle.await {
            all_rows.extend(rows);
        }
    }

    // Sort all messages newest-first before grouping.
    all_rows.sort_by(|a, b| b.2.cmp(&a.2));
    let rows = all_rows;

    // Messages arrive newest-first; first occurrence of a ConversationId becomes
    // the representative for the thread summary.
    use std::collections::HashMap;
    let mut order: Vec<String> = Vec::new();
    let mut by_conv: HashMap<String, MailThread> = HashMap::new();

    for (conv_id, topic, date, is_read, has_attach, from_name) in rows {
        if let Some(t) = by_conv.get_mut(&conv_id) {
            t.message_count += 1;
            if !is_read { t.unread_count += 1; }
            if has_attach { t.has_attachments = true; }
        } else {
            order.push(conv_id.clone());
            by_conv.insert(conv_id.clone(), MailThread {
                conversation_id: conv_id,
                topic,
                snippet: String::new(),
                last_delivery_time: date,
                message_count: 1,
                unread_count: if is_read { 0 } else { 1 },
                from_name,
                has_attachments: has_attach,
            });
        }
        if order.len() >= thread_limit && by_conv.len() >= thread_limit {
            break;
        }
    }

    let threads: Vec<MailThread> = order.into_iter()
        .filter_map(|id| by_conv.remove(&id))
        .take(thread_limit)
        .collect();

    eprintln!("[mail_search_threads] parsed {} thread(s)", threads.len());
    Ok(threads)
}

/// Fetch all messages in a conversation thread.
/// Pass `include_trash: true` to include items from the Deleted Items folder
/// (needed when the caller itself is operating on the trash folder).
#[command]
pub async fn mail_get_thread(
    access_token: String,
    conversation_id: String,
    include_trash: Option<bool>,
    is_draft: Option<bool>,
) -> Result<Vec<MailMessage>, String> {
    // Drafts are not real conversations — fetch the item directly by its ItemId.
    if is_draft.unwrap_or(false) {
        let soap_body = format!(
            r#"<m:GetItem>
  <m:ItemShape>
    <t:BaseShape>AllProperties</t:BaseShape>
    <t:BodyType>HTML</t:BodyType>
    <t:AdditionalProperties>
      <t:FieldURI FieldURI="message:IsRead"/>
      <t:FieldURI FieldURI="item:MimeContent"/>
    </t:AdditionalProperties>
  </m:ItemShape>
  <m:ItemIds>
    <t:ItemId Id="{item_id}"/>
  </m:ItemIds>
</m:GetItem>"#,
            item_id = conversation_id,
        );
        let xml = send(&access_token, &soap_body).await?;
        if xml.contains("ResponseClass=\"Error\"") {
            return Err(ews_err(&xml, "EWS error getting draft"));
        }
        let mut messages = Vec::new();
        for msg_xml in xml_all_ns(&xml, "t:Message") {
            if let Some(msg) = parse_message(&msg_xml) {
                let inline = parse_inline_images(&msg_xml);
                let body = inject_inline_images(&access_token, msg.body_html, inline).await;
                messages.push(MailMessage { body_html: body, ..msg });
            }
        }
        return Ok(messages);
    }

    let folders_to_ignore = if include_trash.unwrap_or(false) {
        // Only ignore Drafts — keep Deleted Items so we can act on trashed messages.
        r#"<m:FoldersToIgnore>
    <t:DistinguishedFolderId Id="drafts"/>
  </m:FoldersToIgnore>"#
    } else {
        r#"<m:FoldersToIgnore>
    <t:DistinguishedFolderId Id="deleteditems"/>
    <t:DistinguishedFolderId Id="drafts"/>
  </m:FoldersToIgnore>"#
    };
    let soap_body = format!(
        r#"<m:GetConversationItems>
  <m:ItemShape>
    <t:BaseShape>AllProperties</t:BaseShape>
    <t:BodyType>HTML</t:BodyType>
    <t:AdditionalProperties>
      <t:FieldURI FieldURI="message:IsRead"/>
      <t:FieldURI FieldURI="item:MimeContent"/>
    </t:AdditionalProperties>
  </m:ItemShape>
  {folders_to_ignore}
  <m:MaxItemsToReturn>50</m:MaxItemsToReturn>
  <m:SortOrder>TreeOrderDescending</m:SortOrder>
  <m:Conversations>
    <t:Conversation>
      <t:ConversationId Id="{conversation_id}"/>
    </t:Conversation>
  </m:Conversations>
</m:GetConversationItems>"#,
    );

    let xml = send(&access_token, &soap_body).await?;

    if xml.contains("ResponseClass=\"Error\"") {
        return Err(ews_err(&xml, "EWS error getting thread"));
    }

    // Debug: log whether EWS returned any Attachments block in this response
    eprintln!("[mail] GetConversationItems response has t:Attachments: {}", xml.contains("t:Attachments"));
    eprintln!("[mail] GetConversationItems response has t:IsInline: {}", xml.contains("t:IsInline"));

    let mut messages = Vec::new();

    // EWS items inside a conversation can be Message, MeetingRequest,
    // MeetingResponse, or MeetingCancellation — parse them all the same way
    // since parse_message() extracts generic fields (Subject, From, Body, etc.)
    // that are present on all these types.
    const ITEM_TYPES: &[&str] = &[
        "t:Message",
        "t:MeetingRequest",
        "t:MeetingResponse",
        "t:MeetingCancellation",
    ];

    // Collect (message, inline_images) pairs first, then resolve images async.
    let mut pending: Vec<(MailMessage, Vec<InlineImage>)> = Vec::new();
    for node_xml in xml_all_ns(&xml, "t:ConversationNode") {
        if let Some(items_xml) = xml_content_ns(&node_xml, "t:Items") {
            for &item_type in ITEM_TYPES {
                for msg_xml in xml_all_ns(&items_xml, item_type) {
                    if let Some(msg) = parse_message(&msg_xml) {
                        let inline = parse_inline_images(&msg_xml);
                        pending.push((msg, inline));
                    }
                }
            }
        }
    }

    // Resolve inline images for all messages (sequential per message — images
    // within a single message are fetched in parallel inside inject_inline_images).
    for (msg, inline) in pending {
        let body = inject_inline_images(&access_token, msg.body_html.clone(), inline).await;
        messages.push(MailMessage { body_html: body, ..msg });
    }

    // Sort chronologically (oldest first so the thread reads top-to-bottom)
    messages.sort_by(|a, b| a.date_time_received.cmp(&b.date_time_received));

    Ok(messages)
}

/// Send an email or reply to an existing message.
///
/// Extract the first `<t:ItemId Id="..." ChangeKey="..."/>` from an EWS response.
fn parse_item_id(xml: &str) -> Option<(String, String)> {
    let start = xml.find("<t:ItemId ")?;
    let end = xml[start..].find("/>").map(|e| start + e)?;
    let elem = &xml[start..end];
    let id = xml_attr(elem, "Id")?;
    let ck = xml_attr(elem, "ChangeKey")?;
    Some((id, ck))
}

/// Extract the updated item id/change-key from a `<t:RootItemId .../>` element
/// returned by EWS CreateAttachment.
fn parse_root_item_id(xml: &str) -> Option<(String, String)> {
    let start = xml.find("<t:RootItemId ")?;
    let end = xml[start..].find("/>").map(|e| start + e)?;
    let elem = &xml[start..end];
    let id = xml_attr(elem, "RootItemId")?;
    let ck = xml_attr(elem, "RootItemChangeKey")?;
    Some((id, ck))
}

/// Build the recipient XML blocks used in CreateItem.
fn build_recipients_blocks(to: &[String], cc: &[String], bcc: &[String]) -> (String, String, String) {
    let fmt_list = |list: &[String]| {
        list.iter()
            .map(|e| format!("<t:Mailbox><t:EmailAddress>{}</t:EmailAddress></t:Mailbox>", xml_escape(e)))
            .collect::<Vec<_>>()
            .join("\n        ")
    };
    let to_block = fmt_list(to);
    let cc_block = if cc.is_empty() {
        String::new()
    } else {
        format!("\n      <t:CcRecipients>\n        {}\n      </t:CcRecipients>", fmt_list(cc))
    };
    let bcc_block = if bcc.is_empty() {
        String::new()
    } else {
        format!("\n      <t:BccRecipients>\n        {}\n      </t:BccRecipients>", fmt_list(bcc))
    };
    (to_block, cc_block, bcc_block)
}

/// If `reply_to_item_id` + `reply_to_change_key` are provided a `ReplyAllToItem`
/// is created; otherwise a brand-new `Message` is created.
/// When `attachments` is non-empty, a three-step flow is used:
///   1. CreateItem (SaveOnly) to get an ItemId
///   2. CreateAttachment for each file
///   3. SendItem with the updated ItemId/ChangeKey
#[command]
pub async fn mail_send(
    access_token: String,
    to: Vec<String>,
    cc: Vec<String>,
    bcc: Vec<String>,
    subject: String,
    body_html: String,
    reply_to_item_id: Option<String>,
    reply_to_change_key: Option<String>,
    attachments: Option<Vec<ComposerAttachment>>,
) -> Result<(), String> {
    let atts = attachments.unwrap_or_default();

    // ── Simple path: no attachments ────────────────────────────────────────────
    if atts.is_empty() {
        let soap_body = match (&reply_to_item_id, &reply_to_change_key) {
            (Some(id), Some(ck)) => format!(
                r#"<m:CreateItem MessageDisposition="SendAndSaveCopy">
  <m:Items>
    <t:ReplyAllToItem>
      <t:ReferenceItemId Id="{id}" ChangeKey="{ck}"/>
      <t:NewBodyContent BodyType="HTML">{body}</t:NewBodyContent>
    </t:ReplyAllToItem>
  </m:Items>
</m:CreateItem>"#,
                id = id,
                ck = ck,
                body = xml_escape(&body_html),
            ),
            _ => {
                let (to_block, cc_block, bcc_block) = build_recipients_blocks(&to, &cc, &bcc);
                format!(
                    r#"<m:CreateItem MessageDisposition="SendAndSaveCopy">
  <m:SavedItemFolderId>
    <t:DistinguishedFolderId Id="sentitems"/>
  </m:SavedItemFolderId>
  <m:Items>
    <t:Message>
      <t:Subject>{subject}</t:Subject>
      <t:Body BodyType="HTML">{body}</t:Body>
      <t:ToRecipients>
        {to_block}
      </t:ToRecipients>{cc_block}{bcc_block}
    </t:Message>
  </m:Items>
</m:CreateItem>"#,
                    subject = xml_escape(&subject),
                    body = xml_escape(&body_html),
                )
            }
        };
        let xml = send(&access_token, &soap_body).await?;
        if xml.contains("ResponseClass=\"Error\"") {
            return Err(ews_err(&xml, "EWS send error"));
        }
        return Ok(());
    }

    // ── Step 1: CreateItem (SaveOnly) to obtain an ItemId ─────────────────────
    let create_body = match (&reply_to_item_id, &reply_to_change_key) {
        (Some(id), Some(ck)) => format!(
            r#"<m:CreateItem MessageDisposition="SaveOnly">
  <m:SavedItemFolderId>
    <t:DistinguishedFolderId Id="drafts"/>
  </m:SavedItemFolderId>
  <m:Items>
    <t:ReplyAllToItem>
      <t:ReferenceItemId Id="{id}" ChangeKey="{ck}"/>
      <t:NewBodyContent BodyType="HTML">{body}</t:NewBodyContent>
    </t:ReplyAllToItem>
  </m:Items>
</m:CreateItem>"#,
            id = id,
            ck = ck,
            body = xml_escape(&body_html),
        ),
        _ => {
            let (to_block, cc_block, bcc_block) = build_recipients_blocks(&to, &cc, &bcc);
            format!(
                r#"<m:CreateItem MessageDisposition="SaveOnly">
  <m:SavedItemFolderId>
    <t:DistinguishedFolderId Id="drafts"/>
  </m:SavedItemFolderId>
  <m:Items>
    <t:Message>
      <t:Subject>{subject}</t:Subject>
      <t:Body BodyType="HTML">{body}</t:Body>
      <t:ToRecipients>
        {to_block}
      </t:ToRecipients>{cc_block}{bcc_block}
    </t:Message>
  </m:Items>
</m:CreateItem>"#,
                subject = xml_escape(&subject),
                body = xml_escape(&body_html),
            )
        }
    };

    let xml = send(&access_token, &create_body).await?;
    if xml.contains("ResponseClass=\"Error\"") {
        return Err(ews_err(&xml, "EWS create-draft error"));
    }
    let (mut item_id, mut change_key) =
        parse_item_id(&xml).ok_or("EWS: no ItemId in CreateItem response")?;

    // ── Step 2: CreateAttachment for each file ────────────────────────────────
    for att in &atts {
        let att_block = format!(
            r#"<t:FileAttachment>
    <t:Name>{name}</t:Name>
    <t:ContentType>{ct}</t:ContentType>
    <t:IsInline>false</t:IsInline>
    <t:Content>{data}</t:Content>
  </t:FileAttachment>"#,
            name = xml_escape(&att.name),
            ct = xml_escape(&att.content_type),
            data = att.data,
        );
        let attach_body = format!(
            r#"<m:CreateAttachment>
  <m:ParentItemId Id="{item_id}" ChangeKey="{change_key}"/>
  <m:Attachments>
    {att_block}
  </m:Attachments>
</m:CreateAttachment>"#,
        );
        let xml = send(&access_token, &attach_body).await?;
        if xml.contains("ResponseClass=\"Error\"") {
            return Err(ews_err(&xml, "EWS create-attachment error"));
        }
        // The ChangeKey is updated after each attachment — use the new root item id
        if let Some((new_id, new_ck)) = parse_root_item_id(&xml) {
            item_id = new_id;
            change_key = new_ck;
        }
    }

    // ── Step 3: SendItem ──────────────────────────────────────────────────────
    let send_body = format!(
        r#"<m:SendItem SaveItemToFolder="true">
  <m:ItemIds>
    <t:ItemId Id="{item_id}" ChangeKey="{change_key}"/>
  </m:ItemIds>
  <m:SavedItemFolderId>
    <t:DistinguishedFolderId Id="sentitems"/>
  </m:SavedItemFolderId>
</m:SendItem>"#,
    );
    let xml = send(&access_token, &send_body).await?;
    if xml.contains("ResponseClass=\"Error\"") {
        return Err(ews_err(&xml, "EWS send error"));
    }
    Ok(())
}

/// Save a message as a draft in the Drafts folder without sending it.
#[command]
pub async fn mail_save_draft(
    access_token: String,
    to: Vec<String>,
    cc: Vec<String>,
    bcc: Vec<String>,
    subject: String,
    body_html: String,
) -> Result<(), String> {
    let (to_block, cc_block, bcc_block) = build_recipients_blocks(&to, &cc, &bcc);
    let soap_body = format!(
        r#"<m:CreateItem MessageDisposition="SaveOnly">
  <m:SavedItemFolderId>
    <t:DistinguishedFolderId Id="drafts"/>
  </m:SavedItemFolderId>
  <m:Items>
    <t:Message>
      <t:Subject>{subject}</t:Subject>
      <t:Body BodyType="HTML">{body}</t:Body>
      <t:ToRecipients>
        {to_block}
      </t:ToRecipients>{cc_block}{bcc_block}
    </t:Message>
  </m:Items>
</m:CreateItem>"#,
        subject = xml_escape(&subject),
        body = xml_escape(&body_html),
    );
    let xml = send(&access_token, &soap_body).await?;
    if xml.contains("ResponseClass=\"Error\"") {
        return Err(ews_err(&xml, "EWS save draft error"));
    }
    Ok(())
}

/// Mark a list of messages as read.
#[command]
pub async fn mail_mark_read(
    access_token: String,
    items: Vec<MailItemRef>,
) -> Result<(), String> {
    update_is_read(&access_token, &items, true).await
}

/// Mark a list of messages as unread.
#[command]
pub async fn mail_mark_unread(
    access_token: String,
    items: Vec<MailItemRef>,
) -> Result<(), String> {
    update_is_read(&access_token, &items, false).await
}

/// Shared implementation for mark-read / mark-unread.
async fn update_is_read(
    access_token: &str,
    items: &[MailItemRef],
    is_read: bool,
) -> Result<(), String> {
    if items.is_empty() {
        return Ok(());
    }

    let flag = if is_read { "true" } else { "false" };

    let item_changes = items
        .iter()
        .map(|item| {
            let id = &item.item_id;
            let id_elem = if item.change_key.is_empty() {
                format!(r#"<t:ItemId Id="{id}"/>"#)
            } else {
                let ck = &item.change_key;
                format!(r#"<t:ItemId Id="{id}" ChangeKey="{ck}"/>"#)
            };
            format!(
                r#"<t:ItemChange>
      {id_elem}
      <t:Updates>
        <t:SetItemField>
          <t:FieldURI FieldURI="message:IsRead"/>
          <t:Message>
            <t:IsRead>{flag}</t:IsRead>
          </t:Message>
        </t:SetItemField>
      </t:Updates>
    </t:ItemChange>"#,
            )
        })
        .collect::<Vec<_>>()
        .join("\n    ");

    let soap_body = format!(
        r#"<m:UpdateItem MessageDisposition="SaveOnly" ConflictResolution="AutoResolve">
  <m:ItemChanges>
    {item_changes}
  </m:ItemChanges>
</m:UpdateItem>"#,
    );

    let xml = send(access_token, &soap_body).await?;

    if xml.contains("ResponseClass=\"Error\"") || xml.contains("ResponseClass=\"Warning\"") {
        let label = if is_read { "mark-read" } else { "mark-unread" };
        return Err(ews_err(&xml, &format!("EWS {} error", label)));
    }
    Ok(())
}

/// Move a message to the Deleted Items folder.
#[command]
pub async fn mail_move_to_trash(
    access_token: String,
    item_id: String,
) -> Result<(), String> {
    let soap_body = format!(
        r#"<m:MoveItem>
  <m:ToFolderId>
    <t:DistinguishedFolderId Id="deleteditems"/>
  </m:ToFolderId>
  <m:ItemIds>
    <t:ItemId Id="{item_id}"/>
  </m:ItemIds>
</m:MoveItem>"#,
    );

    let xml = send(&access_token, &soap_body).await?;

    if xml.contains("ResponseClass=\"Error\"") {
        return Err(ews_err(&xml, "EWS move-to-trash error"));
    }
    Ok(())
}

/// Permanently delete a message (hard delete — used when already in Deleted Items).
#[command]
pub async fn mail_permanently_delete(
    access_token: String,
    item_id: String,
) -> Result<(), String> {
    let soap_body = format!(
        r#"<m:DeleteItem DeleteType="HardDelete">
  <m:ItemIds>
    <t:ItemId Id="{item_id}"/>
  </m:ItemIds>
</m:DeleteItem>"#,
    );

    let xml = send(&access_token, &soap_body).await?;

    if xml.contains("ResponseClass=\"Error\"") {
        return Err(ews_err(&xml, "EWS permanently-delete error"));
    }
    Ok(())
}

/// Download an attachment and open it with the system default application.
/// The file is written to the OS temp directory and opened via `open` (macOS).
#[command]
pub async fn mail_open_attachment(
    access_token: String,
    attachment_id: String,
    filename: String,
) -> Result<(), String> {
    let b64_clean = fetch_ews_attachment_base64(&access_token, &attachment_id).await?;
    let bytes = BASE64
        .decode(b64_clean)
        .map_err(|e| format!("Base64 decode error: {}", e))?;

    // Write to temp dir with the original filename
    let safe_name: String = filename
        .chars()
        .map(|c| if c.is_alphanumeric() || ".-_ ".contains(c) { c } else { '_' })
        .collect();
    let path = std::env::temp_dir().join(&safe_name);
    std::fs::write(&path, &bytes).map_err(|e| format!("Write temp file: {}", e))?;

    // Open with system default app (macOS `open`, Linux `xdg-open`, Windows `start`)
    #[cfg(target_os = "macos")]
    std::process::Command::new("open")
        .arg(&path)
        .spawn()
        .map_err(|e| format!("open: {}", e))?;

    #[cfg(target_os = "linux")]
    std::process::Command::new("xdg-open")
        .arg(&path)
        .spawn()
        .map_err(|e| format!("xdg-open: {}", e))?;

    #[cfg(target_os = "windows")]
    std::process::Command::new("cmd")
        .args(["/C", "start", "", path.to_str().unwrap_or("")])
        .spawn()
        .map_err(|e| format!("start: {}", e))?;

    Ok(())
}

/// Fetch an EWS attachment and return its content as a standard base64 string.
async fn fetch_ews_attachment_base64(access_token: &str, attachment_id: &str) -> Result<String, String> {
    let soap_body = format!(
        r#"<m:GetAttachment>
  <m:AttachmentShape/>
  <m:AttachmentIds>
    <t:AttachmentId Id="{attachment_id}"/>
  </m:AttachmentIds>
</m:GetAttachment>"#,
    );
    let xml = send(access_token, &soap_body).await?;
    if xml.contains("ResponseClass=\"Error\"") {
        return Err(ews_err(&xml, "EWS get-attachment error"));
    }
    let b64 = xml_content_ns(&xml, "t:Content")
        .ok_or_else(|| "No attachment content in EWS response".to_string())?;
    let b64_clean: String = b64.chars().filter(|c| !c.is_ascii_whitespace()).collect();
    Ok(b64_clean)
}

/// Return the raw base64 content of an EWS attachment (for in-app preview).
#[command]
pub async fn mail_get_attachment_data(
    access_token: String,
    attachment_id: String,
) -> Result<String, String> {
    fetch_ews_attachment_base64(&access_token, &attachment_id).await
}

// ── Parsing helpers ────────────────────────────────────────────────────────────

fn parse_message(msg_xml: &str) -> Option<MailMessage> {
    // ItemId is self-closing; try both t:ItemId and ItemId
    let item_id_elem = msg_xml
        .find("<t:ItemId ")
        .or_else(|| msg_xml.find("<ItemId "))
        .and_then(|s| msg_xml[s..].find("/>").map(|e| &msg_xml[s..s + e]));
    let item_id = item_id_elem.and_then(|e| xml_attr(e, "Id"))?;
    let change_key = item_id_elem
        .and_then(|e| xml_attr(e, "ChangeKey"))
        .unwrap_or_default();

    let subject = xml_content_ns(msg_xml, "t:Subject").unwrap_or_default();
    let date_time_received =
        xml_content_ns(msg_xml, "t:DateTimeReceived").unwrap_or_default();
    let is_read = xml_content_ns(msg_xml, "t:IsRead")
        .map(|v| v == "true")
        .unwrap_or(false);
    let has_attachments = xml_content_ns(msg_xml, "t:HasAttachments")
        .map(|v| v == "true")
        .unwrap_or(false);

    // From / Sender
    let from_xml = xml_content_ns(msg_xml, "t:From")
        .or_else(|| xml_content_ns(msg_xml, "t:Sender"));
    let from_mailbox = from_xml
        .as_deref()
        .and_then(|s| xml_content_ns(s, "t:Mailbox"));
    let from_name = from_mailbox
        .as_deref()
        .and_then(|m| xml_content_ns(m, "t:Name"))
        .filter(|s| !s.is_empty());
    let from_email = from_mailbox
        .as_deref()
        .and_then(|m| xml_content_ns(m, "t:EmailAddress"))
        .filter(|s| !s.is_empty());

    let to_recipients = parse_recipients(msg_xml, "t:ToRecipients");
    let cc_recipients = parse_recipients(msg_xml, "t:CcRecipients");

    // Body — HTML (we requested BodyType="HTML").
    // EWS returns the HTML XML-escaped inside the <t:Body> text node, so we must
    // unescape entities before handing it to the frontend.
    // Some servers also wrap content in CDATA — handle that too.
    let body_html = xml_content_ns(msg_xml, "t:Body")
        .map(|raw| xml_unescape_body(&raw))
        .unwrap_or_default();

    // Attachments — parse FileAttachment elements (skip inline images)
    let attachments = parse_attachments(msg_xml);

    // Try to extract an ICS from the raw MIME content (for Teams/other invitations
    // that embed text/calendar as a MIME part rather than a FileAttachment).
    let ics_mime = if !has_attachments {
        xml_content_ns(msg_xml, "t:MimeContent")
            .as_deref()
            .and_then(extract_ics_from_mime_base64)
    } else {
        None
    };

    Some(MailMessage {
        item_id,
        change_key,
        subject,
        from_name,
        from_email,
        to_recipients,
        cc_recipients,
        body_html,
        date_time_received,
        is_read,
        has_attachments,
        attachments,
        ics_mime,
    })
}

/// Extract the first `text/calendar` MIME part from a base64-encoded MIME message
/// (the value of `t:MimeContent` in an EWS response).
///
/// Returns the plain ICS text, or `None` if no calendar part is found.
fn extract_ics_from_mime_base64(mime_b64: &str) -> Option<String> {
    // Strip whitespace that EWS sometimes wraps into MimeContent
    let cleaned: String = mime_b64.chars().filter(|c| !c.is_whitespace()).collect();
    let raw = BASE64.decode(cleaned.as_bytes()).ok()?;
    let text = String::from_utf8_lossy(&raw);
    extract_calendar_part_from_mime(&text)
}

/// Walk MIME parts and return the content of the first `text/calendar` part.
///
/// Handles:
/// - `Content-Transfer-Encoding: base64`
/// - `Content-Transfer-Encoding: quoted-printable`
/// - Plain (7bit / 8bit) content
fn extract_calendar_part_from_mime(mime: &str) -> Option<String> {
    let lines: Vec<&str> = mime.lines().collect();
    let mut i = 0;

    while i < lines.len() {
        // Headers can be folded (continuation starts with whitespace).
        // Collect the full unfolded header line.
        if !lines[i].to_ascii_lowercase().starts_with("content-type:") {
            i += 1;
            continue;
        }

        // Gather folded continuation lines for this header
        let mut header = lines[i].to_string();
        let mut j = i + 1;
        while j < lines.len() {
            let next = lines[j];
            if next.starts_with(' ') || next.starts_with('\t') {
                header.push(' ');
                header.push_str(next.trim());
                j += 1;
            } else {
                break;
            }
        }

        if !header.to_ascii_lowercase().contains("text/calendar") {
            i = j;
            continue;
        }

        // Found a text/calendar header. Now scan the following headers of this part
        // to find Content-Transfer-Encoding, then collect the body.
        let mut transfer_encoding = String::new();
        let mut k = j;
        while k < lines.len() && !lines[k].is_empty() {
            let h = lines[k].to_ascii_lowercase();
            if h.starts_with("content-transfer-encoding:") {
                transfer_encoding = h
                    .trim_start_matches("content-transfer-encoding:")
                    .trim()
                    .to_string();
            }
            // Consume folded lines
            k += 1;
            while k < lines.len() && (lines[k].starts_with(' ') || lines[k].starts_with('\t')) {
                k += 1;
            }
        }

        // Skip the blank line separating headers from body
        if k < lines.len() && lines[k].is_empty() {
            k += 1;
        }

        // Collect body lines until next boundary (starts with "--") or end
        let mut body_lines: Vec<&str> = Vec::new();
        while k < lines.len() {
            let l = lines[k];
            if l.starts_with("--") {
                break;
            }
            body_lines.push(l);
            k += 1;
        }

        let body = body_lines.join("\n");

        return match transfer_encoding.as_str() {
            "base64" => {
                let b64: String = body.chars().filter(|c| !c.is_whitespace()).collect();
                BASE64.decode(b64.as_bytes()).ok()
                    .and_then(|bytes| String::from_utf8(bytes).ok())
            }
            "quoted-printable" => Some(decode_quoted_printable(&body)),
            _ => Some(body),
        };
    }

    None
}

/// Minimal quoted-printable decoder (RFC 2045).
fn decode_quoted_printable(input: &str) -> String {
    let mut out = String::with_capacity(input.len());
    let mut chars = input.chars().peekable();

    while let Some(c) = chars.next() {
        if c == '=' {
            let h1 = chars.next();
            let h2 = chars.next();
            match (h1, h2) {
                (Some('\r') | Some('\n'), _) => {
                    // Soft line break — skip
                    // If h1 was \r and h2 is \n, h2 was already consumed
                }
                (Some(a), Some(b)) => {
                    let hex = format!("{}{}", a, b);
                    if let Ok(byte) = u8::from_str_radix(&hex, 16) {
                        out.push(byte as char);
                    } else {
                        out.push('=');
                        out.push(a);
                        out.push(b);
                    }
                }
                (Some(a), None) => { out.push('='); out.push(a); }
                (None, _) => { out.push('='); }
            }
        } else {
            out.push(c);
        }
    }
    out
}

fn parse_attachments(msg_xml: &str) -> Vec<MailAttachment> {
    let mut attachments = Vec::new();
    let att_list = xml_content_ns(msg_xml, "t:Attachments").unwrap_or_default();

    for att_xml in xml_all_ns(&att_list, "t:FileAttachment") {
        // AttachmentId is self-closing
        let id_elem = att_xml
            .find("<t:AttachmentId ")
            .or_else(|| att_xml.find("<AttachmentId "))
            .and_then(|s| att_xml[s..].find("/>").map(|e| &att_xml[s..s + e]));
        let attachment_id = match id_elem.and_then(|e| xml_attr(e, "Id")) {
            Some(id) => id,
            None => continue,
        };

        let name = xml_content_ns(&att_xml, "t:Name").unwrap_or_default();
        let content_type = xml_content_ns(&att_xml, "t:ContentType")
            .unwrap_or_else(|| "application/octet-stream".to_string());
        let size = xml_content_ns(&att_xml, "t:Size")
            .and_then(|v| v.parse().ok())
            .unwrap_or(0u64);
        let is_inline = xml_content_ns(&att_xml, "t:IsInline")
            .map(|v| v == "true")
            .unwrap_or(false);

        if is_inline {
            // Inline images are collected separately for later HTML injection.
            continue;
        }

        attachments.push(MailAttachment {
            attachment_id,
            name,
            content_type,
            size,
            is_inline,
        });
    }

    attachments
}

/// Internal representation of an inline image attachment (used for body injection).
struct InlineImage {
    attachment_id: String,
    content_id: Option<String>,
    content_type: String,
}

/// Parse inline image attachments (IsInline=true) from the message XML,
/// returning attachment id, optional CID, and content-type.
fn parse_inline_images(msg_xml: &str) -> Vec<InlineImage> {
    let mut images = Vec::new();
    let att_list = match xml_content_ns(msg_xml, "t:Attachments") {
        Some(l) => l,
        None => return images,
    };

    for att_xml in xml_all_ns(&att_list, "t:FileAttachment") {
        let is_inline = xml_content_ns(&att_xml, "t:IsInline")
            .map(|v| v == "true")
            .unwrap_or(false);
        if !is_inline {
            continue;
        }

        let id_elem = att_xml
            .find("<t:AttachmentId ")
            .or_else(|| att_xml.find("<AttachmentId "))
            .and_then(|s| att_xml[s..].find("/>").map(|e| &att_xml[s..s + e]));
        let attachment_id = match id_elem.and_then(|e| xml_attr(e, "Id")) {
            Some(id) => id,
            None => continue,
        };

        let content_id = xml_content_ns(&att_xml, "t:ContentId");
        let content_type = xml_content_ns(&att_xml, "t:ContentType")
            .unwrap_or_else(|| "image/png".to_string());

        images.push(InlineImage { attachment_id, content_id, content_type });
    }

    images
}

/// Fetch inline image attachments and inject them into the HTML body as data URIs.
///
/// Exchange often strips `cid:` references from `src` attributes, leaving
/// `src=""`.  We try two strategies:
/// 1. Replace `src="cid:{contentId}"` by CID when the reference is present.
/// 2. Fall back to sequential replacement of `src=""` for images that had no
///    CID match (preserves the document order, which Exchange keeps consistent).
async fn inject_inline_images(
    access_token: &str,
    body_html: String,
    inline_images: Vec<InlineImage>,
) -> String {
    if inline_images.is_empty() {
        eprintln!("[mail] inject_inline_images: no inline attachments found in EWS response");
        return body_html;
    }
    eprintln!("[mail] inject_inline_images: {} inline attachment(s) to fetch", inline_images.len());

    // Fetch all inline image data sequentially (avoids the `futures` crate dependency).
    let mut fetch_results: Vec<(InlineImage, Result<String, String>)> = Vec::new();
    for img in inline_images {
        eprintln!("[mail] fetching inline attachment id={} content_id={:?} type={}", img.attachment_id, img.content_id, img.content_type);
        let data = fetch_ews_attachment_base64(access_token, &img.attachment_id).await;
        if let Err(ref e) = data {
            eprintln!("[mail] fetch failed: {}", e);
        }
        fetch_results.push((img, data));
    }

    let mut html = body_html;
    let mut unmatched: Vec<(String, String)> = Vec::new(); // (content_type, base64_data)

    for (img, result) in fetch_results {
        let base64_data = match result {
            Ok(d) => d,
            Err(_) => continue,
        };
        let data_uri = format!("data:{};base64,{}", img.content_type, base64_data);

        // Strategy 1: replace by CID reference.
        let mut replaced = false;
        if let Some(cid) = &img.content_id {
            let cid_ref = format!("src=\"cid:{}\"", cid);
            let new = html.replace(&cid_ref, &format!("src=\"{}\"", data_uri));
            if new != html {
                html = new;
                replaced = true;
            }
            // Also try single-quoted variant.
            if !replaced {
                let cid_ref_sq = format!("src='cid:{}'", cid);
                let new = html.replace(&cid_ref_sq, &format!("src='{}'", data_uri));
                if new != html {
                    html = new;
                    replaced = true;
                }
            }
        }

        if !replaced {
            unmatched.push((img.content_type, base64_data));
        }
    }

    // Strategy 2: sequentially replace empty/bare src for unmatched images.
    // Exchange can produce: src=""  |  src=''  |  src  (bare, no value at all)
    for (ct, data) in unmatched {
        let data_uri = format!("data:{};base64,{}", ct, data);
        html = replace_next_empty_src(&html, &data_uri);
    }

    html
}

/// Replace the next occurrence of an empty/bare `src` attribute in HTML with `src="{data_uri}"`.
///
/// Handles three forms Exchange produces:
///   `src=""`  — empty double-quoted value
///   `src=''`  — empty single-quoted value
///   `src`     — bare attribute (no `=`, no value), which is what Exchange Online often emits
fn replace_next_empty_src(html: &str, data_uri: &str) -> String {
    // 1. src="" (6 bytes)
    if let Some(pos) = html.find("src=\"\"") {
        return format!("{}src=\"{}\"{}",
            &html[..pos], data_uri, &html[pos + 6..]);
    }
    // 2. src='' (6 bytes)
    if let Some(pos) = html.find("src=''") {
        return format!("{}src='{}'{}",
            &html[..pos], data_uri, &html[pos + 6..]);
    }
    // 3. Bare `src` not followed by `=` — scan carefully to avoid false matches
    //    on e.g. `srcset=`.
    let needle = "src";
    let mut search = 0;
    while let Some(rel) = html[search..].find(needle) {
        let abs = search + rel;
        let after = abs + needle.len();
        // Must not be preceded by a word character (avoid matching "nosrc" etc.)
        let preceded_ok = abs == 0 || !html[..abs].ends_with(|c: char| c.is_ascii_alphanumeric() || c == '_' || c == '-');
        // Must not be followed by `=` (that would be a non-empty src=...)
        // Whitespace between `src` and `>` / next attr is fine.
        let next_non_ws = html[after..].trim_start_matches(|c: char| c == ' ' || c == '\t' || c == '\r' || c == '\n');
        let followed_ok = !next_non_ws.starts_with('=');
        if preceded_ok && followed_ok {
            // Replace `src` (the bare attribute) with `src="data_uri"`,
            // leaving whatever follows (space, >) untouched.
            return format!("{}src=\"{}\"{}",
                &html[..abs], data_uri, &html[after..]);
        }
        search = abs + 1;
    }
    // No empty/bare src found — return unchanged.
    html.to_string()
}

fn parse_recipients(msg_xml: &str, tag: &str) -> Vec<MailRecipient> {
    let mut recipients = Vec::new();
    if let Some(list_xml) = xml_content_ns(msg_xml, tag) {
        for mailbox_xml in xml_all_ns(&list_xml, "t:Mailbox") {
            let email =
                xml_content_ns(&mailbox_xml, "t:EmailAddress").unwrap_or_default();
            let name = xml_content_ns(&mailbox_xml, "t:Name").filter(|s| !s.is_empty());
            recipients.push(MailRecipient { name, email });
        }
    }
    recipients
}

/// Get the unread message count for the inbox (fast single-folder lookup).
#[command]
pub async fn mail_get_inbox_unread(access_token: String) -> Result<u32, String> {
    let soap_body = r#"<m:GetFolder>
  <m:FolderShape>
    <t:BaseShape>IdOnly</t:BaseShape>
    <t:AdditionalProperties>
      <t:FieldURI FieldURI="folder:UnreadCount"/>
    </t:AdditionalProperties>
  </m:FolderShape>
  <m:FolderIds>
    <t:DistinguishedFolderId Id="inbox"/>
  </m:FolderIds>
</m:GetFolder>"#;

    let xml = send(&access_token, soap_body).await?;

    if xml.contains("ResponseClass=\"Error\"") {
        return Err(ews_err(&xml, "EWS error getting inbox unread count"));
    }

    let count = xml_content_ns(&xml, "t:UnreadCount")
        .and_then(|v| v.parse().ok())
        .unwrap_or(0u32);

    Ok(count)
}

/// Find the "Snoozed" folder under msgfolderroot, creating it if absent.
/// Returns the EWS FolderId string.
#[command]
pub async fn mail_find_or_create_snoozed_folder(
    access_token: String,
) -> Result<String, String> {
    // Try to find an existing "Snoozed" folder.
    let find_body = r#"<m:FindFolder Traversal="Shallow">
  <m:FolderShape>
    <t:BaseShape>IdOnly</t:BaseShape>
  </m:FolderShape>
  <m:Restriction>
    <t:IsEqualTo>
      <t:FieldURI FieldURI="folder:DisplayName"/>
      <t:FieldURIOrConstant>
        <t:Constant Value="Snoozed"/>
      </t:FieldURIOrConstant>
    </t:IsEqualTo>
  </m:Restriction>
  <m:ParentFolderIds>
    <t:DistinguishedFolderId Id="msgfolderroot"/>
  </m:ParentFolderIds>
</m:FindFolder>"#;

    let xml = send(&access_token, find_body).await?;

    // Extract FolderId from the response if it exists.
    let folder_id_elem = xml
        .find("<t:FolderId ")
        .or_else(|| xml.find("<FolderId "))
        .and_then(|s| xml[s..].find("/>").map(|e| &xml[s..s + e]));

    if let Some(id) = folder_id_elem.and_then(|e| xml_attr(e, "Id")) {
        return Ok(id);
    }

    // Folder not found — create it.
    let create_body = r#"<m:CreateFolder>
  <m:ParentFolderId>
    <t:DistinguishedFolderId Id="msgfolderroot"/>
  </m:ParentFolderId>
  <m:Folders>
    <t:Folder>
      <t:DisplayName>Snoozed</t:DisplayName>
    </t:Folder>
  </m:Folders>
</m:CreateFolder>"#;

    let xml = send(&access_token, create_body).await?;

    if xml.contains("ResponseClass=\"Error\"") {
        return Err(ews_err(&xml, "EWS create Snoozed folder error"));
    }

    let folder_id_elem = xml
        .find("<t:FolderId ")
        .or_else(|| xml.find("<FolderId "))
        .and_then(|s| xml[s..].find("/>").map(|e| &xml[s..s + e]));

    folder_id_elem
        .and_then(|e| xml_attr(e, "Id"))
        .ok_or_else(|| "Could not parse FolderId from CreateFolder response".to_string())
}

/// Move a mail item to any folder (distinguished name like "inbox", or an arbitrary EWS FolderId).
#[command]
pub async fn mail_move_to_folder(
    access_token: String,
    item_id: String,
    folder_id: String,
) -> Result<(), String> {
    let to_folder = match folder_id.as_str() {
        "inbox" | "sentitems" | "deleteditems" | "drafts" => {
            format!(r#"<t:DistinguishedFolderId Id="{}"/>"#, folder_id)
        }
        id => format!(r#"<t:FolderId Id="{}"/>"#, id),
    };

    let soap_body = format!(
        r#"<m:MoveItem>
  <m:ToFolderId>
    {to_folder}
  </m:ToFolderId>
  <m:ItemIds>
    <t:ItemId Id="{item_id}"/>
  </m:ItemIds>
</m:MoveItem>"#,
    );

    let xml = send(&access_token, &soap_body).await?;

    if xml.contains("ResponseClass=\"Error\"") {
        return Err(ews_err(&xml, "EWS move-to-folder error"));
    }
    Ok(())
}

/// Snooze a mail item: moves it to the "Snoozed" folder and returns that folder's ID.
/// The frontend stores the snooze expiry and calls mail_move_to_folder("inbox") when it fires.
#[command]
pub async fn mail_snooze(
    access_token: String,
    item_id: String,
) -> Result<String, String> {
    let folder_id = mail_find_or_create_snoozed_folder(access_token.clone()).await?;
    mail_move_to_folder(access_token, item_id, folder_id.clone()).await?;
    Ok(folder_id)
}

fn xml_escape(s: &str) -> String {
    s.replace('&', "&amp;")
        .replace('<', "&lt;")
        .replace('>', "&gt;")
        .replace('"', "&quot;")
        .replace('\'', "&apos;")
}

/// Unescape an HTML body that EWS returned XML-escaped inside a text node.
///
/// EWS encodes `<html>…</html>` as `&lt;html&gt;…&lt;/html&gt;` in the XML
/// response. We reverse that here so the frontend receives real HTML.
/// Also strips a CDATA wrapper when present (`<![CDATA[…]]>`).
fn xml_unescape_body(raw: &str) -> String {
    // 1. Strip optional CDATA wrapper
    let inner = {
        let trimmed = raw.trim();
        if trimmed.starts_with("<![CDATA[") && trimmed.ends_with("]]>") {
            &trimmed[9..trimmed.len() - 3]
        } else {
            trimmed
        }
    };

    // 2. Unescape XML character entities.
    //    Order matters: &amp; must be last so that &amp;lt; → &lt; (not <).
    inner
        .replace("&lt;", "<")
        .replace("&gt;", ">")
        .replace("&quot;", "\"")
        .replace("&apos;", "'")
        .replace("&#xA;", "\n")
        .replace("&#xa;", "\n")
        .replace("&#xD;", "\r")
        .replace("&#xd;", "\r")
        .replace("&#x9;", "\t")
        .replace("&amp;", "&")   // ← last
}
