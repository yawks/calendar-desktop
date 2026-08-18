use base64::{engine::general_purpose::STANDARD as BASE64, Engine as _};

use crate::ews::{xml_all_ns, xml_attr, xml_content, xml_content_ns};
use crate::mail_provider::{
    ComposerAttachment, MailAttachment, MailFolder, MailIdentity, MailItemRef, MailMessage,
    MailProvider, MailRecipient, MailSearchQuery, MailThread, SaveDraftParams, SendMailParams,
};

const EWS_ENDPOINT: &str = "https://outlook.office365.com/EWS/Exchange.asmx";

// ── EwsProvider ───────────────────────────────────────────────────────────────

pub struct EwsProvider {
    access_token: String,
    user_email: Option<String>,
    list_offset: u32,
}

impl EwsProvider {
    pub fn new(access_token: String) -> Self {
        Self {
            access_token,
            user_email: None,
            list_offset: 0,
        }
    }
    pub fn with_user_email(access_token: String, user_email: String) -> Self {
        Self {
            access_token,
            user_email: Some(user_email),
            list_offset: 0,
        }
    }
    pub fn with_user_email_and_offset(
        access_token: String,
        user_email: Option<String>,
        list_offset: u32,
    ) -> Self {
        Self {
            access_token,
            user_email,
            list_offset,
        }
    }
}

// ── Private network helpers ───────────────────────────────────────────────────

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
        // A missing or non-SMTP contact photo is not a mail synchronization
        // failure. EWS commonly reports it as an HTTP 500 SOAP fault; keep that
        // expected fallback out of the console and out of query retries.
        if soap_body.contains("<m:GetUserPhoto>") {
            return Err("ews_photo_unavailable".to_string());
        }
        eprintln!("[EWS send] HTTP {} body:\n{}", status, &body);
        return Err(format!(
            "EWS HTTP {}: {}",
            status,
            &body[..body.len().min(2000)]
        ));
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

/// Returns the real EWS FolderId for a distinguished folder (e.g. "junkemail").
async fn get_distinguished_folder_id(access_token: &str, distinguished_id: &str) -> Option<String> {
    let soap_body = format!(
        r#"<m:GetFolder>
  <m:FolderShape>
    <t:BaseShape>IdOnly</t:BaseShape>
  </m:FolderShape>
  <m:FolderIds>
    <t:DistinguishedFolderId Id="{distinguished_id}"/>
  </m:FolderIds>
</m:GetFolder>"#
    );
    let xml = send(access_token, &soap_body).await.ok()?;
    if xml.contains("ResponseClass=\"Error\"") {
        return None;
    }
    let id_elem = xml
        .find("<t:FolderId ")
        .or_else(|| xml.find("<FolderId "))
        .and_then(|s| xml[s..].find("/>").map(|e| &xml[s..s + e]))?;
    xml_attr(id_elem, "Id").map(|s| s.to_string())
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
        Err(e) => {
            eprintln!("[find_all_mail_folder_ids] error: {}", e);
            return vec![];
        }
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
fn build_recipients_blocks(
    to: &[String],
    cc: &[String],
    bcc: &[String],
) -> (String, String, String) {
    let fmt_list = |list: &[String]| {
        list.iter()
            .map(|e| {
                format!(
                    "<t:Mailbox><t:EmailAddress>{}</t:EmailAddress></t:Mailbox>",
                    xml_escape(e)
                )
            })
            .collect::<Vec<_>>()
            .join("\n        ")
    };
    let to_block = fmt_list(to);
    let cc_block = if cc.is_empty() {
        String::new()
    } else {
        format!(
            "\n      <t:CcRecipients>\n        {}\n      </t:CcRecipients>",
            fmt_list(cc)
        )
    };
    let bcc_block = if bcc.is_empty() {
        String::new()
    } else {
        format!(
            "\n      <t:BccRecipients>\n        {}\n      </t:BccRecipients>",
            fmt_list(bcc)
        )
    };
    (to_block, cc_block, bcc_block)
}

pub(crate) async fn fetch_ews_attachment_base64(
    access_token: &str,
    attachment_id: &str,
) -> Result<String, String> {
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

// ── impl MailProvider ─────────────────────────────────────────────────────────

impl MailProvider for EwsProvider {
    async fn list_folders(&self) -> Result<Vec<MailFolder>, String> {
        let access_token = &self.access_token;
        let inbox_id = get_distinguished_folder_id(access_token, "inbox").await;
        let sentitems_id = get_distinguished_folder_id(access_token, "sentitems").await;
        let drafts_id = get_distinguished_folder_id(access_token, "drafts").await;
        let deleteditems_id = get_distinguished_folder_id(access_token, "deleteditems").await;
        let junkemail_id = get_distinguished_folder_id(access_token, "junkemail").await;

        let soap_body = r#"<m:FindFolder Traversal="Deep">
  <m:FolderShape>
    <t:BaseShape>AllProperties</t:BaseShape>
  </m:FolderShape>
  <m:ParentFolderIds>
    <t:DistinguishedFolderId Id="msgfolderroot"/>
  </m:ParentFolderIds>
</m:FindFolder>"#;

        let xml = send(access_token, soap_body).await?;

        if xml.contains("ResponseClass=\"Error\"") {
            return Err(ews_err(&xml, "EWS error listing folders"));
        }

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

            // EWS returns opaque IDs for distinguished folders. Expose stable keys so
            // callers can reliably identify them regardless of the mailbox language.
            let folder_id = if inbox_id.as_deref() == Some(folder_id.as_str()) {
                "inbox".to_string()
            } else if sentitems_id.as_deref() == Some(folder_id.as_str()) {
                "sentitems".to_string()
            } else if drafts_id.as_deref() == Some(folder_id.as_str()) {
                "drafts".to_string()
            } else if deleteditems_id.as_deref() == Some(folder_id.as_str()) {
                "deleteditems".to_string()
            } else if display_name == "Snoozed" {
                "snoozed".to_string()
            } else if junkemail_id.as_deref() == Some(folder_id.as_str()) {
                "spam".to_string()
            } else {
                folder_id
            };
            folders.push(MailFolder {
                folder_id,
                display_name,
                total_count,
                unread_count,
            });
        }

        Ok(folders)
    }

    async fn get_inbox_unread(&self) -> Result<u32, String> {
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

        let xml = send(&self.access_token, soap_body).await?;

        if xml.contains("ResponseClass=\"Error\"") {
            return Err(ews_err(&xml, "EWS error getting inbox unread count"));
        }

        let count = xml_content_ns(&xml, "t:UnreadCount")
            .and_then(|v| v.parse().ok())
            .unwrap_or(0u32);

        Ok(count)
    }

    async fn list_threads(
        &self,
        folder: &str,
        max_count: Option<u32>,
    ) -> Result<Vec<MailThread>, String> {
        let access_token = &self.access_token;
        let count = max_count.unwrap_or(50);

        if folder == "scheduled" {
            let soap_body = format!(
                r#"<m:FindItem Traversal="Shallow">
  <m:ItemShape>
    <t:BaseShape>AllProperties</t:BaseShape>
    <t:AdditionalProperties>
      <t:ExtendedFieldURI PropertyTag="0x3FEF" PropertyType="SystemTime"/>
    </t:AdditionalProperties>
  </m:ItemShape>
  <m:IndexedPageItemView MaxEntriesReturned="{count}" Offset="0" BasePoint="Beginning"/>
  <m:ParentFolderIds><t:DistinguishedFolderId Id="outbox"/></m:ParentFolderIds>
</m:FindItem>"#
            );
            let xml = send(access_token, &soap_body).await?;
            if xml.contains("ResponseClass=\"Error\"") {
                return Err(ews_err(&xml, "EWS error listing scheduled messages"));
            }
            let mut threads = Vec::new();
            for msg_xml in xml_all_ns(&xml, "t:Message") {
                let item_id = msg_xml
                    .find("<t:ItemId ")
                    .or_else(|| msg_xml.find("<ItemId "))
                    .and_then(|start| {
                        msg_xml[start..]
                            .find("/>")
                            .map(|end| &msg_xml[start..start + end])
                    })
                    .and_then(|element| xml_attr(element, "Id"));
                let conversation_id = msg_xml
                    .find("<t:ConversationId ")
                    .or_else(|| msg_xml.find("<ConversationId "))
                    .and_then(|start| {
                        msg_xml[start..]
                            .find("/>")
                            .map(|end| &msg_xml[start..start + end])
                    })
                    .and_then(|element| xml_attr(element, "Id"))
                    .or(item_id);
                let Some(conversation_id) = conversation_id else {
                    continue;
                };
                let deferred_until = xml_content_ns(&msg_xml, "t:ExtendedProperty")
                    .and_then(|property| xml_content_ns(&property, "t:Value"))
                    .unwrap_or_else(|| {
                        xml_content_ns(&msg_xml, "t:DateTimeCreated").unwrap_or_default()
                    });
                let recipients_xml = xml_content_ns(&msg_xml, "t:ToRecipients").unwrap_or_default();
                let to_recipients = xml_all_ns(&recipients_xml, "t:Mailbox")
                    .into_iter()
                    .filter_map(|mailbox| {
                        let email = xml_content_ns(&mailbox, "t:EmailAddress")?;
                        Some(MailRecipient {
                            name: xml_content_ns(&mailbox, "t:Name"),
                            email,
                        })
                    })
                    .collect();
                threads.push(MailThread {
                    conversation_id,
                    topic: xml_content_ns(&msg_xml, "t:Subject").unwrap_or_default(),
                    snippet: xml_content_ns(&msg_xml, "t:Preview").unwrap_or_default(),
                    last_delivery_time: deferred_until,
                    message_count: 1,
                    unread_count: 0,
                    from_name: None,
                    from_email: None,
                    has_attachments: xml_content_ns(&msg_xml, "t:HasAttachments")
                        .is_some_and(|value| value == "true"),
                    to_recipients,
                    cc_recipients: vec![],
                    unique_senders: vec![],
                    snoozed_until: None,
                });
            }
            threads.sort_by(|a, b| a.last_delivery_time.cmp(&b.last_delivery_time));
            return Ok(threads);
        }

        if folder == "drafts" {
            let soap_body = format!(
                r#"<m:FindItem Traversal="Shallow">
  <m:ItemShape>
    <t:BaseShape>IdOnly</t:BaseShape>
    <t:AdditionalProperties>
      <t:FieldURI FieldURI="item:Subject"/>
      <t:FieldURI FieldURI="item:DateTimeReceived"/>
      <t:FieldURI FieldURI="item:HasAttachments"/>
      <t:FieldURI FieldURI="message:ToRecipients"/>
      <t:FieldURI FieldURI="message:Sender"/>
    </t:AdditionalProperties>
  </m:ItemShape>
  <m:IndexedPageItemView MaxEntriesReturned="{count}" Offset="{offset}" BasePoint="Beginning"/>
  <m:SortOrder>
    <t:FieldOrder Order="Descending">
      <t:FieldURI FieldURI="item:DateTimeReceived"/>
    </t:FieldOrder>
  </m:SortOrder>
  <m:ParentFolderIds>
    <t:DistinguishedFolderId Id="drafts"/>
  </m:ParentFolderIds>
</m:FindItem>"#,
                offset = self.list_offset,
            );
            let xml = send(access_token, &soap_body).await?;
            if xml.contains("ResponseClass=\"Error\"") {
                return Err(ews_err(&xml, "EWS error listing drafts"));
            }
            let mut threads = Vec::new();
            for msg_xml in xml_all_ns(&xml, "t:Message") {
                let item_id_elem = msg_xml
                    .find("<t:ItemId ")
                    .or_else(|| msg_xml.find("<ItemId "))
                    .and_then(|s| msg_xml[s..].find("/>").map(|e| &msg_xml[s..s + e]));
                let item_id = match item_id_elem.and_then(|e| xml_attr(e, "Id")) {
                    Some(id) => id,
                    None => continue,
                };
                let topic = xml_content_ns(&msg_xml, "t:Subject").unwrap_or_default();
                let last_delivery_time =
                    xml_content_ns(&msg_xml, "t:DateTimeReceived").unwrap_or_default();
                let has_attachments = xml_content_ns(&msg_xml, "t:HasAttachments")
                    .map(|v| v == "true")
                    .unwrap_or(false);
                let sender_xml = xml_content_ns(&msg_xml, "t:Sender").unwrap_or_default();
                let sender_mb = xml_content_ns(&sender_xml, "t:Mailbox").unwrap_or_default();
                let sender_name = xml_content_ns(&sender_mb, "t:Name")
                    .filter(|s| !s.is_empty())
                    .or_else(|| {
                        xml_content_ns(&sender_mb, "t:EmailAddress").filter(|s| !s.is_empty())
                    });
                threads.push(MailThread {
                    conversation_id: item_id,
                    topic,
                    snippet: String::new(),
                    last_delivery_time,
                    message_count: 1,
                    unread_count: 0,
                    from_name: sender_name,
                    from_email: None,
                    has_attachments,
                    to_recipients: vec![],
                    cc_recipients: vec![],
                    unique_senders: vec![],
                    snoozed_until: None,
                });
            }
            return Ok(threads);
        }

        if folder == "snoozed" {
            let folder_id = self.find_or_create_snoozed_folder().await?;
            let soap_body = format!(
                r#"<m:FindItem Traversal="Shallow">
  <m:ItemShape>
    <t:BaseShape>IdOnly</t:BaseShape>
    <t:AdditionalProperties>
      <t:FieldURI FieldURI="item:ConversationId"/>
      <t:FieldURI FieldURI="item:Subject"/>
      <t:FieldURI FieldURI="item:DateTimeReceived"/>
      <t:FieldURI FieldURI="item:HasAttachments"/>
      <t:FieldURI FieldURI="message:IsRead"/>
      <t:FieldURI FieldURI="message:From"/>
      <t:ExtendedFieldURI PropertyTag="0x0F07" PropertyType="SystemTime"/>
    </t:AdditionalProperties>
  </m:ItemShape>
  <m:IndexedPageItemView MaxEntriesReturned="{count}" Offset="{offset}" BasePoint="Beginning"/>
  <m:ParentFolderIds><t:FolderId Id="{folder_id}"/></m:ParentFolderIds>
</m:FindItem>"#,
                offset = self.list_offset
            );
            let xml = send(access_token, &soap_body).await?;
            if xml.contains("ResponseClass=\"Error\"") {
                return Err(ews_err(&xml, "EWS error listing snoozed messages"));
            }
            let mut threads = Vec::new();
            for msg_xml in xml_all_ns(&xml, "t:Message") {
                let item_id = msg_xml
                    .find("<t:ItemId ")
                    .or_else(|| msg_xml.find("<ItemId "))
                    .and_then(|start| {
                        msg_xml[start..]
                            .find("/>")
                            .map(|end| &msg_xml[start..start + end])
                    })
                    .and_then(|element| xml_attr(element, "Id"));
                let conversation_id = msg_xml
                    .find("<t:ConversationId ")
                    .or_else(|| msg_xml.find("<ConversationId "))
                    .and_then(|start| {
                        msg_xml[start..]
                            .find("/>")
                            .map(|end| &msg_xml[start..start + end])
                    })
                    .and_then(|element| xml_attr(element, "Id"))
                    .or(item_id);
                let Some(conversation_id) = conversation_id else {
                    continue;
                };
                let from_xml = xml_content_ns(&msg_xml, "t:From").unwrap_or_default();
                let mailbox = xml_content_ns(&from_xml, "t:Mailbox").unwrap_or_default();
                let from_email = xml_content_ns(&mailbox, "t:EmailAddress");
                let from_name = xml_content_ns(&mailbox, "t:Name").or_else(|| from_email.clone());
                let snoozed_until = xml_content_ns(&msg_xml, "t:ExtendedProperty")
                    .and_then(|property| xml_content_ns(&property, "t:Value"));
                threads.push(MailThread {
                    conversation_id,
                    topic: xml_content_ns(&msg_xml, "t:Subject").unwrap_or_default(),
                    snippet: String::new(),
                    last_delivery_time: xml_content_ns(&msg_xml, "t:DateTimeReceived")
                        .unwrap_or_default(),
                    message_count: 1,
                    unread_count: if xml_content_ns(&msg_xml, "t:IsRead").as_deref() == Some("true")
                    {
                        0
                    } else {
                        1
                    },
                    from_name,
                    from_email,
                    has_attachments: xml_content_ns(&msg_xml, "t:HasAttachments").as_deref()
                        == Some("true"),
                    to_recipients: vec![],
                    cc_recipients: vec![],
                    unique_senders: vec![],
                    snoozed_until,
                });
            }
            return Ok(threads);
        }

        let parent_folder_id = match folder {
            "inbox" | "sentitems" | "deleteditems" => {
                format!(r#"<t:DistinguishedFolderId Id="{}"/>"#, folder)
            }
            "spam" => format!(r#"<t:DistinguishedFolderId Id="junkemail"/>"#),
            "snoozed" => {
                let real_id = self.find_or_create_snoozed_folder().await?;
                format!(r#"<t:FolderId Id="{}"/>"#, real_id)
            }
            id => format!(r#"<t:FolderId Id="{}"/>"#, id),
        };

        let soap_body = format!(
            r#"<m:FindConversation>
  <m:IndexedPageItemView MaxEntriesReturned="{count}" Offset="{offset}" BasePoint="Beginning"/>
  <m:SortOrder>
    <t:FieldOrder Order="Descending">
      <t:FieldURI FieldURI="conversation:LastDeliveryTime"/>
    </t:FieldOrder>
  </m:SortOrder>
  <m:ParentFolderId>
    {parent_folder_id}
  </m:ParentFolderId>
  <m:ConversationShape>
    <t:BaseShape>IdOnly</t:BaseShape>
    <t:AdditionalProperties>
      <t:FieldURI FieldURI="conversation:ConversationTopic"/>
      <t:FieldURI FieldURI="conversation:LastDeliveryTime"/>
      <t:FieldURI FieldURI="conversation:GlobalMessageCount"/>
      <t:FieldURI FieldURI="conversation:GlobalUnreadCount"/>
      <t:FieldURI FieldURI="conversation:GlobalHasAttachments"/>
      <t:FieldURI FieldURI="conversation:UniqueUnreadSenders"/>
      <t:FieldURI FieldURI="conversation:GlobalUniqueSenders"/>
      <t:FieldURI FieldURI="conversation:GlobalUniqueRecipients"/>
    </t:AdditionalProperties>
  </m:ConversationShape>
</m:FindConversation>"#,
            offset = self.list_offset,
        );

        let xml = send(access_token, &soap_body).await?;

        if xml.contains("ResponseClass=\"Error\"") {
            return Err(ews_err(&xml, "EWS error listing threads"));
        }

        let mut threads = Vec::new();
        for conv_xml in xml_all_ns(&xml, "t:Conversation") {
            let conv_id_elem = conv_xml
                .find("<t:ConversationId ")
                .or_else(|| conv_xml.find("<ConversationId "))
                .and_then(|s| conv_xml[s..].find("/>").map(|e| &conv_xml[s..s + e]));
            let conversation_id = match conv_id_elem.and_then(|e| xml_attr(e, "Id")) {
                Some(id) => id,
                None => continue,
            };

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
            let has_attachments = xml_content_ns(&conv_xml, "t:GlobalHasAttachments")
                .or_else(|| xml_content_ns(&conv_xml, "t:HasAttachments"))
                .map(|v| v == "true")
                .unwrap_or(false);

            let from_name = xml_content_ns(&conv_xml, "t:UniqueUnreadSenders")
                .as_deref()
                .and_then(|s| xml_content_ns(s, "t:String"))
                .filter(|s| !s.is_empty())
                .or_else(|| {
                    xml_content_ns(&conv_xml, "t:GlobalUniqueSenders")
                        .as_deref()
                        .and_then(|s| xml_content_ns(s, "t:String"))
                        .filter(|s| !s.is_empty())
                })
                .or_else(|| {
                    xml_content_ns(&conv_xml, "t:UniqueSenders")
                        .as_deref()
                        .and_then(|s| xml_content_ns(s, "t:String"))
                        .filter(|s| !s.is_empty())
                });

            let to_recipients: Vec<MailRecipient> = {
                let recipients_xml = xml_content_ns(&conv_xml, "t:GlobalUniqueRecipients")
                    .or_else(|| xml_content_ns(&conv_xml, "t:UniqueRecipients"))
                    .unwrap_or_default();
                // xml_all_ns returns full elements like "<String>value</String>" — extract inner text
                xml_all_ns(&recipients_xml, "t:String")
                    .into_iter()
                    .filter_map(|elem| {
                        let value = xml_content_ns(&elem, "t:String").filter(|s| !s.is_empty())?;
                        // EWS returns display names (not SMTP addresses) here
                        if value.contains('@') {
                            Some(MailRecipient {
                                name: None,
                                email: value,
                            })
                        } else {
                            Some(MailRecipient {
                                name: Some(value.clone()),
                                email: value,
                            })
                        }
                    })
                    .collect()
            };

            let unique_senders: Vec<MailRecipient> = {
                let senders_xml = xml_content_ns(&conv_xml, "t:GlobalUniqueSenders")
                    .or_else(|| xml_content_ns(&conv_xml, "t:UniqueSenders"))
                    .unwrap_or_default();
                let own = self.user_email.as_deref().unwrap_or("").to_lowercase();
                xml_all_ns(&senders_xml, "t:String")
                    .into_iter()
                    .filter_map(|elem| {
                        let value = xml_content_ns(&elem, "t:String").filter(|s| !s.is_empty())?;
                        // Exclude own email (case-insensitive)
                        if !own.is_empty() && value.to_lowercase() == own {
                            return None;
                        }
                        if value.contains('@') {
                            Some(MailRecipient {
                                name: None,
                                email: value,
                            })
                        } else {
                            Some(MailRecipient {
                                name: Some(value.clone()),
                                email: value,
                            })
                        }
                    })
                    .collect()
            };

            threads.push(MailThread {
                conversation_id,
                topic,
                snippet: String::new(),
                last_delivery_time,
                message_count,
                unread_count,
                from_name,
                from_email: None,
                has_attachments,
                to_recipients,
                cc_recipients: vec![],
                unique_senders,
                snoozed_until: None,
            });
        }

        // Use the count returned by FindConversation so the list can render
        // immediately. An exact cross-folder recount must not block this path.

        Ok(threads)
    }

    async fn search_threads(
        &self,
        query: &MailSearchQuery,
        max_count: Option<u32>,
    ) -> Result<Vec<MailThread>, String> {
        let access_token = &self.access_token;
        let thread_limit = max_count.unwrap_or(50) as usize;

        let mut aqs_parts: Vec<String> = Vec::new();
        if let Some(from) = &query.from {
            aqs_parts.push(format!("from:{}", from));
        }
        if let Some(to) = &query.to {
            aqs_parts.push(format!("to:{}", to));
        }
        if let Some(cc) = &query.cc {
            aqs_parts.push(format!("cc:{}", cc));
        }
        if let Some(bcc) = &query.bcc {
            aqs_parts.push(format!("bcc:{}", bcc));
        }
        if let Some(subj) = &query.subject {
            if subj.contains(' ') {
                aqs_parts.push(format!("subject:\"{}\"", subj));
            } else {
                aqs_parts.push(format!("subject:{}", subj));
            }
        }
        if let Some(text) = &query.text {
            aqs_parts.push(text.clone());
        }
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

        let folder_id_xmls: Vec<String> = if let Some(f) = &query.folder {
            vec![match f.as_str() {
                "inbox" | "sentitems" | "deleteditems" | "drafts" => {
                    format!(r#"<t:DistinguishedFolderId Id="{}"/>"#, f)
                }
                id => format!(r#"<t:FolderId Id="{}"/>"#, id),
            }]
        } else {
            let discovered = find_all_mail_folder_ids(access_token).await;
            eprintln!(
                "[mail_search_threads] discovered {} mail folder(s)",
                discovered.len()
            );
            if discovered.is_empty() {
                vec![
                    r#"<t:DistinguishedFolderId Id="inbox"/>"#.to_string(),
                    r#"<t:DistinguishedFolderId Id="sentitems"/>"#.to_string(),
                    r#"<t:DistinguishedFolderId Id="drafts"/>"#.to_string(),
                    r#"<t:DistinguishedFolderId Id="deleteditems"/>"#.to_string(),
                ]
            } else {
                discovered
                    .into_iter()
                    .map(|id| format!(r#"<t:FolderId Id="{}"/>"#, id))
                    .collect()
            }
        };

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
                let topic = xml_content_ns(&msg_xml, "t:Subject").unwrap_or_default();
                let date = xml_content_ns(&msg_xml, "t:DateTimeReceived").unwrap_or_default();
                let is_read = xml_content_ns(&msg_xml, "t:IsRead")
                    .map(|v| v == "true")
                    .unwrap_or(true);
                let has_attach = xml_content_ns(&msg_xml, "t:HasAttachments")
                    .map(|v| v == "true")
                    .unwrap_or(false);
                let from_name = xml_content_ns(&msg_xml, "t:From")
                    .as_deref()
                    .and_then(|f| xml_content_ns(f, "t:Name"))
                    .filter(|s| !s.is_empty());
                rows.push((conv_id, topic, date, is_read, has_attach, from_name));
            }
            rows
        }

        let handles: Vec<_> = folder_id_xmls
            .into_iter()
            .map(|folder_id_xml| {
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
                        Ok(xml) if !xml.contains("ResponseClass=\"Error\"") => {
                            search_xml_to_rows(&xml)
                        }
                        _ => vec![],
                    }
                })
            })
            .collect();

        let mut all_rows: Vec<Row> = Vec::new();
        for handle in handles {
            if let Ok(rows) = handle.await {
                all_rows.extend(rows);
            }
        }

        all_rows.sort_by(|a, b| b.2.cmp(&a.2));

        use std::collections::HashMap;
        let mut order: Vec<String> = Vec::new();
        let mut by_conv: HashMap<String, MailThread> = HashMap::new();

        for (conv_id, topic, date, is_read, has_attach, from_name) in all_rows {
            if let Some(t) = by_conv.get_mut(&conv_id) {
                t.message_count += 1;
                if !is_read {
                    t.unread_count += 1;
                }
                if has_attach {
                    t.has_attachments = true;
                }
            } else {
                order.push(conv_id.clone());
                by_conv.insert(
                    conv_id.clone(),
                    MailThread {
                        conversation_id: conv_id,
                        topic,
                        snippet: String::new(),
                        last_delivery_time: date,
                        message_count: 1,
                        unread_count: if is_read { 0 } else { 1 },
                        from_name,
                        from_email: None,
                        has_attachments: has_attach,
                        to_recipients: vec![],
                        cc_recipients: vec![],
                        unique_senders: vec![],
                        snoozed_until: None,
                    },
                );
            }
            if order.len() >= thread_limit && by_conv.len() >= thread_limit {
                break;
            }
        }

        let threads: Vec<MailThread> = order
            .into_iter()
            .filter_map(|id| by_conv.remove(&id))
            .take(thread_limit)
            .collect();

        eprintln!("[mail_search_threads] parsed {} thread(s)", threads.len());
        Ok(threads)
    }

    async fn get_thread(
        &self,
        conversation_id: &str,
        include_trash: Option<bool>,
        is_draft: Option<bool>,
        include_drafts: Option<bool>,
    ) -> Result<Vec<MailMessage>, String> {
        let access_token = &self.access_token;

        if is_draft.unwrap_or(false) {
            let soap_body = format!(
                r#"<m:GetItem>
  <m:ItemShape>
    <t:BaseShape>AllProperties</t:BaseShape>
    <t:BodyType>HTML</t:BodyType>
    <t:AdditionalProperties>
      <t:FieldURI FieldURI="message:IsRead"/>
    </t:AdditionalProperties>
  </m:ItemShape>
  <m:ItemIds>
    <t:ItemId Id="{item_id}"/>
  </m:ItemIds>
</m:GetItem>"#,
                item_id = conversation_id,
            );
            let xml = send(access_token, &soap_body).await?;
            if xml.contains("ResponseClass=\"Error\"") {
                return Err(ews_err(&xml, "EWS error getting draft"));
            }
            let mut messages = Vec::new();
            for msg_xml in xml_all_ns(&xml, "t:Message") {
                if let Some(msg) = parse_message(&msg_xml) {
                    let inline = parse_inline_images(&msg_xml);
                    let body = inject_inline_images(access_token, msg.body_html, inline).await;
                    messages.push(MailMessage {
                        body_html: body,
                        ..msg
                    });
                }
            }
            return Ok(messages);
        }

        let show_drafts = include_drafts.unwrap_or(false);
        let folders_to_ignore = if include_trash.unwrap_or(false) {
            if show_drafts {
                String::new()
            } else {
                r#"<m:FoldersToIgnore>
    <t:DistinguishedFolderId Id="drafts"/>
  </m:FoldersToIgnore>"#
                    .to_string()
            }
        } else if show_drafts {
            r#"<m:FoldersToIgnore>
    <t:DistinguishedFolderId Id="deleteditems"/>
  </m:FoldersToIgnore>"#
                .to_string()
        } else {
            r#"<m:FoldersToIgnore>
    <t:DistinguishedFolderId Id="deleteditems"/>
    <t:DistinguishedFolderId Id="drafts"/>
  </m:FoldersToIgnore>"#
                .to_string()
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

        let xml = send(access_token, &soap_body).await?;

        if xml.contains("ResponseClass=\"Error\"") {
            return Err(ews_err(&xml, "EWS error getting thread"));
        }

        eprintln!(
            "[mail] GetConversationItems response has t:Attachments: {}",
            xml.contains("t:Attachments")
        );
        eprintln!(
            "[mail] GetConversationItems response has t:IsInline: {}",
            xml.contains("t:IsInline")
        );

        const ITEM_TYPES: &[&str] = &[
            "t:Message",
            "t:MeetingRequest",
            "t:MeetingResponse",
            "t:MeetingCancellation",
        ];

        let mut pending: Vec<(MailMessage, Vec<InlineImage>)> = Vec::new();
        for node_xml in xml_all_ns(&xml, "t:ConversationNode") {
            if let Some(items_xml) = xml_content_ns(&node_xml, "t:Items") {
                for &item_type in ITEM_TYPES {
                    for msg_xml in xml_all_ns(&items_xml, item_type) {
                        if let Some(mut msg) = parse_message(&msg_xml) {
                            if item_type != "t:Message" {
                                let ics = build_meeting_ics(&msg_xml, item_type);
                                if ics.is_none() {
                                    eprintln!("[mail] build_meeting_ics returned None for {} (has t:Start={})", item_type, xml_content_ns(&msg_xml, "t:Start").is_some());
                                }
                                msg.ics_mime = ics;
                            }
                            let inline = parse_inline_images(&msg_xml);
                            pending.push((msg, inline));
                        }
                    }
                }
            }
        }

        let mut messages = Vec::new();
        for (msg, inline) in pending {
            let body = inject_inline_images(access_token, msg.body_html.clone(), inline).await;
            messages.push(MailMessage {
                body_html: body,
                ..msg
            });
        }

        messages.sort_by(|a, b| a.date_time_received.cmp(&b.date_time_received));

        Ok(messages)
    }

    async fn mark_read(&self, items: &[MailItemRef]) -> Result<(), String> {
        update_is_read(&self.access_token, items, true).await
    }

    async fn mark_unread(&self, items: &[MailItemRef]) -> Result<(), String> {
        update_is_read(&self.access_token, items, false).await
    }

    async fn move_to_trash(&self, item_id: &str) -> Result<(), String> {
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
        let xml = send(&self.access_token, &soap_body).await?;
        if xml.contains("ResponseClass=\"Error\"") {
            return Err(ews_err(&xml, "EWS move-to-trash error"));
        }
        Ok(())
    }

    async fn permanently_delete(&self, item_id: &str) -> Result<(), String> {
        let soap_body = format!(
            r#"<m:DeleteItem DeleteType="HardDelete">
  <m:ItemIds>
    <t:ItemId Id="{item_id}"/>
  </m:ItemIds>
</m:DeleteItem>"#,
        );
        let xml = send(&self.access_token, &soap_body).await?;
        if xml.contains("ResponseClass=\"Error\"") {
            return Err(ews_err(&xml, "EWS permanently-delete error"));
        }
        Ok(())
    }

    async fn bulk_move_to_trash(&self, item_ids: Vec<String>) -> Result<(), String> {
        if item_ids.is_empty() {
            return Ok(());
        }
        let items_xml: String = item_ids
            .iter()
            .map(|id| format!("    <t:ItemId Id=\"{}\"/>", id))
            .collect::<Vec<_>>()
            .join("\n");
        let soap_body = format!(
            r#"<m:MoveItem>
  <m:ToFolderId>
    <t:DistinguishedFolderId Id="deleteditems"/>
  </m:ToFolderId>
  <m:ItemIds>
{items_xml}
  </m:ItemIds>
</m:MoveItem>"#,
        );
        let xml = send(&self.access_token, &soap_body).await?;
        if xml.contains("ResponseClass=\"Error\"") {
            return Err(ews_err(&xml, "EWS bulk move-to-trash error"));
        }
        Ok(())
    }

    async fn bulk_permanently_delete(&self, item_ids: Vec<String>) -> Result<(), String> {
        if item_ids.is_empty() {
            return Ok(());
        }
        let items_xml: String = item_ids
            .iter()
            .map(|id| format!("    <t:ItemId Id=\"{}\"/>", id))
            .collect::<Vec<_>>()
            .join("\n");
        let soap_body = format!(
            r#"<m:DeleteItem DeleteType="HardDelete">
  <m:ItemIds>
{items_xml}
  </m:ItemIds>
</m:DeleteItem>"#,
        );
        let xml = send(&self.access_token, &soap_body).await?;
        if xml.contains("ResponseClass=\"Error\"") {
            return Err(ews_err(&xml, "EWS bulk permanently-delete error"));
        }
        Ok(())
    }

    async fn bulk_move_to_folder(
        &self,
        item_ids: Vec<String>,
        folder_id: &str,
    ) -> Result<(), String> {
        if item_ids.is_empty() {
            return Ok(());
        }

        // Exchange items have exactly one parent folder. Unlike Gmail/JMAP we
        // cannot add the destination while retaining Sent, so exclude items
        // whose current parent is the Sent Items folder from the move.
        let sent_folder_id = get_distinguished_folder_id(&self.access_token, "sentitems")
            .await
            .ok_or_else(|| "Unable to resolve the Exchange Sent Items folder".to_string())?;
        let item_refs: String = item_ids
            .iter()
            .map(|id| format!("    <t:ItemId Id=\"{}\"/>", id))
            .collect::<Vec<_>>()
            .join("\n");
        let inspect_body = format!(
            r#"<m:GetItem>
  <m:ItemShape>
    <t:BaseShape>IdOnly</t:BaseShape>
    <t:AdditionalProperties>
      <t:FieldURI FieldURI="item:ParentFolderId"/>
    </t:AdditionalProperties>
  </m:ItemShape>
  <m:ItemIds>
{item_refs}
  </m:ItemIds>
</m:GetItem>"#,
        );
        let inspect_xml = send(&self.access_token, &inspect_body).await?;
        if inspect_xml.contains("ResponseClass=\"Error\"") {
            return Err(ews_err(
                &inspect_xml,
                "EWS error checking Sent items before move",
            ));
        }

        const ITEM_TYPES: &[&str] = &[
            "t:Message",
            "t:MeetingRequest",
            "t:MeetingResponse",
            "t:MeetingCancellation",
        ];
        let mut movable_ids = Vec::new();
        for &item_type in ITEM_TYPES {
            for item_xml in xml_all_ns(&inspect_xml, item_type) {
                let item_id = item_xml
                    .find("<t:ItemId ")
                    .or_else(|| item_xml.find("<ItemId "))
                    .and_then(|s| item_xml[s..].find("/>").map(|e| &item_xml[s..s + e]))
                    .and_then(|elem| xml_attr(elem, "Id"));
                let parent_id = item_xml
                    .find("<t:ParentFolderId ")
                    .or_else(|| item_xml.find("<ParentFolderId "))
                    .and_then(|s| item_xml[s..].find("/>").map(|e| &item_xml[s..s + e]))
                    .and_then(|elem| xml_attr(elem, "Id"));
                if let (Some(id), Some(parent)) = (item_id, parent_id) {
                    if parent != sent_folder_id {
                        movable_ids.push(id.to_string());
                    }
                }
            }
        }
        if movable_ids.is_empty() {
            return Ok(());
        }

        let items_xml: String = movable_ids
            .iter()
            .map(|id| format!("    <t:ItemId Id=\"{}\"/>", id))
            .collect::<Vec<_>>()
            .join("\n");
        let to_folder = match folder_id {
            "inbox" | "sentitems" | "deleteditems" | "drafts" => {
                format!(r#"<t:DistinguishedFolderId Id="{}"/>"#, folder_id)
            }
            "spam" => format!(r#"<t:DistinguishedFolderId Id="junkemail"/>"#),
            id => format!(r#"<t:FolderId Id="{}"/>"#, id),
        };
        let soap_body = format!(
            r#"<m:MoveItem>
  <m:ToFolderId>
    {to_folder}
  </m:ToFolderId>
  <m:ItemIds>
{items_xml}
  </m:ItemIds>
</m:MoveItem>"#,
        );
        let xml = send(&self.access_token, &soap_body).await?;
        if xml.contains("ResponseClass=\"Error\"") {
            return Err(ews_err(&xml, "EWS bulk move-to-folder error"));
        }
        Ok(())
    }

    async fn send_mail(&self, params: SendMailParams) -> Result<(), String> {
        let access_token = &self.access_token;
        let atts = params.attachments.unwrap_or_default();
        let forward = params.is_forward.unwrap_or(false);
        let is_scheduled = params.send_at.is_some();
        let deferred_property = if let Some(send_at) = params.send_at.as_deref() {
            let date = chrono::DateTime::parse_from_rfc3339(send_at)
                .map_err(|e| format!("Invalid scheduled-send date: {e}"))?
                .with_timezone(&chrono::Utc);
            if date <= chrono::Utc::now() {
                return Err("Scheduled-send date must be in the future".to_string());
            }
            if params.reply_to_item_id.is_some() {
                return Err(
                    "EWS scheduled send is currently supported for new messages only".to_string(),
                );
            }
            format!(
                r#"<t:ExtendedProperty>
        <t:ExtendedFieldURI PropertyTag="0x3FEF" PropertyType="SystemTime"/>
        <t:Value>{}</t:Value>
      </t:ExtendedProperty>"#,
                date.to_rfc3339()
            )
        } else {
            String::new()
        };

        if atts.is_empty() {
            let soap_body = match (&params.reply_to_item_id, &params.reply_to_change_key) {
                (Some(id), Some(ck)) if forward => {
                    let (to_block, cc_block, bcc_block) =
                        build_recipients_blocks(&params.to, &params.cc, &params.bcc);
                    format!(
                        r#"<m:CreateItem MessageDisposition="SendAndSaveCopy">
  <m:Items>
    <t:ForwardItem>
      <t:ToRecipients>
        {to_block}
      </t:ToRecipients>{cc_block}{bcc_block}
      <t:ReferenceItemId Id="{id}" ChangeKey="{ck}"/>
      <t:NewBodyContent BodyType="HTML">{body}</t:NewBodyContent>
    </t:ForwardItem>
  </m:Items>
</m:CreateItem>"#,
                        body = xml_escape(&params.body_html),
                    )
                }
                (Some(id), Some(ck)) => format!(
                    r#"<m:CreateItem MessageDisposition="SendAndSaveCopy">
  <m:Items>
    <t:ReplyAllToItem>
      <t:ReferenceItemId Id="{id}" ChangeKey="{ck}"/>
      <t:NewBodyContent BodyType="HTML">{body}</t:NewBodyContent>
    </t:ReplyAllToItem>
  </m:Items>
</m:CreateItem>"#,
                    body = xml_escape(&params.body_html),
                ),
                _ => {
                    let (to_block, cc_block, bcc_block) =
                        build_recipients_blocks(&params.to, &params.cc, &params.bcc);
                    if is_scheduled {
                        format!(
                            r#"<m:CreateItem MessageDisposition="SaveOnly">
  <m:SavedItemFolderId>
    <t:DistinguishedFolderId Id="outbox"/>
  </m:SavedItemFolderId>
  <m:Items>
    <t:Message>
      <t:Subject>{subject}</t:Subject>
      {deferred_property}
      <t:Body BodyType="HTML">{body}</t:Body>
      <t:ToRecipients>
        {to_block}
      </t:ToRecipients>{cc_block}{bcc_block}
    </t:Message>
  </m:Items>
</m:CreateItem>"#,
                            subject = xml_escape(&params.subject),
                            deferred_property = deferred_property,
                            body = xml_escape(&params.body_html),
                        )
                    } else {
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
                            subject = xml_escape(&params.subject),
                            body = xml_escape(&params.body_html),
                        )
                    }
                }
            };
            let xml = send(access_token, &soap_body).await?;
            if xml.contains("ResponseClass=\"Error\"") {
                return Err(ews_err(&xml, "EWS send error"));
            }
            return Ok(());
        }

        // With attachments: 3-step flow (SaveOnly → CreateAttachment → SendItem)
        // For scheduled sends, save to outbox; for immediate sends, save to drafts.
        let create_body = {
            let (to_block, cc_block, bcc_block) =
                build_recipients_blocks(&params.to, &params.cc, &params.bcc);
            let folder = if is_scheduled { "outbox" } else { "drafts" };
            format!(
                r#"<m:CreateItem MessageDisposition="SaveOnly">
  <m:SavedItemFolderId>
    <t:DistinguishedFolderId Id="{folder}"/>
  </m:SavedItemFolderId>
  <m:Items>
    <t:Message>
      <t:Subject>{subject}</t:Subject>
      {deferred_property}
      <t:Body BodyType="HTML">{body}</t:Body>
      <t:ToRecipients>
        {to_block}
      </t:ToRecipients>{cc_block}{bcc_block}
    </t:Message>
  </m:Items>
</m:CreateItem>"#,
                subject = xml_escape(&params.subject),
                deferred_property = deferred_property,
                body = xml_escape(&params.body_html),
            )
        };

        let xml = send(access_token, &create_body).await?;
        if xml.contains("ResponseClass=\"Error\"") {
            return Err(ews_err(&xml, "EWS create-draft error"));
        }
        let (mut item_id, mut change_key) =
            parse_item_id(&xml).ok_or("EWS: no ItemId in CreateItem response")?;

        for att in &atts {
            let is_inline = att.is_inline.unwrap_or(false);
            let cid_block = if is_inline {
                att.content_id
                    .as_deref()
                    .map(|cid| {
                        format!(
                            "\n    <t:ContentId>{cid}</t:ContentId>",
                            cid = xml_escape(cid)
                        )
                    })
                    .unwrap_or_default()
            } else {
                String::new()
            };
            let att_block = format!(
                r#"<t:FileAttachment>
    <t:Name>{name}</t:Name>
    <t:ContentType>{ct}</t:ContentType>
    <t:IsInline>{inline}</t:IsInline>{cid_block}
    <t:Content>{data}</t:Content>
  </t:FileAttachment>"#,
                name = xml_escape(&att.name),
                ct = xml_escape(&att.content_type),
                inline = is_inline,
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
            let xml = send(access_token, &attach_body).await?;
            if xml.contains("ResponseClass=\"Error\"") {
                return Err(ews_err(&xml, "EWS create-attachment error"));
            }
            if let Some((new_id, new_ck)) = parse_root_item_id(&xml) {
                item_id = new_id;
                change_key = new_ck;
            }
        }

        let get_body = format!(
            r#"<m:GetItem>
  <m:ItemShape>
    <t:BaseShape>IdOnly</t:BaseShape>
  </m:ItemShape>
  <m:ItemIds>
    <t:ItemId Id="{item_id}" ChangeKey="{change_key}"/>
  </m:ItemIds>
</m:GetItem>"#,
        );
        let get_xml = send(access_token, &get_body).await?;
        if let Some((fresh_id, fresh_ck)) = parse_item_id(&get_xml) {
            item_id = fresh_id;
            change_key = fresh_ck;
        }

        // Scheduled sends are already in outbox with PR_DEFERRED_SEND_TIME set;
        // Exchange dispatches them automatically — no SendItem needed.
        if is_scheduled {
            return Ok(());
        }

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
        let xml = send(access_token, &send_body).await?;
        if xml.contains("ResponseClass=\"Error\"") {
            return Err(ews_err(&xml, "EWS send error"));
        }
        Ok(())
    }

    async fn save_draft(&self, params: SaveDraftParams) -> Result<String, String> {
        let (to_block, cc_block, bcc_block) =
            build_recipients_blocks(&params.to, &params.cc, &params.bcc);
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
            subject = xml_escape(&params.subject),
            body = xml_escape(&params.body_html),
        );
        let xml = send(&self.access_token, &soap_body).await?;
        if xml.contains("ResponseClass=\"Error\"") {
            return Err(ews_err(&xml, "EWS save draft error"));
        }
        let item_id = xml_all_ns(&xml, "t:Message")
            .into_iter()
            .find_map(|msg_xml| {
                let start = msg_xml
                    .find("<t:ItemId ")
                    .or_else(|| msg_xml.find("<ItemId "))?;
                let end = msg_xml[start..].find("/>")?;
                xml_attr(&msg_xml[start..start + end], "Id")
            })
            .unwrap_or_default();
        Ok(item_id)
    }

    async fn open_attachment(&self, attachment_id: &str, filename: &str) -> Result<(), String> {
        let b64_clean = fetch_ews_attachment_base64(&self.access_token, attachment_id).await?;
        let bytes = BASE64
            .decode(b64_clean)
            .map_err(|e| format!("Base64 decode error: {}", e))?;

        let safe_name: String = filename
            .chars()
            .map(|c| {
                if c.is_alphanumeric() || ".-_ ".contains(c) {
                    c
                } else {
                    '_'
                }
            })
            .collect();
        let path = std::env::temp_dir().join(&safe_name);
        std::fs::write(&path, &bytes).map_err(|e| format!("Write temp file: {}", e))?;

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

    async fn get_attachment_data(
        &self,
        attachment_id: &str,
        _message_id: Option<&str>,
        _folder: Option<&str>,
    ) -> Result<String, String> {
        fetch_ews_attachment_base64(&self.access_token, attachment_id).await
    }

    async fn move_to_folder(&self, item_id: &str, folder_id: &str) -> Result<(), String> {
        let to_folder = match folder_id {
            "inbox" | "sentitems" | "deleteditems" | "drafts" => {
                format!(r#"<t:DistinguishedFolderId Id="{}"/>"#, folder_id)
            }
            "spam" => format!(r#"<t:DistinguishedFolderId Id="junkemail"/>"#),
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

        let xml = send(&self.access_token, &soap_body).await?;
        if xml.contains("ResponseClass=\"Error\"") {
            return Err(ews_err(&xml, "EWS move-to-folder error"));
        }
        Ok(())
    }

    async fn find_or_create_snoozed_folder(&self) -> Result<String, String> {
        let access_token = &self.access_token;
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

        let xml = send(access_token, find_body).await?;

        let folder_id_elem = xml
            .find("<t:FolderId ")
            .or_else(|| xml.find("<FolderId "))
            .and_then(|s| xml[s..].find("/>").map(|e| &xml[s..s + e]));

        if let Some(id) = folder_id_elem.and_then(|e| xml_attr(e, "Id")) {
            return Ok(id);
        }

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

        let xml = send(access_token, create_body).await?;

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

    async fn snooze(&self, item_id: &str) -> Result<String, String> {
        let folder_id = self.find_or_create_snoozed_folder().await?;
        self.move_to_folder(item_id, &folder_id).await?;
        Ok(folder_id)
    }

    async fn list_identities(&self) -> Result<Vec<MailIdentity>, String> {
        Err("not_supported".to_string())
    }

    async fn search_contacts(
        &self,
        query: &str,
        max_count: Option<u32>,
    ) -> Result<Vec<crate::mail_provider::Contact>, String> {
        if query.trim().is_empty() {
            return Ok(vec![]);
        }
        let soap_body = format!(
            r#"<m:ResolveNames ReturnFullContactData="true" SearchScope="ContactsActiveDirectory" ContactDataShape="Default">
  <m:UnresolvedEntry>{}</m:UnresolvedEntry>
</m:ResolveNames>"#,
            xml_escape(query.trim())
        );
        let xml = send(&self.access_token, &soap_body).await?;
        if xml.contains("ResponseClass=\"Error\"") && !xml.contains("ErrorNameResolutionNoResults")
        {
            return Err(ews_err(&xml, "EWS contact search error"));
        }
        let max = max_count.unwrap_or(25).min(100) as usize;
        let mut seen = std::collections::HashSet::new();
        let contacts = xml_all_ns(&xml, "t:Resolution")
            .into_iter()
            .filter_map(|resolution| {
                let mailbox = xml_content_ns(&resolution, "t:Mailbox")?;
                let email = xml_content_ns(&mailbox, "t:EmailAddress")?;
                if email.trim().is_empty() || !seen.insert(email.to_lowercase()) {
                    return None;
                }
                let name =
                    xml_content_ns(&mailbox, "t:Name").filter(|value| !value.trim().is_empty());
                let source = xml_content_ns(&resolution, "t:ContactSource")
                    .map(|value| {
                        if value == "ActiveDirectory" {
                            "ews-directory"
                        } else {
                            "ews-contact"
                        }
                    })
                    .unwrap_or("ews-contact")
                    .to_string();
                Some(crate::mail_provider::Contact {
                    email,
                    name,
                    source: Some(source),
                })
            })
            .take(max)
            .collect();
        Ok(contacts)
    }

    async fn get_contact_photo(&self, email: &str) -> Result<Option<String>, String> {
        let email = email.trim();
        let valid_smtp_address = email.split_once('@').is_some_and(|(local, domain)| {
            !local.is_empty()
                && !domain.is_empty()
                && !domain.contains('@')
                && !email.chars().any(char::is_whitespace)
        });
        if !valid_smtp_address {
            // Conversation summaries can contain a display name, an Exchange
            // legacy identifier, or an empty value instead of an SMTP address.
            // GetUserPhoto rejects those values with ErrorInvalidSmtpAddress.
            return Ok(None);
        }

        let soap_body = format!(
            r#"<m:GetUserPhoto>
  <m:Email>{}</m:Email>
  <m:SizeRequested>HR96x96</m:SizeRequested>
</m:GetUserPhoto>"#,
            xml_escape(email)
        );
        let xml = match send(&self.access_token, &soap_body).await {
            Ok(xml) => xml,
            Err(error) if error == "ews_photo_unavailable" => return Ok(None),
            Err(error) => return Err(error),
        };
        if xml.contains("ResponseClass=\"Error\"") {
            return Ok(None);
        }
        Ok(xml_content_ns(&xml, "m:PictureData").filter(|data| !data.trim().is_empty()))
    }
}

// ── Public provider operations ────────────────────────────────────────────────

#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ContactBackfillBatch {
    observations: Vec<ContactObservation>,
    item_count: u32,
    oldest_at: Option<i64>,
}

#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
struct ContactObservation {
    email: String,
    display_name: Option<String>,
    kind: String,
    occurred_at: i64,
    event_id: String,
}

fn ews_mailboxes(xml: &str) -> Vec<(String, Option<String>)> {
    xml_all_ns(xml, "t:Mailbox")
        .into_iter()
        .filter_map(|mailbox| {
            let email = xml_content_ns(&mailbox, "t:EmailAddress")?;
            let name = xml_content_ns(&mailbox, "t:Name").filter(|value| !value.trim().is_empty());
            Some((email, name))
        })
        .collect()
}

pub async fn mail_backfill_contacts(
    access_token: String,
    folder: String,
    offset: u32,
    max_count: u32,
    user_email: String,
) -> Result<ContactBackfillBatch, String> {
    let count = max_count.clamp(1, 200);
    let parent_folder = match folder.as_str() {
        "inbox" | "sentitems" => format!(r#"<t:DistinguishedFolderId Id="{}"/>"#, folder),
        _ => format!(r#"<t:FolderId Id="{}"/>"#, xml_escape(&folder)),
    };
    let soap_body = format!(
        r#"<m:FindItem Traversal="Shallow">
  <m:ItemShape>
    <t:BaseShape>IdOnly</t:BaseShape>
    <t:AdditionalProperties>
      <t:FieldURI FieldURI="item:DateTimeReceived"/>
      <t:FieldURI FieldURI="item:DateTimeSent"/>
      <t:FieldURI FieldURI="message:InternetMessageId"/>
      <t:FieldURI FieldURI="message:From"/>
      <t:FieldURI FieldURI="message:ToRecipients"/>
      <t:FieldURI FieldURI="message:CcRecipients"/>
      <t:FieldURI FieldURI="message:BccRecipients"/>
    </t:AdditionalProperties>
  </m:ItemShape>
  <m:IndexedPageItemView MaxEntriesReturned="{count}" Offset="{offset}" BasePoint="Beginning"/>
  <m:SortOrder><t:FieldOrder Order="Descending"><t:FieldURI FieldURI="item:DateTimeReceived"/></t:FieldOrder></m:SortOrder>
  <m:ParentFolderIds>{parent_folder}</m:ParentFolderIds>
</m:FindItem>"#
    );
    let xml = send(&access_token, &soap_body).await?;
    if xml.contains("ResponseClass=\"Error\"") {
        return Err(ews_err(&xml, "EWS contact backfill error"));
    }
    let items = xml_all_ns(&xml, "t:Message");
    let item_count = items.len() as u32;
    let mut observations = Vec::new();
    let mut oldest_at: Option<i64> = None;
    for item in items {
        let occurred = xml_content_ns(&item, "t:DateTimeSent")
            .or_else(|| xml_content_ns(&item, "t:DateTimeReceived"))
            .and_then(|value| chrono::DateTime::parse_from_rfc3339(&value).ok())
            .map(|date| date.timestamp());
        let Some(occurred_at) = occurred else {
            continue;
        };
        oldest_at = Some(oldest_at.map_or(occurred_at, |current| current.min(occurred_at)));
        let event_id = xml_content_ns(&item, "t:InternetMessageId")
            .or_else(|| {
                item.find("<t:ItemId ")
                    .and_then(|start| {
                        item[start..]
                            .find("/>")
                            .map(|end| &item[start..start + end])
                    })
                    .and_then(|element| xml_attr(element, "Id"))
            })
            .unwrap_or_else(|| format!("ews:{folder}:{offset}:{occurred_at}"));
        let senders = xml_content_ns(&item, "t:From")
            .map(|value| ews_mailboxes(&value))
            .unwrap_or_default();
        let sent_by_user = folder == "sentitems"
            || senders.iter().any(|(email, _)| {
                !user_email.is_empty() && email.eq_ignore_ascii_case(&user_email)
            });
        let (kind, mailboxes) = if sent_by_user {
            let mut recipients = xml_content_ns(&item, "t:ToRecipients")
                .map(|value| ews_mailboxes(&value))
                .unwrap_or_default();
            if let Some(cc) = xml_content_ns(&item, "t:CcRecipients") {
                recipients.extend(ews_mailboxes(&cc));
            }
            if let Some(bcc) = xml_content_ns(&item, "t:BccRecipients") {
                recipients.extend(ews_mailboxes(&bcc));
            }
            ("sent", recipients)
        } else {
            ("received", senders)
        };
        for (email, display_name) in mailboxes {
            observations.push(ContactObservation {
                email,
                display_name,
                kind: kind.to_string(),
                occurred_at,
                event_id: event_id.clone(),
            });
        }
    }
    Ok(ContactBackfillBatch {
        observations,
        item_count,
        oldest_at,
    })
}

pub async fn mail_list_folders(access_token: String) -> Result<Vec<MailFolder>, String> {
    EwsProvider::new(access_token).list_folders().await
}

pub async fn mail_list_threads(
    access_token: String,
    folder: String,
    max_count: Option<u32>,
    offset: Option<u32>,
    user_email: Option<String>,
) -> Result<Vec<MailThread>, String> {
    let provider =
        EwsProvider::with_user_email_and_offset(access_token, user_email, offset.unwrap_or(0));
    provider.list_threads(&folder, max_count).await
}

pub async fn mail_get_thread_count(access_token: String, folder: String) -> Result<u32, String> {
    let parent_folder_id = match folder.as_str() {
        "inbox" | "sentitems" | "deleteditems" => {
            format!(r#"<t:DistinguishedFolderId Id="{}"/>"#, folder)
        }
        "spam" => r#"<t:DistinguishedFolderId Id="junkemail"/>"#.to_string(),
        id => format!(r#"<t:FolderId Id="{}"/>"#, xml_escape(id)),
    };
    let body = format!(
        r#"<m:FindConversation>
  <m:IndexedPageItemView MaxEntriesReturned="1" Offset="0" BasePoint="Beginning"/>
  <m:ParentFolderId>{parent_folder_id}</m:ParentFolderId>
  <m:ConversationShape><t:BaseShape>IdOnly</t:BaseShape></m:ConversationShape>
</m:FindConversation>"#
    );
    let xml = send(&access_token, &body).await?;
    if xml.contains("ResponseClass=\"Error\"") {
        return Err(ews_err(&xml, "EWS error counting conversations"));
    }
    xml_content_ns(&xml, "m:TotalConversationsInView")
        .and_then(|value| value.parse().ok())
        .ok_or_else(|| "EWS returned an invalid conversation count".to_string())
}

pub async fn mail_search_threads(
    access_token: String,
    query: MailSearchQuery,
    max_count: Option<u32>,
) -> Result<Vec<MailThread>, String> {
    EwsProvider::new(access_token)
        .search_threads(&query, max_count)
        .await
}

pub async fn mail_get_thread(
    access_token: String,
    conversation_id: String,
    include_trash: Option<bool>,
    is_draft: Option<bool>,
    include_drafts: Option<bool>,
) -> Result<Vec<MailMessage>, String> {
    EwsProvider::new(access_token)
        .get_thread(&conversation_id, include_trash, is_draft, include_drafts)
        .await
}

pub async fn mail_get_thread_headers(
    access_token: String,
    conversation_id: String,
    include_trash: Option<bool>,
    is_draft: Option<bool>,
    include_drafts: Option<bool>,
) -> Result<Vec<MailMessage>, String> {
    // Draft conversation IDs are item IDs rather than EWS ConversationIds.
    let ids_xml = if is_draft.unwrap_or(false) {
        format!("<m:GetItem><m:ItemShape>{}</m:ItemShape><m:ItemIds><t:ItemId Id=\"{}\"/></m:ItemIds></m:GetItem>", thread_header_shape(), conversation_id)
    } else {
        let ignore = if include_trash.unwrap_or(false) {
            if include_drafts.unwrap_or(false) {
                String::new()
            } else {
                "<m:FoldersToIgnore><t:DistinguishedFolderId Id=\"drafts\"/></m:FoldersToIgnore>"
                    .into()
            }
        } else if include_drafts.unwrap_or(false) {
            "<m:FoldersToIgnore><t:DistinguishedFolderId Id=\"deleteditems\"/></m:FoldersToIgnore>"
                .into()
        } else {
            "<m:FoldersToIgnore><t:DistinguishedFolderId Id=\"deleteditems\"/><t:DistinguishedFolderId Id=\"drafts\"/></m:FoldersToIgnore>".into()
        };
        format!(
            r#"<m:GetConversationItems>
  <m:ItemShape>{}</m:ItemShape>
  {ignore}<m:MaxItemsToReturn>50</m:MaxItemsToReturn><m:SortOrder>TreeOrderDescending</m:SortOrder>
  <m:Conversations><t:Conversation><t:ConversationId Id="{conversation_id}"/></t:Conversation></m:Conversations>
</m:GetConversationItems>"#,
            thread_header_shape()
        )
    };
    let xml = send(&access_token, &ids_xml).await?;
    if xml.contains("ResponseClass=\"Error\"") {
        return Err(ews_err(&xml, "EWS error getting thread headers"));
    }
    const ITEM_TYPES: &[&str] = &[
        "t:Message",
        "t:MeetingRequest",
        "t:MeetingResponse",
        "t:MeetingCancellation",
    ];
    let mut messages = Vec::new();
    let containers = if is_draft.unwrap_or(false) {
        vec![xml.clone()]
    } else {
        xml_all_ns(&xml, "t:ConversationNode")
            .into_iter()
            .filter_map(|node| xml_content_ns(&node, "t:Items"))
            .collect()
    };
    for container in containers {
        for &item_type in ITEM_TYPES {
            for msg_xml in xml_all_ns(&container, item_type) {
                if let Some(mut msg) = parse_message(&msg_xml) {
                    msg.body_html.clear();
                    msg.body_text = None;
                    messages.push(msg);
                }
            }
        }
    }
    messages.sort_by(|a, b| a.date_time_received.cmp(&b.date_time_received));
    Ok(messages)
}

pub async fn mail_get_thread_snippet(
    access_token: String,
    conversation_id: String,
) -> Result<String, String> {
    let body = format!(
        r#"<m:GetConversationItems>
  <m:ItemShape><t:BaseShape>IdOnly</t:BaseShape><t:AdditionalProperties><t:FieldURI FieldURI="item:Preview"/></t:AdditionalProperties></m:ItemShape>
  <m:FoldersToIgnore><t:DistinguishedFolderId Id="deleteditems"/><t:DistinguishedFolderId Id="drafts"/></m:FoldersToIgnore>
  <m:MaxItemsToReturn>1</m:MaxItemsToReturn><m:SortOrder>TreeOrderDescending</m:SortOrder>
  <m:Conversations><t:Conversation><t:ConversationId Id="{conversation_id}"/></t:Conversation></m:Conversations>
</m:GetConversationItems>"#
    );
    let xml = send(&access_token, &body).await?;
    if !xml.contains("ResponseClass=\"Error\"") {
        return Ok(xml_content_ns(&xml, "t:Preview").unwrap_or_default());
    }

    // Draft lists use an item id as their row identifier rather than a
    // conversation id. Keep the UI contract opaque by accepting either form.
    let item_body = format!(
        r#"<m:GetItem>
  <m:ItemShape><t:BaseShape>IdOnly</t:BaseShape><t:AdditionalProperties><t:FieldURI FieldURI="item:Preview"/></t:AdditionalProperties></m:ItemShape>
  <m:ItemIds><t:ItemId Id="{conversation_id}"/></m:ItemIds>
</m:GetItem>"#
    );
    let item_xml = send(&access_token, &item_body).await?;
    if item_xml.contains("ResponseClass=\"Error\"") {
        return Err(ews_err(&item_xml, "EWS error getting item preview"));
    }
    Ok(xml_content_ns(&item_xml, "t:Preview").unwrap_or_default())
}

fn thread_header_shape() -> &'static str {
    r#"<t:BaseShape>IdOnly</t:BaseShape><t:AdditionalProperties>
      <t:FieldURI FieldURI="item:Subject"/>
      <t:FieldURI FieldURI="item:DateTimeReceived"/>
      <t:FieldURI FieldURI="item:HasAttachments"/>
      <t:FieldURI FieldURI="message:From"/>
      <t:FieldURI FieldURI="message:ToRecipients"/>
      <t:FieldURI FieldURI="message:CcRecipients"/>
      <t:FieldURI FieldURI="message:IsRead"/>
    </t:AdditionalProperties>"#
}

pub async fn mail_get_message_content(
    access_token: String,
    item_id: String,
) -> Result<MailMessage, String> {
    let body = format!(
        r#"<m:GetItem><m:ItemShape><t:BaseShape>AllProperties</t:BaseShape><t:BodyType>HTML</t:BodyType><t:AdditionalProperties><t:FieldURI FieldURI="message:IsRead"/></t:AdditionalProperties></m:ItemShape><m:ItemIds><t:ItemId Id="{item_id}"/></m:ItemIds></m:GetItem>"#
    );
    let xml = send(&access_token, &body).await?;
    if xml.contains("ResponseClass=\"Error\"") {
        return Err(ews_err(&xml, "EWS error getting message body"));
    }
    for item_type in [
        "t:Message",
        "t:MeetingRequest",
        "t:MeetingResponse",
        "t:MeetingCancellation",
    ] {
        if let Some(msg_xml) = xml_all_ns(&xml, item_type).into_iter().next() {
            if let Some(mut msg) = parse_message(&msg_xml) {
                if item_type != "t:Message" {
                    msg.ics_mime = build_meeting_ics(&msg_xml, item_type);
                }
                let inline = parse_inline_images(&msg_xml);
                msg.body_html = inject_inline_images(&access_token, msg.body_html, inline).await;
                return Ok(msg);
            }
        }
    }
    Err("EWS message not found".into())
}

pub async fn mail_get_raw_message(access_token: String, item_id: String) -> Result<String, String> {
    let soap_body = format!(
        r#"<m:GetItem>
  <m:ItemShape>
    <t:BaseShape>IdOnly</t:BaseShape>
    <t:IncludeMimeContent>true</t:IncludeMimeContent>
  </m:ItemShape>
  <m:ItemIds><t:ItemId Id="{item_id}"/></m:ItemIds>
</m:GetItem>"#,
    );
    let xml = send(&access_token, &soap_body).await?;
    if xml.contains("ResponseClass=\"Error\"") {
        return Err(ews_err(&xml, "EWS error getting original message"));
    }
    let encoded = xml_content_ns(&xml, "t:MimeContent")
        .ok_or_else(|| "EWS did not return MIME content".to_string())?;
    let compact: String = encoded.chars().filter(|c| !c.is_whitespace()).collect();
    let bytes = BASE64
        .decode(compact.as_bytes())
        .map_err(|e| format!("Invalid MIME base64: {e}"))?;
    String::from_utf8(bytes).map_err(|e| format!("Original message is not valid UTF-8: {e}"))
}

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
    is_forward: Option<bool>,
    send_at: Option<String>,
) -> Result<(), String> {
    EwsProvider::new(access_token)
        .send_mail(SendMailParams {
            to,
            cc,
            bcc,
            subject,
            body_html,
            reply_to_item_id,
            reply_to_change_key,
            attachments,
            is_forward,
            identity_id: None,
            in_reply_to: None,
            references: None,
            send_at,
        })
        .await
}

pub async fn mail_save_draft(
    access_token: String,
    to: Vec<String>,
    cc: Vec<String>,
    bcc: Vec<String>,
    subject: String,
    body_html: String,
) -> Result<String, String> {
    EwsProvider::new(access_token)
        .save_draft(SaveDraftParams {
            to,
            cc,
            bcc,
            subject,
            body_html,
        })
        .await
}

pub async fn mail_mark_read(access_token: String, items: Vec<MailItemRef>) -> Result<(), String> {
    EwsProvider::new(access_token).mark_read(&items).await
}

pub async fn mail_mark_unread(access_token: String, items: Vec<MailItemRef>) -> Result<(), String> {
    EwsProvider::new(access_token).mark_unread(&items).await
}

pub async fn mail_move_to_trash(access_token: String, item_id: String) -> Result<(), String> {
    EwsProvider::new(access_token).move_to_trash(&item_id).await
}

pub async fn mail_bulk_move_to_trash(
    access_token: String,
    item_ids: Vec<String>,
) -> Result<(), String> {
    EwsProvider::new(access_token)
        .bulk_move_to_trash(item_ids)
        .await
}

pub async fn mail_bulk_permanently_delete(
    access_token: String,
    item_ids: Vec<String>,
) -> Result<(), String> {
    EwsProvider::new(access_token)
        .bulk_permanently_delete(item_ids)
        .await
}

pub async fn mail_bulk_move_to_folder(
    access_token: String,
    item_ids: Vec<String>,
    folder_id: String,
) -> Result<(), String> {
    EwsProvider::new(access_token)
        .bulk_move_to_folder(item_ids, &folder_id)
        .await
}

pub async fn mail_permanently_delete(access_token: String, item_id: String) -> Result<(), String> {
    EwsProvider::new(access_token)
        .permanently_delete(&item_id)
        .await
}

pub async fn mail_open_attachment(
    access_token: String,
    attachment_id: String,
    filename: String,
) -> Result<(), String> {
    EwsProvider::new(access_token)
        .open_attachment(&attachment_id, &filename)
        .await
}

pub async fn mail_get_attachment_data(
    access_token: String,
    attachment_id: String,
) -> Result<String, String> {
    EwsProvider::new(access_token)
        .get_attachment_data(&attachment_id, None, None)
        .await
}

pub async fn mail_get_inbox_unread(access_token: String) -> Result<u32, String> {
    EwsProvider::new(access_token).get_inbox_unread().await
}

pub async fn mail_find_or_create_snoozed_folder(access_token: String) -> Result<String, String> {
    EwsProvider::new(access_token)
        .find_or_create_snoozed_folder()
        .await
}

pub async fn mail_move_to_folder(
    access_token: String,
    item_id: String,
    folder_id: String,
) -> Result<(), String> {
    EwsProvider::new(access_token)
        .move_to_folder(&item_id, &folder_id)
        .await
}

pub async fn mail_snooze(access_token: String, item_id: String) -> Result<String, String> {
    EwsProvider::new(access_token).snooze(&item_id).await
}

pub async fn mail_search_contacts(
    access_token: String,
    query: String,
    max_count: Option<u32>,
) -> Result<Vec<crate::mail_provider::Contact>, String> {
    EwsProvider::new(access_token)
        .search_contacts(&query, max_count)
        .await
}

pub async fn mail_get_contact_photo(
    access_token: String,
    email: String,
) -> Result<Option<String>, String> {
    EwsProvider::new(access_token)
        .get_contact_photo(&email)
        .await
}

// ── Private parsing helpers ───────────────────────────────────────────────────

fn parse_message(msg_xml: &str) -> Option<MailMessage> {
    let item_id_elem = msg_xml
        .find("<t:ItemId ")
        .or_else(|| msg_xml.find("<ItemId "))
        .and_then(|s| msg_xml[s..].find("/>").map(|e| &msg_xml[s..s + e]));
    let item_id = item_id_elem.and_then(|e| xml_attr(e, "Id"))?;
    let change_key = item_id_elem
        .and_then(|e| xml_attr(e, "ChangeKey"))
        .unwrap_or_default();

    let subject = xml_content_ns(msg_xml, "t:Subject").unwrap_or_default();
    let date_time_received = xml_content_ns(msg_xml, "t:DateTimeReceived").unwrap_or_default();
    let is_read = xml_content_ns(msg_xml, "t:IsRead")
        .map(|v| v == "true")
        .unwrap_or(false);
    let has_attachments = xml_content_ns(msg_xml, "t:HasAttachments")
        .map(|v| v == "true")
        .unwrap_or(false);

    let from_xml =
        xml_content_ns(msg_xml, "t:From").or_else(|| xml_content_ns(msg_xml, "t:Sender"));
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

    let body_html = xml_content_ns(msg_xml, "t:Body")
        .map(|raw| xml_unescape_body(&raw))
        .unwrap_or_default();

    let attachments = parse_attachments(msg_xml);

    let body_text = strip_html_tags(&body_html);
    let body_text = if body_text.trim().is_empty() {
        None
    } else {
        Some(body_text)
    };
    let ics_mime: Option<String> = None;

    let is_draft = xml_content_ns(msg_xml, "t:IsDraft")
        .map(|v| v == "true")
        .filter(|&v| v);

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
        is_draft,
        body_text,
        message_id: None,
        references: None,
    })
}

fn strip_html_tags(html: &str) -> String {
    let lower = html.to_lowercase();
    let mut buf = String::with_capacity(html.len() / 2);
    let mut pos = 0;
    loop {
        let style = lower[pos..].find("<style").map(|p| (pos + p, "</style>"));
        let script = lower[pos..].find("<script").map(|p| (pos + p, "</script>"));
        let next = match (style, script) {
            (None, None) => {
                buf.push_str(&html[pos..]);
                break;
            }
            (Some(a), None) => a,
            (None, Some(b)) => b,
            (Some(a), Some(b)) => {
                if a.0 <= b.0 {
                    a
                } else {
                    b
                }
            }
        };
        let (start, end_tag) = next;
        buf.push_str(&html[pos..start]);
        pos = lower[start..]
            .find(end_tag)
            .map(|rel| start + rel + end_tag.len())
            .unwrap_or(html.len());
    }
    let mut out = String::with_capacity(buf.len());
    let mut in_tag = false;
    for c in buf.chars() {
        if c == '<' {
            in_tag = true;
        } else if c == '>' {
            in_tag = false;
        } else if !in_tag {
            out.push(c);
        }
    }
    out
}

fn parse_attachments(msg_xml: &str) -> Vec<MailAttachment> {
    let mut attachments = Vec::new();
    let att_list = xml_content_ns(msg_xml, "t:Attachments").unwrap_or_default();

    for att_xml in xml_all_ns(&att_list, "t:FileAttachment") {
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

struct InlineImage {
    attachment_id: String,
    content_id: Option<String>,
    content_type: String,
}

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
        let content_type =
            xml_content_ns(&att_xml, "t:ContentType").unwrap_or_else(|| "image/png".to_string());

        images.push(InlineImage {
            attachment_id,
            content_id,
            content_type,
        });
    }

    images
}

async fn inject_inline_images(
    access_token: &str,
    body_html: String,
    inline_images: Vec<InlineImage>,
) -> String {
    if inline_images.is_empty() {
        eprintln!("[mail] inject_inline_images: no inline attachments found in EWS response");
        return body_html;
    }

    let mut fetch_results: Vec<(InlineImage, Result<String, String>)> = Vec::new();
    for img in inline_images {
        let data = fetch_ews_attachment_base64(access_token, &img.attachment_id).await;
        if let Err(ref e) = data {
            eprintln!("[mail] fetch failed: {}", e);
        }
        fetch_results.push((img, data));
    }

    let mut html = body_html;
    let mut unmatched: Vec<(String, String)> = Vec::new();

    for (img, result) in fetch_results {
        let base64_data = match result {
            Ok(d) => d,
            Err(_) => continue,
        };
        let data_uri = format!("data:{};base64,{}", img.content_type, base64_data);

        let mut replaced = false;
        if let Some(cid) = &img.content_id {
            let cid_ref = format!("src=\"cid:{}\"", cid);
            let new = html.replace(&cid_ref, &format!("src=\"{}\"", data_uri));
            if new != html {
                html = new;
                replaced = true;
            }
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

    for (ct, data) in unmatched {
        let data_uri = format!("data:{};base64,{}", ct, data);
        html = replace_next_empty_src(&html, &data_uri);
    }

    html
}

fn replace_next_empty_src(html: &str, data_uri: &str) -> String {
    if let Some(pos) = html.find("src=\"\"") {
        return format!("{}src=\"{}\"{}", &html[..pos], data_uri, &html[pos + 6..]);
    }
    if let Some(pos) = html.find("src=''") {
        return format!("{}src='{}'{}", &html[..pos], data_uri, &html[pos + 6..]);
    }
    let needle = "src";
    let mut search = 0;
    while let Some(rel) = html[search..].find(needle) {
        let abs = search + rel;
        let after = abs + needle.len();
        let preceded_ok = abs == 0
            || !html[..abs].ends_with(|c: char| c.is_ascii_alphanumeric() || c == '_' || c == '-');
        let next_non_ws = html[after..]
            .trim_start_matches(|c: char| c == ' ' || c == '\t' || c == '\r' || c == '\n');
        let followed_ok = !next_non_ws.starts_with('=');
        if preceded_ok && followed_ok {
            return format!("{}src=\"{}\"{}", &html[..abs], data_uri, &html[after..]);
        }
        search = abs + 1;
    }
    html.to_string()
}

fn parse_recipients(msg_xml: &str, tag: &str) -> Vec<MailRecipient> {
    let mut recipients = Vec::new();
    if let Some(list_xml) = xml_content_ns(msg_xml, tag) {
        for mailbox_xml in xml_all_ns(&list_xml, "t:Mailbox") {
            let email = xml_content_ns(&mailbox_xml, "t:EmailAddress").unwrap_or_default();
            let name = xml_content_ns(&mailbox_xml, "t:Name").filter(|s| !s.is_empty());
            recipients.push(MailRecipient { name, email });
        }
    }
    recipients
}

// ── ICS / meeting helpers ─────────────────────────────────────────────────────

fn build_meeting_ics(msg_xml: &str, item_type: &str) -> Option<String> {
    let start_str = xml_content_ns(msg_xml, "t:Start")?;
    let end_str = xml_content_ns(msg_xml, "t:End")?;

    let summary = xml_content_ns(msg_xml, "t:Subject").unwrap_or_default();
    let is_all_day = xml_content_ns(msg_xml, "t:IsAllDayEvent")
        .map(|v| v == "true")
        .unwrap_or(false);
    let location = xml_content_ns(msg_xml, "t:Location");

    let uid = {
        let id_elem = msg_xml
            .find("<t:ItemId ")
            .and_then(|s| msg_xml[s..].find("/>").map(|e| &msg_xml[s..s + e]));
        id_elem
            .and_then(|e| xml_attr(e, "Id"))
            .unwrap_or_else(|| "unknown".to_string())
    };

    let method = match item_type {
        "t:MeetingCancellation" => "CANCEL",
        "t:MeetingResponse" => "REPLY",
        _ => "REQUEST",
    };

    let fmt_ics_dt = |s: &str| -> String { s.chars().filter(|&c| c != '-' && c != ':').collect() };

    let (dtstart, dtend) = if is_all_day {
        let ds = start_str.get(..10).unwrap_or(&start_str).replace('-', "");
        let de = end_str.get(..10).unwrap_or(&end_str).replace('-', "");
        (
            format!("DTSTART;VALUE=DATE:{}", ds),
            format!("DTEND;VALUE=DATE:{}", de),
        )
    } else {
        (
            format!("DTSTART:{}", fmt_ics_dt(&start_str)),
            format!("DTEND:{}", fmt_ics_dt(&end_str)),
        )
    };

    let org_mb =
        xml_content_ns(msg_xml, "t:Organizer").and_then(|o| xml_content_ns(&o, "t:Mailbox"));
    let org_email = org_mb
        .as_deref()
        .and_then(|m| xml_content_ns(m, "t:EmailAddress"))
        .unwrap_or_default()
        .to_lowercase();
    let org_name = org_mb
        .as_deref()
        .and_then(|m| xml_content_ns(m, "t:Name"))
        .filter(|s| !s.is_empty())
        .unwrap_or_else(|| org_email.clone());

    let mut lines = vec![
        "BEGIN:VCALENDAR".to_string(),
        "VERSION:2.0".to_string(),
        "PRODID:-//Courrier//EN".to_string(),
        format!("METHOD:{}", method),
        "BEGIN:VEVENT".to_string(),
        format!("UID:{}", ics_escape_value(&uid)),
        format!("SUMMARY:{}", ics_escape_value(&summary)),
        dtstart,
        dtend,
    ];
    if !org_email.is_empty() {
        lines.push(format!(
            "ORGANIZER;CN={}:mailto:{}",
            ics_escape_value(&org_name),
            org_email
        ));
    }
    if let Some(loc) = location.filter(|s| !s.is_empty()) {
        lines.push(format!("LOCATION:{}", ics_escape_value(&loc)));
    }

    for list_tag in &["t:RequiredAttendees", "t:OptionalAttendees"] {
        let role = if *list_tag == "t:RequiredAttendees" {
            "REQ-PARTICIPANT"
        } else {
            "OPT-PARTICIPANT"
        };
        if let Some(list_xml) = xml_content_ns(msg_xml, list_tag) {
            for att_xml in xml_all_ns(&list_xml, "t:Attendee") {
                let email = xml_content_ns(&att_xml, "t:EmailAddress")
                    .unwrap_or_default()
                    .to_lowercase();
                if email.is_empty() {
                    continue;
                }
                let name = xml_content_ns(&att_xml, "t:Name")
                    .filter(|s| !s.is_empty())
                    .unwrap_or_else(|| email.clone());
                let partstat = xml_content_ns(&att_xml, "t:ResponseType")
                    .as_deref()
                    .map(ews_response_type_to_partstat)
                    .unwrap_or("NEEDS-ACTION");
                lines.push(format!(
                    "ATTENDEE;CN={};ROLE={};PARTSTAT={}:mailto:{}",
                    ics_escape_value(&name),
                    role,
                    partstat,
                    email,
                ));
            }
        }
    }

    lines.push("END:VEVENT".to_string());
    lines.push("END:VCALENDAR".to_string());
    Some(lines.join("\r\n"))
}

fn ews_response_type_to_partstat(rt: &str) -> &'static str {
    match rt {
        "Accept" | "Organizer" => "ACCEPTED",
        "Decline" => "DECLINED",
        "Tentative" => "TENTATIVE",
        _ => "NEEDS-ACTION",
    }
}

fn ics_escape_value(s: &str) -> String {
    s.replace('\\', "\\\\")
        .replace(';', "\\;")
        .replace(',', "\\,")
        .replace('\n', "\\n")
        .replace('\r', "")
}

fn xml_escape(s: &str) -> String {
    s.replace('&', "&amp;")
        .replace('<', "&lt;")
        .replace('>', "&gt;")
        .replace('"', "&quot;")
        .replace('\'', "&apos;")
}

fn xml_unescape_body(raw: &str) -> String {
    let inner = {
        let trimmed = raw.trim();
        if trimmed.starts_with("<![CDATA[") && trimmed.ends_with("]]>") {
            &trimmed[9..trimmed.len() - 3]
        } else {
            trimmed
        }
    };

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
        .replace("&amp;", "&")
}
