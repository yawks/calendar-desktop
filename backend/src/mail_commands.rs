use axum::{extract::Path, http::StatusCode, Json};
use serde::de::DeserializeOwned;
use serde::Deserialize;
use serde_json::Value;
use std::sync::{Arc, OnceLock};

type ApiResult = Result<Json<Value>, (StatusCode, Json<Value>)>;

fn args<T: DeserializeOwned>(value: Value) -> Result<T, (StatusCode, Json<Value>)> {
    serde_json::from_value(value).map_err(|error| (StatusCode::BAD_REQUEST, Json(serde_json::json!({ "error": error.to_string() }))))
}
fn output<T: serde::Serialize>(value: Result<T, String>) -> ApiResult {
    value.map(|item| Json(serde_json::to_value(item).unwrap_or(Value::Null)))
        .map_err(|error| (StatusCode::BAD_GATEWAY, Json(serde_json::json!({ "error": error }))))
}

#[derive(Deserialize)] #[serde(rename_all="camelCase")] struct ImapBase { config: app_lib::imap::ImapConfig }
#[derive(Deserialize)] #[serde(rename_all="camelCase")] struct ImapFolder { config: app_lib::imap::ImapConfig, folder: String }
#[derive(Deserialize)] #[serde(rename_all="camelCase")] struct ImapList { config: app_lib::imap::ImapConfig, folder: String, max_count: Option<u32>, offset: Option<u32> }
#[derive(Deserialize)] #[serde(rename_all="camelCase")] struct ImapThread { config: app_lib::imap::ImapConfig, folder: String, conversation_id: String }
#[derive(Deserialize)] #[serde(rename_all="camelCase")] struct ImapMessage { config: app_lib::imap::ImapConfig, folder: String, message_id: String }
#[derive(Deserialize)] #[serde(rename_all="camelCase")] struct ImapIds { config: app_lib::imap::ImapConfig, folder: String, ids: Vec<String> }
#[derive(Deserialize)] #[serde(rename_all="camelCase")] struct ImapId { config: app_lib::imap::ImapConfig, folder: String, id: String }
#[derive(Deserialize)] #[serde(rename_all="camelCase")] struct ImapAttachment { config: app_lib::imap::ImapConfig, folder: String, message_id: String, attachment_id: String }
#[derive(Deserialize)] #[serde(rename_all="camelCase")] struct ImapSend { config: app_lib::imap::ImapConfig, to: Vec<String>, cc: Vec<String>, bcc: Vec<String>, subject: String, body_html: String, attachments: Option<Vec<app_lib::mail_provider::ComposerAttachment>> }

#[derive(Deserialize)] #[serde(rename_all="camelCase")] struct Token { access_token: String }
#[derive(Deserialize)] #[serde(rename_all="camelCase")] struct TokenFolder { access_token: String, folder: String }
#[derive(Deserialize)] #[serde(rename_all="camelCase")] struct EwsList { access_token: String, folder: String, max_count: Option<u32>, offset: Option<u32>, user_email: Option<String> }
#[derive(Deserialize)] #[serde(rename_all="camelCase")] struct EwsConversation { access_token: String, conversation_id: String }
#[derive(Deserialize)] #[serde(rename_all="camelCase")] struct EwsHeaders { access_token: String, conversation_id: String, include_trash: Option<bool>, is_draft: Option<bool>, include_drafts: Option<bool> }
#[derive(Deserialize)] #[serde(rename_all="camelCase")] struct EwsItem { access_token: String, item_id: String }
#[derive(Deserialize)] #[serde(rename_all="camelCase")] struct EwsItems { access_token: String, items: Vec<app_lib::mail_provider::MailItemRef> }
#[derive(Deserialize)] #[serde(rename_all="camelCase")] struct EwsItemIds { access_token: String, item_ids: Vec<String> }
#[derive(Deserialize)] #[serde(rename_all="camelCase")] struct EwsMove { access_token: String, item_id: String, folder_id: String }
#[derive(Deserialize)] #[serde(rename_all="camelCase")] struct EwsBulkMove { access_token: String, item_ids: Vec<String>, folder_id: String }
#[derive(Deserialize)] #[serde(rename_all="camelCase")] struct EwsAttachment { access_token: String, attachment_id: String }
#[derive(Deserialize)] #[serde(rename_all="camelCase")] struct EwsContact { access_token: String, query: String, max_count: Option<u32> }
#[derive(Deserialize)] #[serde(rename_all="camelCase")] struct EwsPhoto { access_token: String, email: String }
#[derive(Deserialize)] #[serde(rename_all="camelCase")] struct EwsSearch { access_token: String, query: app_lib::mail_provider::MailSearchQuery, max_count: Option<u32> }
#[derive(Deserialize)] #[serde(rename_all="camelCase")] struct EwsSend { access_token: String, to: Vec<String>, cc: Vec<String>, bcc: Vec<String>, subject: String, body_html: String, reply_to_item_id: Option<String>, reply_to_change_key: Option<String>, attachments: Option<Vec<app_lib::mail_provider::ComposerAttachment>>, is_forward: Option<bool>, send_at: Option<String> }
#[derive(Deserialize)] #[serde(rename_all="camelCase")] struct EwsDraft { access_token: String, to: Vec<String>, cc: Vec<String>, bcc: Vec<String>, subject: String, body_html: String }
#[derive(Deserialize)] #[serde(rename_all="camelCase")] struct EwsBackfill { access_token: String, folder: String, offset: u32, max_count: u32, user_email: String }
#[derive(Deserialize)] #[serde(rename_all="camelCase")] struct JmapBase { config: app_lib::jmap::JmapConfig }
#[derive(Deserialize)] #[serde(rename_all="camelCase")] struct JmapFolder { config: app_lib::jmap::JmapConfig, folder: String }
#[derive(Deserialize)] #[serde(rename_all="camelCase")] struct JmapList { config: app_lib::jmap::JmapConfig, folder: String, max_count: Option<u32>, offset: Option<u32> }
#[derive(Deserialize)] #[serde(rename_all="camelCase")] struct JmapConversation { config: app_lib::jmap::JmapConfig, conversation_id: String }
#[derive(Deserialize)] #[serde(rename_all="camelCase")] struct JmapMessage { config: app_lib::jmap::JmapConfig, message_id: String, conversation_id: Option<String> }
#[derive(Deserialize)] #[serde(rename_all="camelCase")] struct JmapItem { config: app_lib::jmap::JmapConfig, id: String }
#[derive(Deserialize)] #[serde(rename_all="camelCase")] struct JmapRawItem { config: app_lib::jmap::JmapConfig, item_id: String }
#[derive(Deserialize)] #[serde(rename_all="camelCase")] struct JmapIds { config: app_lib::jmap::JmapConfig, ids: Vec<String> }
#[derive(Deserialize)] #[serde(rename_all="camelCase")] struct JmapThreads { config: app_lib::jmap::JmapConfig, thread_ids: Vec<String> }
#[derive(Deserialize)] #[serde(rename_all="camelCase")] struct JmapMove { config: app_lib::jmap::JmapConfig, id: String, folder_id: String }
#[derive(Deserialize)] #[serde(rename_all="camelCase")] struct JmapBulkMove { config: app_lib::jmap::JmapConfig, thread_ids: Vec<String>, folder_id: String }
#[derive(Deserialize)] #[serde(rename_all="camelCase")] struct JmapBlob { config: app_lib::jmap::JmapConfig, blob_id: String }
#[derive(Deserialize)] #[serde(rename_all="camelCase")] struct JmapSnooze { config: app_lib::jmap::JmapConfig, id: String, until: Option<String> }
#[derive(Deserialize)] #[serde(rename_all="camelCase")] struct JmapScheduled { config: app_lib::jmap::JmapConfig, email_id: String }
#[derive(Deserialize)] #[serde(rename_all="camelCase")] struct JmapSubmission { config: app_lib::jmap::JmapConfig, submission_id: String }
#[derive(Deserialize)] #[serde(rename_all="camelCase")] struct JmapSearch { config: app_lib::jmap::JmapConfig, query: app_lib::mail_provider::MailSearchQuery, max_count: Option<u32> }
#[derive(Deserialize)] #[serde(rename_all="camelCase")] struct JmapSend { config: app_lib::jmap::JmapConfig, to: Vec<String>, cc: Vec<String>, bcc: Vec<String>, subject: String, body_html: String, attachments: Option<Vec<app_lib::mail_provider::ComposerAttachment>>, identity_id: Option<String>, in_reply_to: Option<String>, references: Option<String>, send_at: Option<String> }

fn jmap_state() -> &'static Arc<app_lib::jmap::JmapClientState> {
    static STATE: OnceLock<Arc<app_lib::jmap::JmapClientState>> = OnceLock::new();
    STATE.get_or_init(|| Arc::new(app_lib::jmap::JmapClientState::new()))
}

pub async fn dispatch(Path(command): Path<String>, Json(value): Json<Value>) -> ApiResult {
    match command.as_str() {
        "imap_list_folders" => { let a: ImapBase=args(value)?; output(app_lib::imap::imap_list_folders(a.config).await) }
        "imap_get_inbox_unread" => { let a: ImapFolder=args(value)?; output(app_lib::imap::imap_get_inbox_unread(a.config,a.folder).await) }
        "imap_list_threads" => { let a: ImapList=args(value)?; output(app_lib::imap::imap_list_threads(a.config,a.folder,a.max_count,a.offset).await) }
        "imap_get_thread" => { let a: ImapThread=args(value)?; output(app_lib::imap::imap_get_thread(a.config,a.conversation_id,a.folder).await) }
        "imap_get_message_content" => { let a: ImapMessage=args(value)?; output(app_lib::imap::imap_get_message_content(a.config,a.message_id,a.folder).await) }
        "imap_get_thread_snippet" => { let a: ImapThread=args(value)?; output(app_lib::imap::imap_get_thread_snippet(a.config,a.conversation_id,a.folder).await) }
        "imap_mark_read" => { let a: ImapIds=args(value)?; output(app_lib::imap::imap_mark_read(a.config,a.folder,a.ids).await) }
        "imap_mark_unread" => { let a: ImapIds=args(value)?; output(app_lib::imap::imap_mark_unread(a.config,a.folder,a.ids).await) }
        "imap_move_to_trash" => { let a: ImapId=args(value)?; output(app_lib::imap::imap_move_to_trash(a.config,a.folder,a.id).await) }
        "imap_permanently_delete" => { let a: ImapId=args(value)?; output(app_lib::imap::imap_permanently_delete(a.config,a.folder,a.id).await) }
        "imap_bulk_move_to_trash" => { let a: ImapIds=args(value)?; output(app_lib::imap::imap_bulk_move_to_trash(a.config,a.folder,a.ids).await) }
        "imap_bulk_permanently_delete" => { let a: ImapIds=args(value)?; output(app_lib::imap::imap_bulk_permanently_delete(a.config,a.folder,a.ids).await) }
        "imap_send" => { let a: ImapSend=args(value)?; output(app_lib::imap::imap_send(a.config,a.to,a.cc,a.bcc,a.subject,a.body_html,a.attachments).await) }
        "imap_get_attachment_data" => { let a: ImapAttachment=args(value)?; output(app_lib::imap::imap_get_attachment_data(a.config,a.folder,a.message_id,a.attachment_id).await) }
        "mail_list_folders" => { let a:Token=args(value)?; output(app_lib::mail::mail_list_folders(a.access_token).await) }
        "mail_list_threads" => { let a:EwsList=args(value)?; output(app_lib::mail::mail_list_threads(a.access_token,a.folder,a.max_count,a.offset,a.user_email).await) }
        "mail_get_thread_count" => { let a:TokenFolder=args(value)?; output(app_lib::mail::mail_get_thread_count(a.access_token,a.folder).await) }
        "mail_get_thread_snippet" => { let a:EwsConversation=args(value)?; output(app_lib::mail::mail_get_thread_snippet(a.access_token,a.conversation_id).await) }
        "mail_get_thread_headers" => { let a:EwsHeaders=args(value)?; output(app_lib::mail::mail_get_thread_headers(a.access_token,a.conversation_id,a.include_trash,a.is_draft,a.include_drafts).await) }
        "mail_search_threads" => { let a:EwsSearch=args(value)?; output(app_lib::mail::mail_search_threads(a.access_token,a.query,a.max_count).await) }
        "mail_get_message_content" => { let a:EwsItem=args(value)?; output(app_lib::mail::mail_get_message_content(a.access_token,a.item_id).await) }
        "mail_get_raw_message" => { let a:EwsItem=args(value)?; output(app_lib::mail::mail_get_raw_message(a.access_token,a.item_id).await) }
        "mail_mark_read" => { let a:EwsItems=args(value)?; output(app_lib::mail::mail_mark_read(a.access_token,a.items).await) }
        "mail_mark_unread" => { let a:EwsItems=args(value)?; output(app_lib::mail::mail_mark_unread(a.access_token,a.items).await) }
        "mail_move_to_trash" => { let a:EwsItem=args(value)?; output(app_lib::mail::mail_move_to_trash(a.access_token,a.item_id).await) }
        "mail_permanently_delete" => { let a:EwsItem=args(value)?; output(app_lib::mail::mail_permanently_delete(a.access_token,a.item_id).await) }
        "mail_bulk_move_to_trash" => { let a:EwsItemIds=args(value)?; output(app_lib::mail::mail_bulk_move_to_trash(a.access_token,a.item_ids).await) }
        "mail_bulk_permanently_delete" => { let a:EwsItemIds=args(value)?; output(app_lib::mail::mail_bulk_permanently_delete(a.access_token,a.item_ids).await) }
        "mail_bulk_move_to_folder" => { let a:EwsBulkMove=args(value)?; output(app_lib::mail::mail_bulk_move_to_folder(a.access_token,a.item_ids,a.folder_id).await) }
        "mail_get_attachment_data" => { let a:EwsAttachment=args(value)?; output(app_lib::mail::mail_get_attachment_data(a.access_token,a.attachment_id).await) }
        "mail_get_inbox_unread" => { let a:Token=args(value)?; output(app_lib::mail::mail_get_inbox_unread(a.access_token).await) }
        "mail_find_or_create_snoozed_folder" => { let a:Token=args(value)?; output(app_lib::mail::mail_find_or_create_snoozed_folder(a.access_token).await) }
        "mail_move_to_folder" => { let a:EwsMove=args(value)?; output(app_lib::mail::mail_move_to_folder(a.access_token,a.item_id,a.folder_id).await) }
        "mail_snooze" => { let a:EwsItem=args(value)?; output(app_lib::mail::mail_snooze(a.access_token,a.item_id).await) }
        "mail_search_contacts" => { let a:EwsContact=args(value)?; output(app_lib::mail::mail_search_contacts(a.access_token,a.query,a.max_count).await) }
        "mail_get_contact_photo" => { let a:EwsPhoto=args(value)?; output(app_lib::mail::mail_get_contact_photo(a.access_token,a.email).await) }
        "mail_send" => { let a:EwsSend=args(value)?; output(app_lib::mail::mail_send(a.access_token,a.to,a.cc,a.bcc,a.subject,a.body_html,a.reply_to_item_id,a.reply_to_change_key,a.attachments,a.is_forward,a.send_at).await) }
        "mail_save_draft" => { let a:EwsDraft=args(value)?; output(app_lib::mail::mail_save_draft(a.access_token,a.to,a.cc,a.bcc,a.subject,a.body_html).await) }
        "mail_backfill_contacts" => { let a:EwsBackfill=args(value)?; output(app_lib::mail::mail_backfill_contacts(a.access_token,a.folder,a.offset,a.max_count,a.user_email).await) }
        "jmap_get_capabilities" => { let a:JmapBase=args(value)?; output(app_lib::jmap::jmap_get_capabilities(jmap_state(),a.config).await) }
        "jmap_list_folders" => { let a:JmapBase=args(value)?; output(app_lib::jmap::jmap_list_folders(jmap_state(),a.config).await) }
        "jmap_get_inbox_unread" => { let a:JmapBase=args(value)?; output(app_lib::jmap::jmap_get_inbox_unread(jmap_state(),a.config).await) }
        "jmap_list_threads" => { let a:JmapList=args(value)?; output(app_lib::jmap::jmap_list_threads(jmap_state(),a.config,a.folder,a.max_count,a.offset).await) }
        "jmap_get_thread_count" => { let a:JmapFolder=args(value)?; output(app_lib::jmap::jmap_get_thread_count(jmap_state(),a.config,a.folder).await) }
        "jmap_get_thread_snippet" => { let a:JmapConversation=args(value)?; output(app_lib::jmap::jmap_get_thread_snippet(jmap_state(),a.config,a.conversation_id).await) }
        "jmap_search_threads" => { let a:JmapSearch=args(value)?; output(app_lib::jmap::jmap_search_threads(jmap_state(),a.config,a.query,a.max_count).await) }
        "jmap_get_thread" => { let a:JmapConversation=args(value)?; output(app_lib::jmap::jmap_get_thread(jmap_state(),a.config,a.conversation_id).await) }
        "jmap_get_message_content" => { let a:JmapMessage=args(value)?; output(app_lib::jmap::jmap_get_message_content(jmap_state(),a.config,a.message_id,a.conversation_id).await) }
        "jmap_get_raw_message" => { let a:JmapRawItem=args(value)?; output(app_lib::jmap::jmap_get_raw_message(jmap_state(),a.config,a.item_id).await) }
        "jmap_list_identities" => { let a:JmapBase=args(value)?; output(app_lib::jmap::jmap_list_identities(jmap_state(),a.config).await) }
        "jmap_mark_read" => { let a:JmapIds=args(value)?; output(app_lib::jmap::jmap_mark_read(jmap_state(),a.config,a.ids).await) }
        "jmap_mark_unread" => { let a:JmapIds=args(value)?; output(app_lib::jmap::jmap_mark_unread(jmap_state(),a.config,a.ids).await) }
        "jmap_move_to_trash" => { let a:JmapItem=args(value)?; output(app_lib::jmap::jmap_move_to_trash(jmap_state(),a.config,a.id).await) }
        "jmap_permanently_delete" => { let a:JmapItem=args(value)?; output(app_lib::jmap::jmap_permanently_delete(jmap_state(),a.config,a.id).await) }
        "jmap_bulk_move_to_trash" => { let a:JmapThreads=args(value)?; output(app_lib::jmap::jmap_bulk_move_to_trash(jmap_state(),a.config,a.thread_ids).await) }
        "jmap_bulk_permanently_delete" => { let a:JmapThreads=args(value)?; output(app_lib::jmap::jmap_bulk_permanently_delete(jmap_state(),a.config,a.thread_ids).await) }
        "jmap_bulk_move_to_folder" => { let a:JmapBulkMove=args(value)?; output(app_lib::jmap::jmap_bulk_move_to_folder(jmap_state(),a.config,a.thread_ids,a.folder_id).await) }
        "jmap_move_to_folder" => { let a:JmapMove=args(value)?; output(app_lib::jmap::jmap_move_to_folder(jmap_state(),a.config,a.id,a.folder_id).await) }
        "jmap_send" => { let a:JmapSend=args(value)?; output(app_lib::jmap::jmap_send(jmap_state(),a.config,a.to,a.cc,a.bcc,a.subject,a.body_html,a.attachments,a.identity_id,a.in_reply_to,a.references,a.send_at).await) }
        "jmap_get_attachment_data" => { let a:JmapBlob=args(value)?; output(app_lib::jmap::jmap_get_attachment_data(jmap_state(),a.config,a.blob_id).await) }
        "jmap_find_or_create_snoozed_folder" => { let a:JmapBase=args(value)?; output(app_lib::jmap::jmap_find_or_create_snoozed_folder(jmap_state(),a.config).await) }
        "jmap_snooze" => { let a:JmapSnooze=args(value)?; output(app_lib::jmap::jmap_snooze(jmap_state(),a.config,a.id,a.until).await) }
        "jmap_get_scheduled_send" => { let a:JmapScheduled=args(value)?; output(app_lib::jmap::jmap_get_scheduled_send(jmap_state(),a.config,a.email_id).await) }
        "jmap_cancel_scheduled_send" => { let a:JmapSubmission=args(value)?; output(app_lib::jmap::jmap_cancel_scheduled_send(jmap_state(),a.config,a.submission_id).await) }
        _ => Err((StatusCode::NOT_FOUND, Json(serde_json::json!({ "error": "unknown_mail_command" })))),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_browser_camel_case_arguments() {
        let parsed: JmapRawItem = args(serde_json::json!({
            "config": { "email": "u@example.test", "session_url": "https://mail.example/.well-known/jmap", "token": "secret" },
            "itemId": "message-1"
        })).expect("valid command arguments");
        assert_eq!(parsed.item_id, "message-1");
    }

    #[test]
    fn provider_errors_are_mapped_to_bad_gateway() {
        let (status, body) = output::<()>(Err("provider failed".into())).unwrap_err();
        assert_eq!(status, StatusCode::BAD_GATEWAY);
        assert_eq!(body.0["error"], "provider failed");
    }

    #[tokio::test]
    async fn rejects_unknown_commands() {
        let (status, body) = dispatch(Path("not_a_command".into()), Json(Value::Null)).await.unwrap_err();
        assert_eq!(status, StatusCode::NOT_FOUND);
        assert_eq!(body.0["error"], "unknown_mail_command");
    }
}
