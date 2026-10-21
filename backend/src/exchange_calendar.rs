use axum::{http::StatusCode, Json};
use serde::Deserialize;
use std::collections::HashMap;

const EWS_ENDPOINT: &str = "https://outlook.office365.com/EWS/Exchange.asmx";

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CreateRequest {
    sensitivity: Option<String>,
    availability: Option<String>,
    #[serde(default)]
    online_meeting: bool,
    refresh_token: Option<String>,
    recurrence: Option<String>,
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
pub struct RespondRequest {
    access_token: String,
    item_id: String,
    change_key: String,
    response_type: String,
    owner_email: String,
    body: Option<String>,
    #[serde(default)]
    respond_series: bool,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UpdateRequest {
    sensitivity: Option<String>,
    availability: Option<String>,
    attendees: Option<Vec<String>>,
    original_start: Option<String>,
    recurrence: Option<String>,
    access_token: String, item_id: String, change_key: String,
    title: String, start: String, end: String, is_all_day: bool,
    location: Option<String>, description: Option<String>, update_series: bool,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DeleteRequest {
    access_token: String, item_id: String, change_key: String,
    send_cancellations: bool, delete_series: bool,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CancelRequest {
    access_token: String, item_id: String, change_key: String, cancel_series: bool,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ListRequest { folder_id: Option<String>, shared_mailbox: Option<String>, access_token: String, owner_email: Option<String>, start: String, end: String }

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FreeBusyRequest { anchor_mailbox: Option<String>, refresh_token: String, emails: Vec<String>, start: String, end: String }

type ApiError = (StatusCode, Json<serde_json::Value>);

fn escape(value: &str) -> String {
    value.replace('&', "&amp;").replace('<', "&lt;").replace('>', "&gt;").replace('"', "&quot;").replace('\'', "&apos;")
}

fn envelope(body: &str) -> String {
    format!(r#"<?xml version="1.0" encoding="utf-8"?><soap:Envelope xmlns:soap="http://schemas.xmlsoap.org/soap/envelope/" xmlns:t="http://schemas.microsoft.com/exchange/services/2006/types" xmlns:m="http://schemas.microsoft.com/exchange/services/2006/messages"><soap:Header><t:RequestServerVersion Version="Exchange2013_SP1"/></soap:Header><soap:Body>{body}</soap:Body></soap:Envelope>"#)
}

fn xml_attr(xml: &str, name: &str) -> Option<String> {
    let marker = format!(r#"{name}=""#);
    let start = xml.find(&marker)? + marker.len();
    let end = xml[start..].find('"')? + start;
    Some(xml[start..end].into())
}

fn xml_content(xml: &str, tag: &str) -> Option<String> {
    let open = format!("<{tag}>");
    let close = format!("</{tag}>");
    let start = xml.find(&open)? + open.len();
    let end = xml[start..].find(&close)? + start;
    Some(xml[start..end].into())
}

async fn send(token: &str, body: &str, anchor: Option<&str>) -> Result<String, ApiError> {
    let client = reqwest::Client::new();
    let mut request = client.post(EWS_ENDPOINT).bearer_auth(token)
        .header("content-type", "text/xml; charset=utf-8").body(envelope(body));
    if let Some(mailbox) = anchor { request = request.header("x-anchormailbox", mailbox); }
    let response = request.send().await.map_err(|error| (StatusCode::BAD_GATEWAY, Json(serde_json::json!({ "error": error.to_string() }))))?;
    let status = response.status();
    let text = response.text().await.unwrap_or_default();
    if !status.is_success() { return Err((status, Json(serde_json::json!({ "error": format!("ews_http_{}", status.as_u16()) })))); }
    if text.contains("ResponseClass=\"Error\"") {
        return Err((StatusCode::BAD_GATEWAY, Json(serde_json::json!({ "error": xml_content(&text, "m:MessageText").unwrap_or_else(|| "ews_error".into()) }))));
    }
    Ok(text)
}

pub async fn create(Json(request): Json<CreateRequest>) -> Result<Json<serde_json::Value>, ApiError> {
    let result = app_lib::ews::ews_create_event(request.access_token, request.title, request.start, request.end, request.is_all_day, request.location, request.description, request.attendees, request.recurrence, request.online_meeting, request.refresh_token, request.sensitivity, request.availability).await
        .map_err(|error| (StatusCode::BAD_GATEWAY, Json(serde_json::json!({ "error": error }))))?;
    let (item_id, change_key) = result.split_once('|').unwrap_or((&result, ""));
    Ok(Json(serde_json::json!({ "itemId": item_id, "changeKey": change_key })))
}

pub async fn respond(Json(request): Json<RespondRequest>) -> Result<Json<serde_json::Value>, ApiError> {
    app_lib::ews::ews_respond_to_invitation(
        request.access_token, request.item_id, request.change_key,
        request.response_type, request.owner_email, request.body, request.respond_series,
    ).await.map_err(|error| (StatusCode::BAD_GATEWAY, Json(serde_json::json!({ "error": error }))))?;
    Ok(Json(serde_json::json!({ "ok": true })))
}

pub async fn update(Json(request): Json<UpdateRequest>) -> Result<Json<serde_json::Value>, ApiError> {
    app_lib::ews::ews_update_event(request.access_token, request.item_id, request.change_key, request.title, request.start, request.end, request.is_all_day, request.location, request.description, request.update_series, request.recurrence, request.original_start, request.attendees, request.sensitivity, request.availability).await
        .map_err(|error| (StatusCode::BAD_GATEWAY, Json(serde_json::json!({ "error": error }))))?;
    Ok(Json(serde_json::json!({ "ok": true })))
}

pub async fn delete(Json(request): Json<DeleteRequest>) -> Result<Json<serde_json::Value>, ApiError> {
    let target = if request.delete_series {
        format!(r#"<t:RecurringMasterItemId OccurrenceId="{}" ChangeKey="{}"/>"#, escape(&request.item_id), escape(&request.change_key))
    } else {
        format!(r#"<t:ItemId Id="{}" ChangeKey="{}"/>"#, escape(&request.item_id), escape(&request.change_key))
    };
    let mode = if request.send_cancellations { "SendToAllAndSaveCopy" } else { "SendToNone" };
    let body = format!(r#"<m:DeleteItem DeleteType="MoveToDeletedItems" SendMeetingCancellations="{mode}"><m:ItemIds>{target}</m:ItemIds></m:DeleteItem>"#);
    send(&request.access_token, &body, None).await?;
    Ok(Json(serde_json::json!({ "ok": true })))
}

pub async fn cancel(Json(request): Json<CancelRequest>) -> Result<Json<serde_json::Value>, ApiError> {
    let (item_id, change_key) = if request.cancel_series {
        let lookup = format!(r#"<m:GetItem><m:ItemShape><t:BaseShape>IdOnly</t:BaseShape></m:ItemShape><m:ItemIds><t:RecurringMasterItemId OccurrenceId="{}" ChangeKey="{}"/></m:ItemIds></m:GetItem>"#, escape(&request.item_id), escape(&request.change_key));
        let xml = send(&request.access_token, &lookup, None).await?;
        let element = xml.find("<t:ItemId ").and_then(|start| xml[start..].find("/>").map(|end| &xml[start..start + end])).ok_or_else(|| (StatusCode::BAD_GATEWAY, Json(serde_json::json!({ "error": "ews_master_id_missing" }))))?;
        (xml_attr(element, "Id").unwrap_or_default(), xml_attr(element, "ChangeKey").unwrap_or_default())
    } else { (request.item_id, request.change_key) };
    let body = format!(r#"<m:CreateItem MessageDisposition="SendAndSaveCopy"><m:Items><t:CancelCalendarItem><t:ReferenceItemId Id="{}" ChangeKey="{}"/></t:CancelCalendarItem></m:Items></m:CreateItem>"#, escape(&item_id), escape(&change_key));
    send(&request.access_token, &body, None).await?;
    Ok(Json(serde_json::json!({ "ok": true })))
}

pub async fn list(Json(request): Json<ListRequest>) -> Result<Json<Vec<app_lib::ews::EwsEvent>>, ApiError> {
    app_lib::ews::ews_get_calendar_events(request.access_token, request.owner_email, request.start, request.end, request.folder_id, request.shared_mailbox).await.map(Json)
        .map_err(|error| (StatusCode::BAD_GATEWAY, Json(serde_json::json!({ "error": error }))))
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SharedRequest { access_token: String, email: String }
pub async fn shared(Json(request): Json<SharedRequest>) -> Result<Json<app_lib::ews::SharedCalendarFolders>, ApiError> {
    app_lib::ews::ews_shared_calendars(request.access_token, request.email).await.map(Json)
        .map_err(|error| (StatusCode::BAD_GATEWAY, Json(serde_json::json!({ "error": error }))))
}

pub async fn free_busy(Json(request): Json<FreeBusyRequest>) -> Result<Json<HashMap<String, Vec<app_lib::ews::EwsFreeBusySlot>>>, ApiError> {
    app_lib::ews::ews_get_free_busy_ews(request.refresh_token, request.emails, request.start, request.end, request.anchor_mailbox).await.map(Json)
        .map_err(|error| (StatusCode::BAD_GATEWAY, Json(serde_json::json!({ "error": error }))))
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RecurrenceRequest { access_token: String, item_id: String }
pub async fn recurrence(Json(request): Json<RecurrenceRequest>) -> Result<Json<Option<String>>, ApiError> {
    app_lib::ews::recurrence::get_recurrence(request.access_token, request.item_id).await.map(Json)
        .map_err(|error| (StatusCode::BAD_GATEWAY, Json(serde_json::json!({ "error": error }))))
}
