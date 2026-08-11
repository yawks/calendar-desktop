use axum::{http::StatusCode, Json};
use serde::{Deserialize, Serialize};
use std::collections::HashMap;

const EWS_ENDPOINT: &str = "https://outlook.office365.com/EWS/Exchange.asmx";

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CreateRequest {
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
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UpdateRequest {
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
pub struct ListRequest { access_token: String, owner_email: Option<String>, start: String, end: String }

#[derive(Serialize)]
pub struct EwsAttendee { name: Option<String>, email: String, response_type: String }

#[derive(Serialize)]
pub struct EwsEvent {
    item_id: String, change_key: String, subject: String, start: String, end: String,
    is_all_day: bool, location: Option<String>, organizer_name: Option<String>, organizer_email: Option<String>,
    my_response_type: String, attendees: Vec<EwsAttendee>, is_meeting: bool, is_cancelled: bool,
    recurring_master_id: Option<String>, body: Option<String>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FreeBusyRequest { refresh_token: String, emails: Vec<String>, start: String, end: String }

#[derive(Serialize)]
pub struct FreeBusySlot { start: String, end: String, busy_type: String }

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

fn xml_all(xml: &str, tag: &str) -> Vec<String> {
    let open = format!("<{tag}");
    let close = format!("</{tag}>");
    let mut values = Vec::new();
    let mut offset = 0;
    while let Some(relative) = xml[offset..].find(&open) {
        let start = offset + relative;
        let Some(gt) = xml[start..].find('>').map(|value| start + value + 1) else { break };
        let Some(end) = xml[gt..].find(&close).map(|value| gt + value + close.len()) else { break };
        values.push(xml[start..end].to_string());
        offset = end;
    }
    values
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
    let attendees: String = request.attendees.unwrap_or_default().into_iter().map(|email|
        format!("<t:Attendee><t:Mailbox><t:EmailAddress>{}</t:EmailAddress></t:Mailbox></t:Attendee>", escape(&email))
    ).collect();
    let attendees_block = if attendees.is_empty() { String::new() } else { format!("<t:RequiredAttendees>{attendees}</t:RequiredAttendees>") };
    let send_mode = if attendees.is_empty() { "SendToNone" } else { "SendToAllAndSaveCopy" };
    let location = request.location.filter(|v| !v.is_empty()).map(|v| format!("<t:Location>{}</t:Location>", escape(&v))).unwrap_or_default();
    let description = request.description.filter(|v| !v.is_empty()).map(|v| format!(r#"<t:Body BodyType="HTML">{}</t:Body>"#, escape(&v))).unwrap_or_default();
    let body = format!(r#"<m:CreateItem SendMeetingInvitations="{send_mode}"><m:Items><t:CalendarItem><t:Subject>{}</t:Subject>{description}<t:Start>{}</t:Start><t:End>{}</t:End><t:IsAllDayEvent>{}</t:IsAllDayEvent>{location}{attendees_block}</t:CalendarItem></m:Items></m:CreateItem>"#, escape(&request.title), escape(&request.start), escape(&request.end), request.is_all_day);
    let xml = send(&request.access_token, &body, None).await?;
    let element = xml.find("<t:ItemId ").and_then(|start| xml[start..].find("/>").map(|end| &xml[start..start + end])).ok_or_else(|| (StatusCode::BAD_GATEWAY, Json(serde_json::json!({ "error": "ews_item_id_missing" }))))?;
    Ok(Json(serde_json::json!({ "itemId": xml_attr(element, "Id").unwrap_or_default(), "changeKey": xml_attr(element, "ChangeKey").unwrap_or_default() })))
}

pub async fn respond(Json(request): Json<RespondRequest>) -> Result<Json<serde_json::Value>, ApiError> {
    let element = match request.response_type.as_str() { "accept" => "AcceptItem", "decline" => "DeclineItem", "tentative" => "TentativelyAcceptItem", _ => return Err((StatusCode::BAD_REQUEST, Json(serde_json::json!({ "error": "invalid_response_type" })))) };
    let comment = request.body.filter(|v| !v.is_empty()).map(|v| format!(r#"<t:Body BodyType="Text">{}</t:Body>"#, escape(&v))).unwrap_or_default();
    let body = format!(r#"<m:CreateItem MessageDisposition="SendAndSaveCopy"><m:Items><t:{element}>{comment}<t:ReferenceItemId Id="{}" ChangeKey="{}"/></t:{element}></m:Items></m:CreateItem>"#, escape(&request.item_id), escape(&request.change_key));
    send(&request.access_token, &body, Some(&request.owner_email)).await?;
    Ok(Json(serde_json::json!({ "ok": true })))
}

pub async fn update(Json(request): Json<UpdateRequest>) -> Result<Json<serde_json::Value>, ApiError> {
    fn field(uri: &str, element: &str, value: &str) -> String {
        format!(r#"<t:SetItemField><t:FieldURI FieldURI="{uri}"/><t:CalendarItem><{element}>{value}</{element}></t:CalendarItem></t:SetItemField>"#)
    }
    let mut updates = vec![
        field("item:Subject", "t:Subject", &escape(&request.title)),
        field("calendar:Start", "t:Start", &escape(&request.start)),
        field("calendar:End", "t:End", &escape(&request.end)),
        field("calendar:IsAllDayEvent", "t:IsAllDayEvent", if request.is_all_day { "true" } else { "false" }),
    ];
    if let Some(value) = request.location.filter(|v| !v.is_empty()) { updates.push(field("calendar:Location", "t:Location", &escape(&value))); }
    if let Some(value) = request.description.filter(|v| !v.is_empty()) {
        updates.push(format!(r#"<t:SetItemField><t:FieldURI FieldURI="item:Body"/><t:CalendarItem><t:Body BodyType="HTML">{}</t:Body></t:CalendarItem></t:SetItemField>"#, escape(&value)));
    }
    let target = if request.update_series {
        format!(r#"<t:RecurringMasterItemId OccurrenceId="{}" ChangeKey="{}"/>"#, escape(&request.item_id), escape(&request.change_key))
    } else {
        format!(r#"<t:ItemId Id="{}" ChangeKey="{}"/>"#, escape(&request.item_id), escape(&request.change_key))
    };
    let body = format!(r#"<m:UpdateItem MessageDisposition="SaveOnly" ConflictResolution="AutoResolve" SendMeetingInvitationsOrCancellations="SendToAllAndSaveCopy"><m:ItemChanges><t:ItemChange>{target}<t:Updates>{}</t:Updates></t:ItemChange></m:ItemChanges></m:UpdateItem>"#, updates.join(""));
    send(&request.access_token, &body, None).await?;
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

pub async fn list(Json(request): Json<ListRequest>) -> Result<Json<Vec<EwsEvent>>, ApiError> {
    let body = format!(r#"<m:FindItem Traversal="Shallow"><m:ItemShape><t:BaseShape>AllProperties</t:BaseShape></m:ItemShape><m:CalendarView MaxEntriesReturned="500" StartDate="{}" EndDate="{}"/><m:ParentFolderIds><t:DistinguishedFolderId Id="calendar"/></m:ParentFolderIds></m:FindItem>"#, escape(&request.start), escape(&request.end));
    let xml = send(&request.access_token, &body, request.owner_email.as_deref().filter(|value| !value.is_empty())).await?;
    let mut events = Vec::new();
    for item in xml_all(&xml, "t:CalendarItem") {
        let Some(id_element) = item.find("<t:ItemId ").and_then(|start| item[start..].find("/>").map(|end| &item[start..start + end])) else { continue };
        let item_id = xml_attr(id_element, "Id").unwrap_or_default();
        let organizer = xml_content(&item, "t:Organizer");
        let mut attendees = Vec::new();
        for list_tag in ["t:RequiredAttendees", "t:OptionalAttendees"] {
            if let Some(list) = xml_content(&item, list_tag) {
                for attendee in xml_all(&list, "t:Attendee") {
                    attendees.push(EwsAttendee {
                        name: xml_content(&attendee, "t:Name").filter(|value| !value.is_empty()),
                        email: xml_content(&attendee, "t:EmailAddress").unwrap_or_default(),
                        response_type: xml_content(&attendee, "t:ResponseType").unwrap_or_else(|| "Unknown".into()),
                    });
                }
            }
        }
        let item_type = xml_content(&item, "t:CalendarItemType").unwrap_or_default();
        events.push(EwsEvent {
            item_id: item_id.clone(), change_key: xml_attr(id_element, "ChangeKey").unwrap_or_default(),
            subject: xml_content(&item, "t:Subject").unwrap_or_default(), start: xml_content(&item, "t:Start").unwrap_or_default(), end: xml_content(&item, "t:End").unwrap_or_default(),
            is_all_day: xml_content(&item, "t:IsAllDayEvent").as_deref() == Some("true"), location: xml_content(&item, "t:Location").filter(|value| !value.is_empty()),
            organizer_name: organizer.as_deref().and_then(|value| xml_content(value, "t:Name")), organizer_email: organizer.as_deref().and_then(|value| xml_content(value, "t:EmailAddress")),
            my_response_type: xml_content(&item, "t:MyResponseType").unwrap_or_else(|| "Unknown".into()), attendees,
            is_meeting: xml_content(&item, "t:IsMeeting").as_deref() == Some("true"), is_cancelled: xml_content(&item, "t:IsCancelled").as_deref() == Some("true"),
            recurring_master_id: matches!(item_type.as_str(), "Occurrence" | "Exception").then_some(item_id), body: xml_content(&item, "t:Body"),
        });
    }
    Ok(Json(events))
}

pub async fn free_busy(Json(request): Json<FreeBusyRequest>) -> Result<Json<HashMap<String, Vec<FreeBusySlot>>>, ApiError> {
    let client_id = std::env::var("COURRIER_MICROSOFT_CLIENT_ID").unwrap_or_else(|_| "d3590ed6-52b3-4102-aeff-aad2292ab01c".into());
    let token_body = format!("client_id={client_id}&grant_type=refresh_token&refresh_token={}&scope={}", urlencoding::encode(&request.refresh_token), urlencoding::encode("https://graph.microsoft.com/Calendars.Read offline_access"));
    let token_response: serde_json::Value = reqwest::Client::new().post("https://login.microsoftonline.com/common/oauth2/v2.0/token")
        .header("content-type", "application/x-www-form-urlencoded").body(token_body).send().await
        .map_err(|error| (StatusCode::BAD_GATEWAY, Json(serde_json::json!({ "error": error.to_string() }))))?.json().await
        .map_err(|error| (StatusCode::BAD_GATEWAY, Json(serde_json::json!({ "error": error.to_string() }))))?;
    let token = token_response["access_token"].as_str().ok_or_else(|| (StatusCode::UNAUTHORIZED, Json(serde_json::json!({ "error": "graph_token_failed" }))))?;
    let graph_body = serde_json::json!({
        "schedules": request.emails, "startTime": { "dateTime": request.start, "timeZone": "UTC" },
        "endTime": { "dateTime": request.end, "timeZone": "UTC" }, "availabilityViewInterval": 15
    });
    let response = reqwest::Client::new().post("https://graph.microsoft.com/v1.0/me/calendar/getSchedule")
        .bearer_auth(token).json(&graph_body).send().await
        .map_err(|error| (StatusCode::BAD_GATEWAY, Json(serde_json::json!({ "error": error.to_string() }))))?;
    if !response.status().is_success() { return Err((StatusCode::BAD_GATEWAY, Json(serde_json::json!({ "error": "graph_schedule_failed" })))); }
    let value: serde_json::Value = response.json().await.map_err(|error| (StatusCode::BAD_GATEWAY, Json(serde_json::json!({ "error": error.to_string() }))))?;
    let mut result: HashMap<String, Vec<FreeBusySlot>> = request.emails.iter().cloned().map(|email| (email, Vec::new())).collect();
    for schedule in value["value"].as_array().into_iter().flatten() {
        let schedule_id = schedule["scheduleId"].as_str().unwrap_or_default();
        let Some(email) = request.emails.iter().find(|email| email.eq_ignore_ascii_case(schedule_id)).cloned() else { continue };
        let slots = schedule["scheduleItems"].as_array().into_iter().flatten().filter_map(|item| {
            let status = item["status"].as_str()?;
            let busy_type = match status { "tentative" => "Tentative", "oof" => "OOF", "busy" => "Busy", _ => return None };
            Some(FreeBusySlot { start: item["start"]["dateTime"].as_str().unwrap_or_default().into(), end: item["end"]["dateTime"].as_str().unwrap_or_default().into(), busy_type: busy_type.into() })
        }).collect();
        result.insert(email, slots);
    }
    Ok(Json(result))
}
