use serde::de::DeserializeOwned;
use serde::Deserialize;
use serde_json::Value;
use std::sync::{Arc, OnceLock};

pub type CommandResult = Result<Value, CommandError>;

#[derive(Debug)]
pub struct CommandError {
    pub code: &'static str,
    pub detail: String,
}

fn args<T: DeserializeOwned>(value: Value) -> Result<T, CommandError> {
    serde_json::from_value(value).map_err(|error| CommandError {
        code: "invalid_arguments",
        detail: error.to_string(),
    })
}
fn output<T: serde::Serialize>(value: Result<T, String>) -> CommandResult {
    value
        .map(|item| serde_json::to_value(item).unwrap_or(Value::Null))
        .map_err(|detail| CommandError {
            code: "provider_request_failed",
            detail,
        })
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct ImapBase {
    config: crate::imap::ImapConfig,
}
#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct ImapFolder {
    config: crate::imap::ImapConfig,
    folder: String,
}
#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct ImapList {
    config: crate::imap::ImapConfig,
    folder: String,
    max_count: Option<u32>,
    offset: Option<u32>,
}
#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct ImapThread {
    config: crate::imap::ImapConfig,
    folder: String,
    conversation_id: String,
}
#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct ImapMessage {
    config: crate::imap::ImapConfig,
    folder: String,
    message_id: String,
}
#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct ImapIds {
    config: crate::imap::ImapConfig,
    folder: String,
    ids: Vec<String>,
}
#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct ImapId {
    config: crate::imap::ImapConfig,
    folder: String,
    id: String,
}
#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct ImapAttachment {
    config: crate::imap::ImapConfig,
    folder: String,
    message_id: String,
    attachment_id: String,
}
#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct ImapSend {
    config: crate::imap::ImapConfig,
    to: Vec<String>,
    cc: Vec<String>,
    bcc: Vec<String>,
    subject: String,
    body_html: String,
    attachments: Option<Vec<crate::mail_provider::ComposerAttachment>>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct Token {
    access_token: String,
}
#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct TokenFolder {
    access_token: String,
    folder: String,
}
#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct EwsList {
    access_token: String,
    folder: String,
    max_count: Option<u32>,
    offset: Option<u32>,
    user_email: Option<String>,
}
#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct EwsConversation {
    access_token: String,
    conversation_id: String,
}
#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct EwsHeaders {
    access_token: String,
    conversation_id: String,
    include_trash: Option<bool>,
    is_draft: Option<bool>,
    include_drafts: Option<bool>,
}
#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct EwsItem {
    access_token: String,
    item_id: String,
}
#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct EwsSnooze {
    access_token: String,
    item_id: String,
    until: String,
}
#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct EwsItems {
    access_token: String,
    items: Vec<crate::mail_provider::MailItemRef>,
}
#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct EwsItemIds {
    access_token: String,
    item_ids: Vec<String>,
}
#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct EwsMove {
    access_token: String,
    item_id: String,
    folder_id: String,
}
#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct EwsImport {
    access_token: String,
    raw_message: String,
    folder_id: String,
}
#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct EwsBulkMove {
    access_token: String,
    item_ids: Vec<String>,
    folder_id: String,
}
#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct EwsAttachment {
    access_token: String,
    attachment_id: String,
}
#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct EwsContact {
    access_token: String,
    query: String,
    max_count: Option<u32>,
}
#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct EwsPhoto {
    access_token: String,
    email: String,
}
#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct EwsSearch {
    access_token: String,
    query: crate::mail_provider::MailSearchQuery,
    max_count: Option<u32>,
}
#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct EwsSend {
    access_token: String,
    to: Vec<String>,
    cc: Vec<String>,
    bcc: Vec<String>,
    subject: String,
    body_html: String,
    reply_to_item_id: Option<String>,
    reply_to_change_key: Option<String>,
    attachments: Option<Vec<crate::mail_provider::ComposerAttachment>>,
    is_forward: Option<bool>,
    send_at: Option<String>,
}
#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct EwsDraft {
    access_token: String,
    to: Vec<String>,
    cc: Vec<String>,
    bcc: Vec<String>,
    subject: String,
    body_html: String,
}
#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct EwsBackfill {
    access_token: String,
    folder: String,
    offset: u32,
    max_count: u32,
    user_email: String,
}
#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct JmapBase {
    config: crate::jmap::JmapConfig,
}
#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct JmapFolder {
    config: crate::jmap::JmapConfig,
    folder: String,
}
#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct JmapList {
    config: crate::jmap::JmapConfig,
    folder: String,
    max_count: Option<u32>,
    offset: Option<u32>,
}
#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct JmapConversation {
    config: crate::jmap::JmapConfig,
    conversation_id: String,
}
#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct JmapMessage {
    config: crate::jmap::JmapConfig,
    message_id: String,
    conversation_id: Option<String>,
}
#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct JmapItem {
    config: crate::jmap::JmapConfig,
    id: String,
}
#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct JmapRawItem {
    config: crate::jmap::JmapConfig,
    item_id: String,
}
#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct JmapImport {
    config: crate::jmap::JmapConfig,
    raw_message: String,
    folder_id: String,
}
#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct JmapIds {
    config: crate::jmap::JmapConfig,
    ids: Vec<String>,
}
#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct JmapThreads {
    config: crate::jmap::JmapConfig,
    thread_ids: Vec<String>,
}
#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct JmapMove {
    config: crate::jmap::JmapConfig,
    id: String,
    folder_id: String,
}
#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct JmapBulkMove {
    config: crate::jmap::JmapConfig,
    thread_ids: Vec<String>,
    folder_id: String,
}
#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct JmapBlob {
    config: crate::jmap::JmapConfig,
    blob_id: String,
}
#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct JmapSnooze {
    config: crate::jmap::JmapConfig,
    id: String,
    until: Option<String>,
}
#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct JmapScheduled {
    config: crate::jmap::JmapConfig,
    email_id: String,
}
#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct JmapSubmission {
    config: crate::jmap::JmapConfig,
    submission_id: String,
}
#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct JmapSearch {
    config: crate::jmap::JmapConfig,
    query: crate::mail_provider::MailSearchQuery,
    max_count: Option<u32>,
}
#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct JmapSend {
    config: crate::jmap::JmapConfig,
    to: Vec<String>,
    cc: Vec<String>,
    bcc: Vec<String>,
    subject: String,
    body_html: String,
    attachments: Option<Vec<crate::mail_provider::ComposerAttachment>>,
    identity_id: Option<String>,
    in_reply_to: Option<String>,
    references: Option<String>,
    send_at: Option<String>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct ExchangeDeviceToken {
    device_code: String,
}
#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct ExchangeRefresh {
    refresh_token: String,
}
#[derive(Deserialize)]
struct GoogleRefresh {
    refresh_token: String,
    client_id: Option<String>,
    client_secret: Option<String>,
}
#[derive(Deserialize)]
struct GoogleCodeExchange {
    code: String,
    client_id: String,
    client_secret: Option<String>,
    redirect_uri: Option<String>,
    code_verifier: Option<String>,
}
#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct ExchangeList {
    access_token: String,
    owner_email: Option<String>,
    start: String,
    end: String,
}
#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct ExchangeCreate {
    access_token: String,
    title: String,
    start: String,
    end: String,
    is_all_day: bool,
    location: Option<String>,
    description: Option<String>,
    attendees: Option<Vec<String>>,
}
#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct ExchangeUpdate {
    access_token: String,
    item_id: String,
    change_key: String,
    title: String,
    start: String,
    end: String,
    is_all_day: bool,
    location: Option<String>,
    description: Option<String>,
    update_series: bool,
}
#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct ExchangeDelete {
    access_token: String,
    item_id: String,
    change_key: String,
    send_cancellations: bool,
    delete_series: bool,
}
#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct ExchangeCancel {
    access_token: String,
    item_id: String,
    change_key: String,
    cancel_series: bool,
}
#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct ExchangeRespond {
    access_token: String,
    item_id: String,
    change_key: String,
    response_type: String,
    owner_email: String,
    body: Option<String>,
}
#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct ExchangeFreeBusy {
    refresh_token: String,
    emails: Vec<String>,
    start: String,
    end: String,
}
#[derive(Deserialize)]
struct HttpUrl {
    url: String,
}
#[derive(Deserialize)]
struct HttpAuth {
    url: String,
    username: String,
    password: String,
}
#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct HttpPut {
    url: String,
    username: String,
    password: String,
    ics_content: String,
}

fn jmap_state() -> &'static Arc<crate::jmap::JmapClientState> {
    static STATE: OnceLock<Arc<crate::jmap::JmapClientState>> = OnceLock::new();
    STATE.get_or_init(|| Arc::new(crate::jmap::JmapClientState::new()))
}

pub async fn dispatch(command: &str, value: Value) -> CommandResult {
    match command {
        "exchange_auth_device" => output(crate::ews::ews_start_device_auth().await),
        "google_auth_refresh" => {
            let a: GoogleRefresh = args(value)?;
            google_refresh(a).await
        }
        "google_auth_exchange_code" => {
            let a: GoogleCodeExchange = args(value)?;
            google_exchange_code(a).await
        }
        "exchange_auth_token" => {
            let a: ExchangeDeviceToken = args(value)?;
            output(crate::ews::ews_poll_device_token(a.device_code).await)
        }
        "exchange_auth_refresh" => {
            let a: ExchangeRefresh = args(value)?;
            output(crate::ews::ews_refresh_access_token(a.refresh_token).await)
        }
        "exchange_calendar_list" => {
            let a: ExchangeList = args(value)?;
            output(
                crate::ews::ews_get_calendar_events(a.access_token, a.owner_email, a.start, a.end)
                    .await,
            )
        }
        "exchange_calendar_create" => {
            let a: ExchangeCreate = args(value)?;
            output(
                crate::ews::ews_create_event(
                    a.access_token,
                    a.title,
                    a.start,
                    a.end,
                    a.is_all_day,
                    a.location,
                    a.description,
                    a.attendees,
                )
                .await,
            )
        }
        "exchange_calendar_update" => {
            let a: ExchangeUpdate = args(value)?;
            output(
                crate::ews::ews_update_event(
                    a.access_token,
                    a.item_id,
                    a.change_key,
                    a.title,
                    a.start,
                    a.end,
                    a.is_all_day,
                    a.location,
                    a.description,
                    a.update_series,
                )
                .await,
            )
        }
        "exchange_calendar_delete" => {
            let a: ExchangeDelete = args(value)?;
            output(
                crate::ews::ews_delete_event(
                    a.access_token,
                    a.item_id,
                    a.change_key,
                    a.send_cancellations,
                    a.delete_series,
                )
                .await,
            )
        }
        "exchange_calendar_cancel" => {
            let a: ExchangeCancel = args(value)?;
            output(
                crate::ews::ews_cancel_event(
                    a.access_token,
                    a.item_id,
                    a.change_key,
                    a.cancel_series,
                )
                .await,
            )
        }
        "exchange_calendar_respond" => {
            let a: ExchangeRespond = args(value)?;
            output(
                crate::ews::ews_respond_to_invitation(
                    a.access_token,
                    a.item_id,
                    a.change_key,
                    a.response_type,
                    a.owner_email,
                    a.body,
                )
                .await,
            )
        }
        "exchange_calendar_free_busy" => {
            let a: ExchangeFreeBusy = args(value)?;
            output(crate::ews::ews_get_free_busy(a.refresh_token, a.emails, a.start, a.end).await)
        }
        "calendar_ics_fetch" => {
            let a: HttpUrl = args(value)?;
            native_http("GET", a.url, None, None, None).await
        }
        "calendar_caldav_fetch" => {
            let a: HttpAuth = args(value)?;
            native_http("GET", a.url, Some(a.username), Some(a.password), None).await
        }
        "calendar_caldav_status" => {
            let a: HttpAuth = args(value)?;
            native_http("STATUS", a.url, Some(a.username), Some(a.password), None).await
        }
        "calendar_caldav_put" => {
            let a: HttpPut = args(value)?;
            native_http(
                "PUT",
                a.url,
                Some(a.username),
                Some(a.password),
                Some(a.ics_content),
            )
            .await
        }
        "calendar_caldav_delete" => {
            let a: HttpAuth = args(value)?;
            native_http("DELETE", a.url, Some(a.username), Some(a.password), None).await
        }
        "imap_list_folders" => {
            let a: ImapBase = args(value)?;
            output(crate::imap::imap_list_folders(a.config).await)
        }
        "imap_get_inbox_unread" => {
            let a: ImapFolder = args(value)?;
            output(crate::imap::imap_get_inbox_unread(a.config, a.folder).await)
        }
        "imap_list_threads" => {
            let a: ImapList = args(value)?;
            output(crate::imap::imap_list_threads(a.config, a.folder, a.max_count, a.offset).await)
        }
        "imap_get_thread" => {
            let a: ImapThread = args(value)?;
            output(crate::imap::imap_get_thread(a.config, a.conversation_id, a.folder).await)
        }
        "imap_get_message_content" => {
            let a: ImapMessage = args(value)?;
            output(crate::imap::imap_get_message_content(a.config, a.message_id, a.folder).await)
        }
        "imap_get_thread_snippet" => {
            let a: ImapThread = args(value)?;
            output(
                crate::imap::imap_get_thread_snippet(a.config, a.conversation_id, a.folder).await,
            )
        }
        "imap_mark_read" => {
            let a: ImapIds = args(value)?;
            output(crate::imap::imap_mark_read(a.config, a.folder, a.ids).await)
        }
        "imap_mark_unread" => {
            let a: ImapIds = args(value)?;
            output(crate::imap::imap_mark_unread(a.config, a.folder, a.ids).await)
        }
        "imap_move_to_trash" => {
            let a: ImapId = args(value)?;
            output(crate::imap::imap_move_to_trash(a.config, a.folder, a.id).await)
        }
        "imap_archive" => {
            let a: ImapId = args(value)?;
            output(crate::imap::imap_archive(a.config, a.folder, a.id).await)
        }
        "imap_permanently_delete" => {
            let a: ImapId = args(value)?;
            output(crate::imap::imap_permanently_delete(a.config, a.folder, a.id).await)
        }
        "imap_bulk_move_to_trash" => {
            let a: ImapIds = args(value)?;
            output(crate::imap::imap_bulk_move_to_trash(a.config, a.folder, a.ids).await)
        }
        "imap_bulk_permanently_delete" => {
            let a: ImapIds = args(value)?;
            output(crate::imap::imap_bulk_permanently_delete(a.config, a.folder, a.ids).await)
        }
        "imap_send" => {
            let a: ImapSend = args(value)?;
            output(
                crate::imap::imap_send(
                    a.config,
                    a.to,
                    a.cc,
                    a.bcc,
                    a.subject,
                    a.body_html,
                    a.attachments,
                )
                .await,
            )
        }
        "imap_get_attachment_data" => {
            let a: ImapAttachment = args(value)?;
            output(
                crate::imap::imap_get_attachment_data(
                    a.config,
                    a.folder,
                    a.message_id,
                    a.attachment_id,
                )
                .await,
            )
        }
        "mail_list_folders" => {
            let a: Token = args(value)?;
            output(crate::mail::mail_list_folders(a.access_token).await)
        }
        "mail_list_threads" => {
            let a: EwsList = args(value)?;
            output(
                crate::mail::mail_list_threads(
                    a.access_token,
                    a.folder,
                    a.max_count,
                    a.offset,
                    a.user_email,
                )
                .await,
            )
        }
        "mail_get_thread_count" => {
            let a: TokenFolder = args(value)?;
            output(crate::mail::mail_get_thread_count(a.access_token, a.folder).await)
        }
        "mail_get_thread_snippet" => {
            let a: EwsConversation = args(value)?;
            output(crate::mail::mail_get_thread_snippet(a.access_token, a.conversation_id).await)
        }
        "mail_get_thread" => {
            let a: EwsHeaders = args(value)?;
            output(
                crate::mail::mail_get_thread(
                    a.access_token,
                    a.conversation_id,
                    a.include_trash,
                    a.is_draft,
                    a.include_drafts,
                )
                .await,
            )
        }
        "mail_get_thread_headers" => {
            let a: EwsHeaders = args(value)?;
            output(
                crate::mail::mail_get_thread_headers(
                    a.access_token,
                    a.conversation_id,
                    a.include_trash,
                    a.is_draft,
                    a.include_drafts,
                )
                .await,
            )
        }
        "mail_search_threads" => {
            let a: EwsSearch = args(value)?;
            output(crate::mail::mail_search_threads(a.access_token, a.query, a.max_count).await)
        }
        "mail_get_message_content" => {
            let a: EwsItem = args(value)?;
            output(crate::mail::mail_get_message_content(a.access_token, a.item_id).await)
        }
        "mail_get_raw_message" => {
            let a: EwsItem = args(value)?;
            output(crate::mail::mail_get_raw_message(a.access_token, a.item_id).await)
        }
        "mail_import_raw_message" => {
            let a: EwsImport = args(value)?;
            output(
                crate::mail::mail_import_raw_message(a.access_token, a.raw_message, a.folder_id)
                    .await,
            )
        }
        "mail_mark_read" => {
            let a: EwsItems = args(value)?;
            output(crate::mail::mail_mark_read(a.access_token, a.items).await)
        }
        "mail_mark_unread" => {
            let a: EwsItems = args(value)?;
            output(crate::mail::mail_mark_unread(a.access_token, a.items).await)
        }
        "mail_move_to_trash" => {
            let a: EwsItem = args(value)?;
            output(crate::mail::mail_move_to_trash(a.access_token, a.item_id).await)
        }
        "mail_permanently_delete" => {
            let a: EwsItem = args(value)?;
            output(crate::mail::mail_permanently_delete(a.access_token, a.item_id).await)
        }
        "mail_bulk_move_to_trash" => {
            let a: EwsItemIds = args(value)?;
            output(crate::mail::mail_bulk_move_to_trash(a.access_token, a.item_ids).await)
        }
        "mail_bulk_permanently_delete" => {
            let a: EwsItemIds = args(value)?;
            output(crate::mail::mail_bulk_permanently_delete(a.access_token, a.item_ids).await)
        }
        "mail_bulk_move_to_folder" => {
            let a: EwsBulkMove = args(value)?;
            output(
                crate::mail::mail_bulk_move_to_folder(a.access_token, a.item_ids, a.folder_id)
                    .await,
            )
        }
        "mail_get_attachment_data" => {
            let a: EwsAttachment = args(value)?;
            output(crate::mail::mail_get_attachment_data(a.access_token, a.attachment_id).await)
        }
        "mail_get_inbox_unread" => {
            let a: Token = args(value)?;
            output(crate::mail::mail_get_inbox_unread(a.access_token).await)
        }
        "mail_find_or_create_snoozed_folder" => {
            let a: Token = args(value)?;
            output(crate::mail::mail_find_or_create_snoozed_folder(a.access_token).await)
        }
        "mail_move_to_folder" => {
            let a: EwsMove = args(value)?;
            output(crate::mail::mail_move_to_folder(a.access_token, a.item_id, a.folder_id).await)
        }
        "mail_snooze" => {
            let a: EwsSnooze = args(value)?;
            output(crate::mail::mail_snooze(a.access_token, a.item_id, a.until).await)
        }
        "mail_search_contacts" => {
            let a: EwsContact = args(value)?;
            output(crate::mail::mail_search_contacts(a.access_token, a.query, a.max_count).await)
        }
        "mail_get_contact_photo" => {
            let a: EwsPhoto = args(value)?;
            output(crate::mail::mail_get_contact_photo(a.access_token, a.email).await)
        }
        "mail_send" => {
            let a: EwsSend = args(value)?;
            output(
                crate::mail::mail_send(
                    a.access_token,
                    a.to,
                    a.cc,
                    a.bcc,
                    a.subject,
                    a.body_html,
                    a.reply_to_item_id,
                    a.reply_to_change_key,
                    a.attachments,
                    a.is_forward,
                    a.send_at,
                )
                .await,
            )
        }
        "mail_save_draft" => {
            let a: EwsDraft = args(value)?;
            output(
                crate::mail::mail_save_draft(
                    a.access_token,
                    a.to,
                    a.cc,
                    a.bcc,
                    a.subject,
                    a.body_html,
                )
                .await,
            )
        }
        "mail_backfill_contacts" => {
            let a: EwsBackfill = args(value)?;
            output(
                crate::mail::mail_backfill_contacts(
                    a.access_token,
                    a.folder,
                    a.offset,
                    a.max_count,
                    a.user_email,
                )
                .await,
            )
        }
        "jmap_get_capabilities" => {
            let a: JmapBase = args(value)?;
            output(crate::jmap::jmap_get_capabilities(jmap_state(), a.config).await)
        }
        "jmap_list_folders" => {
            let a: JmapBase = args(value)?;
            output(crate::jmap::jmap_list_folders(jmap_state(), a.config).await)
        }
        "jmap_get_inbox_unread" => {
            let a: JmapBase = args(value)?;
            output(crate::jmap::jmap_get_inbox_unread(jmap_state(), a.config).await)
        }
        "jmap_list_threads" => {
            let a: JmapList = args(value)?;
            output(
                crate::jmap::jmap_list_threads(
                    jmap_state(),
                    a.config,
                    a.folder,
                    a.max_count,
                    a.offset,
                )
                .await,
            )
        }
        "jmap_get_thread_count" => {
            let a: JmapFolder = args(value)?;
            output(crate::jmap::jmap_get_thread_count(jmap_state(), a.config, a.folder).await)
        }
        "jmap_get_thread_snippet" => {
            let a: JmapConversation = args(value)?;
            output(
                crate::jmap::jmap_get_thread_snippet(jmap_state(), a.config, a.conversation_id)
                    .await,
            )
        }
        "jmap_search_threads" => {
            let a: JmapSearch = args(value)?;
            output(
                crate::jmap::jmap_search_threads(jmap_state(), a.config, a.query, a.max_count)
                    .await,
            )
        }
        "jmap_get_thread" => {
            let a: JmapConversation = args(value)?;
            output(crate::jmap::jmap_get_thread(jmap_state(), a.config, a.conversation_id).await)
        }
        "jmap_get_message_content" => {
            let a: JmapMessage = args(value)?;
            output(
                crate::jmap::jmap_get_message_content(
                    jmap_state(),
                    a.config,
                    a.message_id,
                    a.conversation_id,
                )
                .await,
            )
        }
        "jmap_get_raw_message" => {
            let a: JmapRawItem = args(value)?;
            output(crate::jmap::jmap_get_raw_message(jmap_state(), a.config, a.item_id).await)
        }
        "jmap_import_raw_message" => {
            let a: JmapImport = args(value)?;
            output(
                crate::jmap::jmap_import_raw_message(
                    jmap_state(),
                    a.config,
                    a.raw_message,
                    a.folder_id,
                )
                .await,
            )
        }
        "jmap_list_identities" => {
            let a: JmapBase = args(value)?;
            output(crate::jmap::jmap_list_identities(jmap_state(), a.config).await)
        }
        "jmap_mark_read" => {
            let a: JmapIds = args(value)?;
            output(crate::jmap::jmap_mark_read(jmap_state(), a.config, a.ids).await)
        }
        "jmap_mark_unread" => {
            let a: JmapIds = args(value)?;
            output(crate::jmap::jmap_mark_unread(jmap_state(), a.config, a.ids).await)
        }
        "jmap_move_to_trash" => {
            let a: JmapItem = args(value)?;
            output(crate::jmap::jmap_move_to_trash(jmap_state(), a.config, a.id).await)
        }
        "jmap_permanently_delete" => {
            let a: JmapItem = args(value)?;
            output(crate::jmap::jmap_permanently_delete(jmap_state(), a.config, a.id).await)
        }
        "jmap_bulk_move_to_trash" => {
            let a: JmapThreads = args(value)?;
            output(crate::jmap::jmap_bulk_move_to_trash(jmap_state(), a.config, a.thread_ids).await)
        }
        "jmap_bulk_permanently_delete" => {
            let a: JmapThreads = args(value)?;
            output(
                crate::jmap::jmap_bulk_permanently_delete(jmap_state(), a.config, a.thread_ids)
                    .await,
            )
        }
        "jmap_bulk_move_to_folder" => {
            let a: JmapBulkMove = args(value)?;
            output(
                crate::jmap::jmap_bulk_move_to_folder(
                    jmap_state(),
                    a.config,
                    a.thread_ids,
                    a.folder_id,
                )
                .await,
            )
        }
        "jmap_move_to_folder" => {
            let a: JmapMove = args(value)?;
            output(
                crate::jmap::jmap_move_to_folder(jmap_state(), a.config, a.id, a.folder_id).await,
            )
        }
        "jmap_send" => {
            let a: JmapSend = args(value)?;
            output(
                crate::jmap::jmap_send(
                    jmap_state(),
                    a.config,
                    a.to,
                    a.cc,
                    a.bcc,
                    a.subject,
                    a.body_html,
                    a.attachments,
                    a.identity_id,
                    a.in_reply_to,
                    a.references,
                    a.send_at,
                )
                .await,
            )
        }
        "jmap_get_attachment_data" => {
            let a: JmapBlob = args(value)?;
            output(crate::jmap::jmap_get_attachment_data(jmap_state(), a.config, a.blob_id).await)
        }
        "jmap_find_or_create_snoozed_folder" => {
            let a: JmapBase = args(value)?;
            output(crate::jmap::jmap_find_or_create_snoozed_folder(jmap_state(), a.config).await)
        }
        "jmap_snooze" => {
            let a: JmapSnooze = args(value)?;
            output(crate::jmap::jmap_snooze(jmap_state(), a.config, a.id, a.until).await)
        }
        "jmap_get_scheduled_send" => {
            let a: JmapScheduled = args(value)?;
            output(crate::jmap::jmap_get_scheduled_send(jmap_state(), a.config, a.email_id).await)
        }
        "jmap_cancel_scheduled_send" => {
            let a: JmapSubmission = args(value)?;
            output(
                crate::jmap::jmap_cancel_scheduled_send(jmap_state(), a.config, a.submission_id)
                    .await,
            )
        }
        _ => Err(CommandError {
            code: "unknown_mail_command",
            detail: "unknown mail command".into(),
        }),
    }
}

async fn google_refresh(request: GoogleRefresh) -> CommandResult {
    let client_id = request
        .client_id
        .or_else(|| std::env::var("COURRIER_GOOGLE_CLIENT_ID").ok())
        .filter(|value| !value.trim().is_empty())
        .ok_or_else(|| CommandError {
            code: "google_oauth_not_configured",
            detail: "Google OAuth client ID missing".into(),
        })?;
    let client_secret = request
        .client_secret
        .or_else(|| std::env::var("COURRIER_GOOGLE_CLIENT_SECRET").ok())
        .unwrap_or_default();
    let response = reqwest::Client::new()
        .post("https://oauth2.googleapis.com/token")
        .form(&[
            ("client_id", client_id.as_str()),
            ("client_secret", client_secret.as_str()),
            ("refresh_token", request.refresh_token.as_str()),
            ("grant_type", "refresh_token"),
        ])
        .send()
        .await
        .map_err(|error| CommandError {
            code: "provider_request_failed",
            detail: error.to_string(),
        })?;
    if !response.status().is_success() {
        return Err(CommandError {
            code: "reauthorization_required",
            detail: "Google authorization expired".into(),
        });
    }
    let value: Value = response.json().await.map_err(|error| CommandError {
        code: "provider_request_failed",
        detail: error.to_string(),
    })?;
    let expires_in = value["expires_in"]
        .as_u64()
        .unwrap_or(3600)
        .saturating_sub(60);
    let expires_at = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis() as u64
        + expires_in * 1000;
    Ok(serde_json::json!({ "access_token": value["access_token"], "expires_at": expires_at }))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn cross_source_import_commands_are_registered() {
        for command in ["mail_import_raw_message", "jmap_import_raw_message"] {
            let error = dispatch(command, serde_json::json!({})).await.unwrap_err();
            assert_eq!(error.code, "invalid_arguments", "{command} was not routed");
        }
    }

    #[tokio::test]
    async fn ews_thread_command_is_registered() {
        let error = dispatch("mail_get_thread", serde_json::json!({}))
            .await
            .unwrap_err();
        assert_eq!(error.code, "invalid_arguments");
    }

    #[tokio::test]
    async fn ews_snooze_requires_a_date() {
        let error = dispatch(
            "mail_snooze",
            serde_json::json!({ "accessToken": "token", "itemId": "item" }),
        )
        .await
        .unwrap_err();
        assert_eq!(error.code, "invalid_arguments");
    }
}

async fn google_exchange_code(request: GoogleCodeExchange) -> CommandResult {
    let mut form = vec![
        ("client_id", request.client_id),
        ("code", request.code),
        ("grant_type", "authorization_code".into()),
    ];
    if let Some(secret) = request.client_secret.filter(|value| !value.is_empty()) {
        form.push(("client_secret", secret));
    }
    if let Some(uri) = request.redirect_uri.filter(|value| !value.is_empty()) {
        form.push(("redirect_uri", uri));
    }
    if let Some(verifier) = request.code_verifier.filter(|value| !value.is_empty()) {
        form.push(("code_verifier", verifier));
    }
    let client = reqwest::Client::new();
    let response = client
        .post("https://oauth2.googleapis.com/token")
        .form(&form)
        .send()
        .await
        .map_err(|error| CommandError {
            code: "provider_request_failed",
            detail: error.to_string(),
        })?;
    if !response.status().is_success() {
        return Err(CommandError {
            code: "reauthorization_required",
            detail: "Google rejected the authorization code".into(),
        });
    }
    let tokens: Value = response.json().await.map_err(|error| CommandError {
        code: "provider_request_failed",
        detail: error.to_string(),
    })?;
    let access_token = tokens["access_token"]
        .as_str()
        .ok_or_else(|| CommandError {
            code: "provider_request_failed",
            detail: "Google token response has no access token".into(),
        })?;
    let profile_response = client
        .get("https://www.googleapis.com/oauth2/v2/userinfo")
        .bearer_auth(access_token)
        .send()
        .await
        .map_err(|error| CommandError {
            code: "provider_request_failed",
            detail: error.to_string(),
        })?;
    if !profile_response.status().is_success() {
        return Err(CommandError {
            code: "provider_request_failed",
            detail: "Google user profile request failed".into(),
        });
    }
    let profile: Value = profile_response
        .json()
        .await
        .map_err(|error| CommandError {
            code: "provider_request_failed",
            detail: error.to_string(),
        })?;
    let expires_in = tokens["expires_in"]
        .as_u64()
        .unwrap_or(3600)
        .saturating_sub(60);
    let expires_at = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis() as u64
        + expires_in * 1000;
    Ok(serde_json::json!({
        "email": profile["email"], "name": profile["name"], "picture": profile["picture"],
        "accessToken": access_token, "refreshToken": tokens["refresh_token"].as_str().unwrap_or_default(),
        "expiresAt": expires_at
    }))
}

async fn native_http(
    method: &str,
    raw_url: String,
    username: Option<String>,
    password: Option<String>,
    body: Option<String>,
) -> CommandResult {
    let url = reqwest::Url::parse(&raw_url).map_err(|error| CommandError {
        code: "invalid_provider_url",
        detail: error.to_string(),
    })?;
    if !matches!(url.scheme(), "http" | "https")
        || !url.username().is_empty()
        || url.password().is_some()
    {
        return Err(CommandError {
            code: "invalid_provider_url",
            detail: "invalid provider URL".into(),
        });
    }
    let client = reqwest::Client::builder()
        .redirect(reqwest::redirect::Policy::none())
        .build()
        .map_err(|error| CommandError {
            code: "provider_request_failed",
            detail: error.to_string(),
        })?;
    let mut request = match method {
        "PUT" => client.put(url),
        "DELETE" => client.delete(url),
        _ => client.get(url),
    };
    if let Some(username) = username {
        request = request.basic_auth(username, password);
    }
    if let Some(body) = body {
        request = request
            .header("content-type", "text/calendar; charset=utf-8")
            .body(body);
    }
    let response = request.send().await.map_err(|error| CommandError {
        code: "provider_request_failed",
        detail: error.to_string(),
    })?;
    let status = response.status();
    if method == "STATUS" {
        return Ok(serde_json::json!({ "status": status.as_u16() }));
    }
    if !status.is_success() && !(method == "DELETE" && status == reqwest::StatusCode::NOT_FOUND) {
        return Err(CommandError {
            code: "provider_request_failed",
            detail: format!("provider_http_{}", status.as_u16()),
        });
    }
    if method == "GET" {
        return response
            .text()
            .await
            .map(|text| serde_json::json!({ "text": text }))
            .map_err(|error| CommandError {
                code: "provider_request_failed",
                detail: error.to_string(),
            });
    }
    Ok(serde_json::json!({ "ok": true }))
}
