use serde::{Deserialize, Serialize};

// ── Canonical shared types ─────────────────────────────────────────────────────

#[derive(Serialize, Debug, Clone)]
pub struct MailThread {
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
    /// ICS text extracted from a calendar MIME part (EWS meeting requests).
    #[serde(skip_serializing_if = "Option::is_none")]
    pub ics_mime: Option<String>,
    /// True when the message is a draft (EWS only).
    #[serde(skip_serializing_if = "Option::is_none")]
    pub is_draft: Option<bool>,
    /// Plain-text body for quote-marker detection.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub body_text: Option<String>,
    /// RFC 5322 Message-ID (JMAP only, used for threading).
    #[serde(skip_serializing_if = "Option::is_none")]
    pub message_id: Option<String>,
    /// RFC 5322 References header (JMAP only, used for threading).
    #[serde(skip_serializing_if = "Option::is_none")]
    pub references: Option<String>,
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

/// Minimal item reference used by mark-read / mark-unread / move commands.
/// `folder` is never sent from TypeScript — it is set by the Rust IMAP adapter
/// before calling the provider, since IMAP requires a folder context.
#[derive(Deserialize, Debug)]
pub struct MailItemRef {
    pub item_id: String,
    pub change_key: String,
    pub conversation_id: Option<String>,
    #[serde(skip)]
    pub folder: Option<String>,
}

/// A file attachment supplied by the frontend composer (base64-encoded content).
#[derive(Deserialize, Debug)]
#[serde(rename_all = "camelCase")]
pub struct ComposerAttachment {
    pub name: String,
    pub content_type: String,
    pub data: String,
    pub is_inline: Option<bool>,
    pub content_id: Option<String>,
}

/// Structured search query forwarded from the TypeScript provider.
#[derive(Deserialize, Debug)]
pub struct MailSearchQuery {
    pub from: Option<String>,
    pub to: Option<String>,
    pub cc: Option<String>,
    pub bcc: Option<String>,
    pub subject: Option<String>,
    /// Free-text search in body/subject.
    pub text: Option<String>,
    /// Well-known folder key or arbitrary provider folder ID.
    pub folder: Option<String>,
    /// 'today', 'yesterday', or 'YYYY-MM-DD'.
    pub date: Option<String>,
}

#[derive(Serialize, Debug, Clone)]
pub struct MailIdentity {
    pub id: String,
    pub name: String,
    pub email: String,
    pub may_delete: bool,
}

pub struct SendMailParams {
    pub to: Vec<String>,
    pub cc: Vec<String>,
    pub bcc: Vec<String>,
    pub subject: String,
    pub body_html: String,
    /// Item to reply to or forward (EWS only).
    pub reply_to_item_id: Option<String>,
    pub reply_to_change_key: Option<String>,
    pub attachments: Option<Vec<ComposerAttachment>>,
    pub is_forward: Option<bool>,
    /// Sending identity (JMAP only).
    pub identity_id: Option<String>,
    /// RFC 5322 In-Reply-To value (JMAP only).
    pub in_reply_to: Option<String>,
    /// RFC 5322 References chain (JMAP only).
    pub references: Option<String>,
}

pub struct SaveDraftParams {
    pub to: Vec<String>,
    pub cc: Vec<String>,
    pub bcc: Vec<String>,
    pub subject: String,
    pub body_html: String,
}

// ── Trait ─────────────────────────────────────────────────────────────────────

/// Contract that every mail backend must satisfy.
/// Add a new provider by creating a struct and implementing this trait.
/// Methods with default bodies return `Err("not_supported")` — override only what
/// the backend actually supports.
pub trait MailProvider {
    // ── Required ──────────────────────────────────────────────────────────────

    async fn list_folders(&self) -> Result<Vec<MailFolder>, String>;
    async fn get_inbox_unread(&self) -> Result<u32, String>;
    async fn list_threads(&self, folder: &str, max_count: Option<u32>) -> Result<Vec<MailThread>, String>;
    async fn get_thread(
        &self,
        conversation_id: &str,
        include_trash: Option<bool>,
        is_draft: Option<bool>,
        include_drafts: Option<bool>,
    ) -> Result<Vec<MailMessage>, String>;
    async fn mark_read(&self, items: &[MailItemRef]) -> Result<(), String>;
    async fn mark_unread(&self, items: &[MailItemRef]) -> Result<(), String>;
    async fn move_to_trash(&self, item_id: &str) -> Result<(), String>;
    async fn permanently_delete(&self, item_id: &str) -> Result<(), String>;
    async fn bulk_move_to_trash(&self, item_ids: Vec<String>) -> Result<(), String>;
    async fn bulk_permanently_delete(&self, item_ids: Vec<String>) -> Result<(), String>;
    async fn send_mail(&self, params: SendMailParams) -> Result<(), String>;
    /// `message_id` and `folder` are only used by IMAP (which needs both to locate
    /// the body section). EWS and JMAP pass `None` for these.
    async fn get_attachment_data(
        &self,
        attachment_id: &str,
        message_id: Option<&str>,
        folder: Option<&str>,
    ) -> Result<String, String>;

    // ── Optional (default: not_supported) ─────────────────────────────────────

    async fn search_threads(&self, _query: &MailSearchQuery, _max_count: Option<u32>) -> Result<Vec<MailThread>, String> {
        Err("not_supported".to_string())
    }
    async fn save_draft(&self, _params: SaveDraftParams) -> Result<String, String> {
        Err("not_supported".to_string())
    }
    async fn open_attachment(&self, _attachment_id: &str, _filename: &str) -> Result<(), String> {
        Err("not_supported".to_string())
    }
    async fn move_to_folder(&self, _item_id: &str, _folder_id: &str) -> Result<(), String> {
        Err("not_supported".to_string())
    }
    async fn bulk_move_to_folder(&self, _item_ids: Vec<String>, _folder_id: &str) -> Result<(), String> {
        Err("not_supported".to_string())
    }
    async fn find_or_create_snoozed_folder(&self) -> Result<String, String> {
        Err("not_supported".to_string())
    }
    async fn snooze(&self, _item_id: &str) -> Result<String, String> {
        Err("not_supported".to_string())
    }
    async fn list_identities(&self) -> Result<Vec<MailIdentity>, String> {
        Err("not_supported".to_string())
    }
}
