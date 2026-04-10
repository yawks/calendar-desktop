use base64::{engine::general_purpose::STANDARD as BASE64, Engine as _};
use serde::{Deserialize, Serialize};
use tauri::command;
use urlencoding;

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
        return Err(format!("EWS HTTP {}: {}", status, &body[..body.len().min(400)]));
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

/// Minimal item reference used by mark-read / mark-unread commands.
#[derive(Deserialize, Debug)]
pub struct MailItemRef {
    pub item_id: String,
    pub change_key: String,
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
    let parent_folder_id = match folder.as_str() {
        "inbox" | "sentitems" | "deleteditems" => {
            format!(r#"<t:DistinguishedFolderId Id="{}"/>"#, folder)
        }
        id => format!(r#"<t:FolderId Id="{}"/>"#, id),
    };
    let count = max_count.unwrap_or(50);

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

/// Fetch all messages in a conversation thread.
/// Pass `include_trash: true` to include items from the Deleted Items folder
/// (needed when the caller itself is operating on the trash folder).
#[command]
pub async fn mail_get_thread(
    access_token: String,
    conversation_id: String,
    include_trash: Option<bool>,
) -> Result<Vec<MailMessage>, String> {
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

    for node_xml in xml_all_ns(&xml, "t:ConversationNode") {
        if let Some(items_xml) = xml_content_ns(&node_xml, "t:Items") {
            for &item_type in ITEM_TYPES {
                for msg_xml in xml_all_ns(&items_xml, item_type) {
                    if let Some(msg) = parse_message(&msg_xml) {
                        messages.push(msg);
                    }
                }
            }
        }
    }

    // Sort chronologically (oldest first so the thread reads top-to-bottom)
    messages.sort_by(|a, b| a.date_time_received.cmp(&b.date_time_received));

    Ok(messages)
}

/// Send an email or reply to an existing message.
///
/// If `reply_to_item_id` + `reply_to_change_key` are provided a `ReplyAllToItem`
/// is created; otherwise a brand-new `Message` is created.
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
) -> Result<(), String> {
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
            let to_recipients = to
                .iter()
                .map(|email| {
                    format!(
                        r#"<t:Mailbox><t:EmailAddress>{}</t:EmailAddress></t:Mailbox>"#,
                        xml_escape(email)
                    )
                })
                .collect::<Vec<_>>()
                .join("\n        ");
            let cc_block = if cc.is_empty() {
                String::new()
            } else {
                let cc_recipients = cc
                    .iter()
                    .map(|email| {
                        format!(
                            r#"<t:Mailbox><t:EmailAddress>{}</t:EmailAddress></t:Mailbox>"#,
                            xml_escape(email)
                        )
                    })
                    .collect::<Vec<_>>()
                    .join("\n        ");
                format!("\n      <t:CcRecipients>\n        {cc_recipients}\n      </t:CcRecipients>")
            };
            let bcc_block = if bcc.is_empty() {
                String::new()
            } else {
                let bcc_recipients = bcc
                    .iter()
                    .map(|email| {
                        format!(
                            r#"<t:Mailbox><t:EmailAddress>{}</t:EmailAddress></t:Mailbox>"#,
                            xml_escape(email)
                        )
                    })
                    .collect::<Vec<_>>()
                    .join("\n        ");
                format!("\n      <t:BccRecipients>\n        {bcc_recipients}\n      </t:BccRecipients>")
            };
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
        {to_recipients}
      </t:ToRecipients>{cc_block}{bcc_block}
    </t:Message>
  </m:Items>
</m:CreateItem>"#,
                subject = xml_escape(&subject),
                body = xml_escape(&body_html),
                to_recipients = to_recipients,
                cc_block = cc_block,
                bcc_block = bcc_block,
            )
        }
    };

    let xml = send(&access_token, &soap_body).await?;

    if xml.contains("ResponseClass=\"Error\"") {
        return Err(ews_err(&xml, "EWS send error"));
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
    let soap_body = format!(
        r#"<m:GetAttachment>
  <m:AttachmentShape/>
  <m:AttachmentIds>
    <t:AttachmentId Id="{attachment_id}"/>
  </m:AttachmentIds>
</m:GetAttachment>"#,
    );

    let xml = send(&access_token, &soap_body).await?;

    if xml.contains("ResponseClass=\"Error\"") {
        return Err(ews_err(&xml, "EWS get-attachment error"));
    }

    // Content is base64-encoded inside <t:Content> or <Content>
    let b64 = xml_content_ns(&xml, "t:Content")
        .ok_or_else(|| "No attachment content in EWS response".to_string())?;

    // Strip any whitespace/newlines that EWS may insert
    let b64_clean: String = b64.chars().filter(|c| !c.is_ascii_whitespace()).collect();
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
    })
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

        // Skip cid: inline images — they're already embedded in body_html
        if is_inline {
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
