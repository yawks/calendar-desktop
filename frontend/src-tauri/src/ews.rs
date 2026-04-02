use serde::{Deserialize, Serialize};
use tauri::command;

const CLIENT_ID: &str = "d3590ed6-52b3-4102-aeff-aad2292ab01c";
const EWS_SCOPE: &str = "https://outlook.office.com/EWS.AccessAsUser.All offline_access";
const EWS_ENDPOINT: &str = "https://outlook.office365.com/EWS/Exchange.asmx";
const TOKEN_ENDPOINT: &str = "https://login.microsoftonline.com/common/oauth2/v2.0/token";
const DEVICE_CODE_ENDPOINT: &str =
    "https://login.microsoftonline.com/common/oauth2/v2.0/devicecode";

// ── Auth structures ────────────────────────────────────────────────────────────

#[derive(Serialize, Deserialize, Debug)]
pub struct DeviceAuthResponse {
    pub device_code: String,
    pub user_code: String,
    pub verification_uri: String,
    pub expires_in: u64,
    pub interval: u64,
    pub message: String,
}

#[derive(Serialize, Deserialize, Debug)]
pub struct TokenResponse {
    pub access_token: String,
    pub refresh_token: Option<String>,
    pub expires_in: u64,
}

// ── Event structures ───────────────────────────────────────────────────────────

#[derive(Serialize, Debug, Clone)]
pub struct EwsAttendee {
    pub name: Option<String>,
    pub email: String,
    pub response_type: String,
}

#[derive(Serialize, Debug)]
pub struct EwsEvent {
    pub item_id: String,
    pub change_key: String,
    pub subject: String,
    pub start: String,
    pub end: String,
    pub is_all_day: bool,
    pub location: Option<String>,
    pub organizer_name: Option<String>,
    pub organizer_email: Option<String>,
    pub my_response_type: String,
    pub attendees: Vec<EwsAttendee>,
    pub is_meeting: bool,
    /// RecurringMasterId — shared by all occurrences of the same recurring series.
    pub recurring_master_id: Option<String>,
}

// ── Auth commands ──────────────────────────────────────────────────────────────

#[command]
pub async fn ews_start_device_auth() -> Result<DeviceAuthResponse, String> {
    let client = reqwest::Client::new();
    let body = format!(
        "client_id={}&scope={}",
        CLIENT_ID,
        urlencoding::encode(EWS_SCOPE)
    );

    let response = client
        .post(DEVICE_CODE_ENDPOINT)
        .header("Content-Type", "application/x-www-form-urlencoded")
        .body(body)
        .send()
        .await
        .map_err(|e| e.to_string())?;

    let json: serde_json::Value = response.json().await.map_err(|e| e.to_string())?;

    if let Some(error) = json.get("error") {
        return Err(json
            .get("error_description")
            .and_then(|e| e.as_str())
            .unwrap_or_else(|| error.as_str().unwrap_or("Unknown error"))
            .to_string());
    }

    Ok(DeviceAuthResponse {
        device_code: json["device_code"].as_str().unwrap_or("").to_string(),
        user_code: json["user_code"].as_str().unwrap_or("").to_string(),
        verification_uri: json["verification_uri"].as_str().unwrap_or("").to_string(),
        expires_in: json["expires_in"].as_u64().unwrap_or(900),
        interval: json["interval"].as_u64().unwrap_or(5),
        message: json["message"].as_str().unwrap_or("").to_string(),
    })
}

/// Poll after the user has authenticated in the browser.
/// Returns Err("authorization_pending") if the user hasn't confirmed yet — the
/// frontend should keep polling at the indicated interval.
#[command]
pub async fn ews_poll_device_token(device_code: String) -> Result<TokenResponse, String> {
    let client = reqwest::Client::new();
    let body = format!(
        "client_id={}&grant_type=urn:ietf:params:oauth:grant-type:device_code&device_code={}",
        CLIENT_ID,
        urlencoding::encode(&device_code)
    );

    let response = client
        .post(TOKEN_ENDPOINT)
        .header("Content-Type", "application/x-www-form-urlencoded")
        .body(body)
        .send()
        .await
        .map_err(|e| e.to_string())?;

    let json: serde_json::Value = response.json().await.map_err(|e| e.to_string())?;

    if let Some(error) = json.get("error").and_then(|e| e.as_str()) {
        // "authorization_pending" means the user hasn't clicked through yet
        return Err(error.to_string());
    }

    Ok(TokenResponse {
        access_token: json["access_token"].as_str().unwrap_or("").to_string(),
        refresh_token: json["refresh_token"].as_str().map(|s| s.to_string()),
        expires_in: json["expires_in"].as_u64().unwrap_or(3600),
    })
}

/// Exchange a refresh token for a new access token.
#[command]
pub async fn ews_refresh_access_token(refresh_token: String) -> Result<TokenResponse, String> {
    let client = reqwest::Client::new();
    let body = format!(
        "client_id={}&grant_type=refresh_token&refresh_token={}&scope={}",
        CLIENT_ID,
        urlencoding::encode(&refresh_token),
        urlencoding::encode(EWS_SCOPE)
    );

    let response = client
        .post(TOKEN_ENDPOINT)
        .header("Content-Type", "application/x-www-form-urlencoded")
        .body(body)
        .send()
        .await
        .map_err(|e| e.to_string())?;

    let json: serde_json::Value = response.json().await.map_err(|e| e.to_string())?;

    if let Some(error) = json.get("error").and_then(|e| e.as_str()) {
        let desc = json
            .get("error_description")
            .and_then(|e| e.as_str())
            .unwrap_or("");
        return Err(format!("{}: {}", error, desc));
    }

    Ok(TokenResponse {
        access_token: json["access_token"].as_str().unwrap_or("").to_string(),
        refresh_token: json["refresh_token"].as_str().map(|s| s.to_string()),
        expires_in: json["expires_in"].as_u64().unwrap_or(3600),
    })
}

// ── Calendar commands ──────────────────────────────────────────────────────────

/// Fetch calendar events in the given date range.
/// `start` and `end` must be ISO 8601 strings (e.g. "2026-03-01T00:00:00Z").
#[command]
pub async fn ews_get_calendar_events(
    access_token: String,
    start: String,
    end: String,
) -> Result<Vec<EwsEvent>, String> {
    let soap_body = format!(
        r#"<m:FindItem Traversal="Shallow">
  <m:ItemShape>
    <t:BaseShape>AllProperties</t:BaseShape>
  </m:ItemShape>
  <m:CalendarView MaxEntriesReturned="500" StartDate="{}" EndDate="{}"/>
  <m:ParentFolderIds>
    <t:DistinguishedFolderId Id="calendar"/>
  </m:ParentFolderIds>
</m:FindItem>"#,
        start, end
    );

    let xml = send_ews_request(&access_token, &soap_body, None).await?;
    let mut events = parse_calendar_events(&xml)?;

    // Batch GetItem for ALL events: fetches attendees (for meetings) and
    // CleanGlobalObjectId (same for all occurrences of a recurring series).
    let all_ids: Vec<(String, String)> = events
        .iter()
        .map(|e| (e.item_id.clone(), e.change_key.clone()))
        .collect();

    // EWS supports up to 100 items per GetItem request — process in chunks.
    for chunk in all_ids.chunks(100) {
        let item_ids_xml: String = chunk
            .iter()
            .map(|(id, ck)| format!(r#"<t:ItemId Id="{}" ChangeKey="{}"/>"#, id, ck))
            .collect::<Vec<_>>()
            .join("\n    ");

        let get_body = format!(
            r#"<m:GetItem>
  <m:ItemShape>
    <t:BaseShape>AllProperties</t:BaseShape>
    <t:AdditionalProperties>
      <t:ExtendedFieldURI PropertySetId="6ED8DA90-450B-101B-98DA-00AA003F1305" PropertyId="35" PropertyType="Binary"/>
    </t:AdditionalProperties>
  </m:ItemShape>
  <m:ItemIds>
    {}
  </m:ItemIds>
</m:GetItem>"#,
            item_ids_xml
        );

        if let Ok(details_xml) = send_ews_request(&access_token, &get_body, None).await {
            let detailed = parse_get_item_response(&details_xml);
            for event in events.iter_mut() {
                if let Some(detail) = detailed.iter().find(|d| d.item_id == event.item_id) {
                    event.recurring_master_id = detail.clean_global_object_id.clone();
                    if event.is_meeting {
                        event.attendees = detail.attendees.clone();
                        if event.organizer_email.is_none() {
                            event.organizer_email = detail.organizer_email.clone();
                            event.organizer_name = detail.organizer_name.clone();
                        }
                    }
                }
            }
        }
    }

    Ok(events)
}

/// Create a new calendar event. Returns `"item_id|change_key"`.
#[command]
pub async fn ews_create_event(
    access_token: String,
    title: String,
    start: String,
    end: String,
    is_all_day: bool,
    location: Option<String>,
    description: Option<String>,
    attendees: Option<Vec<String>>, // list of email addresses
) -> Result<String, String> {
    let location_xml = location
        .filter(|s| !s.is_empty())
        .map(|s| format!("<t:Location>{}</t:Location>", s))
        .unwrap_or_default();

    let body_xml = description
        .filter(|s| !s.is_empty())
        .map(|s| format!(r#"<t:Body BodyType="Text">{}</t:Body>"#, s))
        .unwrap_or_default();

    let attendees_xml = attendees
        .unwrap_or_default()
        .iter()
        .map(|email| format!(
            "<t:Attendee><t:Mailbox><t:EmailAddress>{}</t:EmailAddress></t:Mailbox></t:Attendee>",
            email
        ))
        .collect::<Vec<_>>()
        .join("\n");
    let attendees_block = if attendees_xml.is_empty() {
        String::new()
    } else {
        format!("<t:RequiredAttendees>{}</t:RequiredAttendees>", attendees_xml)
    };

    let invitations_attr = if attendees_xml.is_empty() {
        "SendToNone"
    } else {
        "SendToAllAndSaveCopy"
    };

    let soap_body = format!(
        r#"<m:CreateItem SendMeetingInvitations="{invitations_attr}">
  <m:Items>
    <t:CalendarItem>
      <t:Subject>{title}</t:Subject>
      {body_xml}
      <t:Start>{start}</t:Start>
      <t:End>{end}</t:End>
      <t:IsAllDayEvent>{is_all_day}</t:IsAllDayEvent>
      {location_xml}
      {attendees_block}
    </t:CalendarItem>
  </m:Items>
</m:CreateItem>"#,
        invitations_attr = invitations_attr,
        title = title,
        body_xml = body_xml,
        start = start,
        end = end,
        is_all_day = is_all_day,
        location_xml = location_xml,
        attendees_block = attendees_block,
    );

    let xml = send_ews_request(&access_token, &soap_body, None).await?;

    if xml.contains("ResponseClass=\"Error\"") {
        let msg = xml_content(&xml, "m:MessageText")
            .unwrap_or_else(|| "EWS create error".to_string());
        return Err(msg);
    }

    // Extract the returned ItemId
    let item_id_str = xml
        .find("<t:ItemId ")
        .and_then(|s| xml[s..].find("/>").map(|e| &xml[s..s + e]));

    match item_id_str {
        Some(elem) => {
            let id = xml_attr(elem, "Id").unwrap_or_default();
            let ck = xml_attr(elem, "ChangeKey").unwrap_or_default();
            Ok(format!("{}|{}", id, ck))
        }
        None => Err("Could not find ItemId in CreateItem response".to_string()),
    }
}

/// Update an existing calendar event.
#[command]
pub async fn ews_update_event(
    access_token: String,
    item_id: String,
    change_key: String,
    title: String,
    start: String,
    end: String,
    is_all_day: bool,
    location: Option<String>,
    description: Option<String>,
) -> Result<(), String> {
    fn set_field(field_uri: &str, element: &str, value: &str) -> String {
        format!(
            r#"<t:SetItemField>
  <t:FieldURI FieldURI="{field_uri}"/>
  <t:CalendarItem><{element}>{value}</{element}></t:CalendarItem>
</t:SetItemField>"#,
            field_uri = field_uri,
            element = element,
            value = value
        )
    }

    let mut updates = vec![
        set_field("item:Subject", "t:Subject", &title),
        set_field("calendar:Start", "t:Start", &start),
        set_field("calendar:End", "t:End", &end),
        set_field(
            "calendar:IsAllDayEvent",
            "t:IsAllDayEvent",
            if is_all_day { "true" } else { "false" },
        ),
    ];

    if let Some(loc) = location.filter(|s| !s.is_empty()) {
        updates.push(set_field("calendar:Location", "t:Location", &loc));
    }
    if let Some(desc) = description.filter(|s| !s.is_empty()) {
        updates.push(format!(
            r#"<t:SetItemField>
  <t:FieldURI FieldURI="item:Body"/>
  <t:CalendarItem><t:Body BodyType="Text">{}</t:Body></t:CalendarItem>
</t:SetItemField>"#,
            desc
        ));
    }

    let soap_body = format!(
        r#"<m:UpdateItem MessageDisposition="SaveOnly" ConflictResolution="AutoResolve" SendMeetingInvitationsOrCancellations="SendToAllAndSaveCopy">
  <m:ItemChanges>
    <t:ItemChange>
      <t:ItemId Id="{item_id}" ChangeKey="{change_key}"/>
      <t:Updates>
        {updates}
      </t:Updates>
    </t:ItemChange>
  </m:ItemChanges>
</m:UpdateItem>"#,
        item_id = item_id,
        change_key = change_key,
        updates = updates.join("\n"),
    );

    let xml = send_ews_request(&access_token, &soap_body, None).await?;

    if xml.contains("ResponseClass=\"Error\"") {
        let msg = xml_content(&xml, "m:MessageText")
            .unwrap_or_else(|| "EWS update error".to_string());
        return Err(msg);
    }
    Ok(())
}

/// Delete a calendar event.
#[command]
pub async fn ews_delete_event(
    access_token: String,
    item_id: String,
    change_key: String,
) -> Result<(), String> {
    let soap_body = format!(
        r#"<m:DeleteItem DeleteType="MoveToDeletedItems" SendMeetingCancellations="SendToAllAndSaveCopy">
  <m:ItemIds>
    <t:ItemId Id="{}" ChangeKey="{}"/>
  </m:ItemIds>
</m:DeleteItem>"#,
        item_id, change_key
    );

    let xml = send_ews_request(&access_token, &soap_body, None).await?;

    if xml.contains("ResponseClass=\"Error\"") {
        let msg = xml_content(&xml, "m:MessageText")
            .unwrap_or_else(|| "EWS delete error".to_string());
        return Err(msg);
    }
    Ok(())
}

/// Free/busy slot returned by Graph API getSchedule.
#[derive(Serialize, Debug)]
pub struct EwsFreeBusySlot {
    pub start: String,
    pub end: String,
    pub busy_type: String, // "Busy" | "Tentative" | "OOF"
}

/// Query free/busy via Microsoft Graph API getSchedule.
/// Uses the EWS refresh token to obtain a Graph API access token on-the-fly.
/// `start` and `end` must be ISO 8601 strings without timezone (e.g. "2026-04-01T00:00:00").
#[command]
pub async fn ews_get_free_busy(
    refresh_token: String,
    emails: Vec<String>,
    start: String,
    end: String,
) -> Result<std::collections::HashMap<String, Vec<EwsFreeBusySlot>>, String> {
    // Exchange the EWS refresh token for a Graph API access token
    let graph_token = get_graph_token(&refresh_token).await?;

    let client = reqwest::Client::new();
    let body = serde_json::json!({
        "schedules": &emails,
        "startTime": { "dateTime": start, "timeZone": "UTC" },
        "endTime":   { "dateTime": end,   "timeZone": "UTC" },
        "availabilityViewInterval": 15,
    });

    let response = client
        .post("https://graph.microsoft.com/v1.0/me/calendar/getSchedule")
        .header("Authorization", format!("Bearer {}", graph_token))
        .json(&body)
        .send()
        .await
        .map_err(|e| e.to_string())?;

    if !response.status().is_success() {
        let text = response.text().await.unwrap_or_default();
        return Err(format!("Graph getSchedule error: {}", text));
    }

    let json: serde_json::Value = response.json().await.map_err(|e| e.to_string())?;

    let mut result: std::collections::HashMap<String, Vec<EwsFreeBusySlot>> =
        std::collections::HashMap::new();
    for email in &emails {
        result.insert(email.clone(), Vec::new());
    }

    if let Some(schedules) = json["value"].as_array() {
        for schedule in schedules {
            let schedule_id = schedule["scheduleId"].as_str().unwrap_or("").to_lowercase();
            let matched = emails.iter().find(|e| e.to_lowercase() == schedule_id).cloned();
            if let Some(email) = matched {
                let mut slots = Vec::new();
                if let Some(items) = schedule["scheduleItems"].as_array() {
                    for item in items {
                        let status = item["status"].as_str().unwrap_or("free");
                        if status == "free" || status == "workingElsewhere" { continue; }
                        let busy_type = match status {
                            "tentative" => "Tentative",
                            "oof"       => "OOF",
                            _           => "Busy",
                        };
                        let s = item["start"]["dateTime"].as_str().unwrap_or("").to_string();
                        let e = item["end"]["dateTime"].as_str().unwrap_or("").to_string();
                        slots.push(EwsFreeBusySlot { start: s, end: e, busy_type: busy_type.to_string() });
                    }
                }
                result.insert(email, slots);
            }
        }
    }

    Ok(result)
}

#[command]
pub async fn ews_get_free_busy_ews(
    refresh_token: String,
    emails: Vec<String>,
    start: String,
    end: String,
    anchor_mailbox: Option<String>,
) -> Result<std::collections::HashMap<String, Vec<EwsFreeBusySlot>>, String> {
    let token_response = ews_refresh_access_token(refresh_token).await?;
    let access_token = token_response.access_token;

    let normalized = |t: &str| {
        if t.ends_with('Z') || t.ends_with('z') || t.contains('+') {
            t.to_string()
        } else {
            format!("{}Z", t)
        }
    };

    let start_time = normalized(&start);
    let end_time = normalized(&end);

    let mailbox_data = emails
        .iter()
        .map(|email| {
            format!(
                r#"<t:MailboxData>
  <t:Email><t:Address>{}</t:Address></t:Email>
  <t:AttendeeType>Required</t:AttendeeType>
  <t:ExcludeConflicts>false</t:ExcludeConflicts>
</t:MailboxData>"#,
                email
            )
        })
        .collect::<Vec<_>>()
        .join("\n");

    let soap_body = format!(
        r#"<m:GetUserAvailabilityRequest>
  <t:TimeZone>
    <t:Bias>0</t:Bias>
  </t:TimeZone>
  <m:MailboxDataArray>
    {mailbox_data}
  </m:MailboxDataArray>
  <t:FreeBusyViewOptions>
    <t:TimeWindow>
      <t:StartTime>{start_time}</t:StartTime>
      <t:EndTime>{end_time}</t:EndTime>
    </t:TimeWindow>
    <t:RequestedView>Detailed</t:RequestedView>
  </t:FreeBusyViewOptions>
</m:GetUserAvailabilityRequest>"#,
        mailbox_data = mailbox_data,
        start_time = start_time,
        end_time = end_time,
    );

    let anchor_mailbox = anchor_mailbox
        .as_deref()
        .or_else(|| emails.first().map(|s| s.as_str()));
    let xml = send_ews_request(&access_token, &soap_body, anchor_mailbox).await?;

    if xml.contains("ResponseClass=\"Error\"") {
        let msg = xml_content(&xml, "m:MessageText")
            .unwrap_or_else(|| "EWS free/busy error".to_string());
        return Err(msg);
    }

    let mut result = std::collections::HashMap::new();
    for email in &emails {
        result.insert(email.clone(), Vec::new());
    }

    let freebusy_responses = xml_all_ns(&xml, "m:FreeBusyResponse");
    for (idx, freebusy_response) in freebusy_responses.iter().enumerate() {
        let email = emails
            .get(idx)
            .cloned()
            .unwrap_or_else(|| format!("unknown-{}", idx));

        let mut slots = Vec::new();

        if !freebusy_response.contains("ResponseClass=\"Success\"") {
            result.insert(email, slots);
            continue;
        }

        let events = xml_all_ns(freebusy_response, "t:CalendarEvent");
        for event_xml in events {
            let st = xml_content_ns(&event_xml, "t:StartTime").unwrap_or_default();
            let en = xml_content_ns(&event_xml, "t:EndTime").unwrap_or_default();
            let busy_type = xml_content_ns(&event_xml, "t:BusyType").unwrap_or_default();

            let busy_type = match busy_type.as_str() {
                "Tentative" => "Tentative",
                "OOF" => "OOF",
                "Busy" | "WorkingElsewhere" => "Busy",
                _ => continue,
            }
            .to_string();

            slots.push(EwsFreeBusySlot {
                start: st,
                end: en,
                busy_type,
            });
        }

        result.insert(email, slots);
    }

    Ok(result)
}

/// Exchange the EWS refresh token for a Microsoft Graph API access token.
async fn get_graph_token(refresh_token: &str) -> Result<String, String> {
    let client = reqwest::Client::new();
    let scope = urlencoding::encode("https://graph.microsoft.com/Calendars.Read offline_access");
    let body = format!(
        "client_id={}&grant_type=refresh_token&refresh_token={}&scope={}",
        CLIENT_ID,
        urlencoding::encode(refresh_token),
        scope,
    );
    let response = client
        .post(TOKEN_ENDPOINT)
        .header("Content-Type", "application/x-www-form-urlencoded")
        .body(body)
        .send()
        .await
        .map_err(|e| e.to_string())?;

    let json: serde_json::Value = response.json().await.map_err(|e| e.to_string())?;
    if let Some(err) = json.get("error").and_then(|e| e.as_str()) {
        let desc = json.get("error_description").and_then(|e| e.as_str()).unwrap_or("");
        return Err(format!("Graph token error: {}: {}", err, desc));
    }
    json["access_token"]
        .as_str()
        .map(|s| s.to_string())
        .ok_or_else(|| "No access_token in Graph token response".to_string())
}

/// Respond to a meeting invitation.
/// `response_type` must be "accept", "decline", or "tentative".
#[command]
pub async fn ews_respond_to_invitation(
    access_token: String,
    item_id: String,
    change_key: String,
    response_type: String,
) -> Result<(), String> {
    let element = match response_type.as_str() {
        "accept" => "AcceptItem",
        "decline" => "DeclineItem",
        "tentative" => "TentativelyAcceptItem",
        other => return Err(format!("Invalid response_type: {}", other)),
    };

    let soap_body = format!(
        r#"<m:CreateItem MessageDisposition="SendAndSaveCopy">
  <m:Items>
    <t:{element}>
      <t:ReferenceItemId Id="{item_id}" ChangeKey="{change_key}"/>
    </t:{element}>
  </m:Items>
</m:CreateItem>"#,
        element = element,
        item_id = item_id,
        change_key = change_key
    );

    let xml = send_ews_request(&access_token, &soap_body, None).await?;

    if xml.contains("ResponseClass=\"Error\"") {
        let msg = xml_content(&xml, "m:MessageText")
            .unwrap_or_else(|| "Unknown EWS error".to_string());
        return Err(msg);
    }

    Ok(())
}

// ── Internal helpers ───────────────────────────────────────────────────────────

fn soap_envelope(body: &str) -> String {
    format!(
        r#"<?xml version="1.0" encoding="utf-8"?>
<soap:Envelope xmlns:soap="http://schemas.xmlsoap.org/soap/envelope/"
               xmlns:t="http://schemas.microsoft.com/exchange/services/2006/types"
               xmlns:m="http://schemas.microsoft.com/exchange/services/2006/messages">
  <soap:Body>
    {}
  </soap:Body>
</soap:Envelope>"#,
        body
    )
}

async fn send_ews_request(
    access_token: &str,
    soap_body: &str,
    anchor_mailbox: Option<&str>,
) -> Result<String, String> {
    let client = reqwest::Client::new();
    let envelope = soap_envelope(soap_body);

    let mut request = client
        .post(EWS_ENDPOINT)
        .header("Authorization", format!("Bearer {}", access_token))
        .header("Content-Type", "text/xml; charset=utf-8");

    if let Some(mailbox) = anchor_mailbox {
        request = request.header("X-AnchorMailbox", mailbox);
    }

    let response = request
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
        return Err(format!("EWS HTTP {}: {}", status, body));
    }

    Ok(body)
}

/// Extract the text content of the first occurrence of `<tag>…</tag>`.
fn xml_content(xml: &str, tag: &str) -> Option<String> {
    let open_prefix = format!("<{}", tag);
    let close_tag = format!("</{}>", tag);

    let open_pos = xml.find(&open_prefix)?;
    let gt_pos = xml[open_pos..].find('>')? + open_pos + 1;
    let close_pos = xml[gt_pos..].find(&close_tag)? + gt_pos;

    Some(xml[gt_pos..close_pos].to_string())
}

fn xml_content_ns(xml: &str, tag: &str) -> Option<String> {
    if let Some(content) = xml_content(xml, tag) {
        return Some(content);
    }
    if let Some(colon) = tag.find(':') {
        return xml_content(xml, &tag[colon + 1..]);
    }
    xml_content(xml, &format!("t:{}", tag))
}

fn xml_all_ns(xml: &str, tag: &str) -> Vec<String> {
    let res = xml_all(xml, tag);
    if !res.is_empty() {
        return res;
    }
    if let Some(colon) = tag.find(':') {
        xml_all(xml, &tag[colon + 1..])
    } else {
        xml_all(xml, &format!("t:{}", tag))
    }
}

/// Extract the value of an XML attribute from an element string.
fn xml_attr(element: &str, attr: &str) -> Option<String> {
    let needle = format!("{}=\"", attr);
    let start = element.find(&needle)? + needle.len();
    let end = element[start..].find('"')? + start;
    Some(element[start..end].to_string())
}

/// Collect all occurrences of `<tag …>…</tag>` in `xml`.
fn xml_all(xml: &str, tag: &str) -> Vec<String> {
    let open_prefix = format!("<{}", tag);
    let close_tag = format!("</{}>", tag);
    let mut results = Vec::new();
    let mut pos = 0;

    while let Some(rel_start) = xml[pos..].find(&open_prefix) {
        let start = pos + rel_start;
        let gt = match xml[start..].find('>') {
            Some(i) => start + i + 1,
            None => break,
        };
        match xml[gt..].find(&close_tag) {
            Some(rel_end) => {
                let end = gt + rel_end + close_tag.len();
                results.push(xml[start..end].to_string());
                pos = end;
            }
            None => break,
        }
    }

    results
}

fn parse_calendar_events(xml: &str) -> Result<Vec<EwsEvent>, String> {
    // Surface EWS-level errors before trying to parse items
    if xml.contains("ResponseClass=\"Error\"") {
        let msg = xml_content(xml, "m:MessageText")
            .unwrap_or_else(|| "Unknown EWS error".to_string());
        return Err(msg);
    }

    let mut events = Vec::new();

    for item_xml in xml_all(xml, "t:CalendarItem") {
        // ItemId (self-closing tag: <t:ItemId Id="…" ChangeKey="…"/>)
        let item_id_str = item_xml
            .find("<t:ItemId ")
            .and_then(|s| item_xml[s..].find("/>").map(|e| &item_xml[s..s + e]));

        let (item_id, change_key) = match item_id_str {
            Some(elem) => (
                xml_attr(elem, "Id").unwrap_or_default(),
                xml_attr(elem, "ChangeKey").unwrap_or_default(),
            ),
            None => continue,
        };

        let subject = xml_content(&item_xml, "t:Subject").unwrap_or_default();
        let start = xml_content(&item_xml, "t:Start").unwrap_or_default();
        let end = xml_content(&item_xml, "t:End").unwrap_or_default();
        let is_all_day = xml_content(&item_xml, "t:IsAllDayEvent")
            .map(|v| v == "true")
            .unwrap_or(false);
        let is_meeting = xml_content(&item_xml, "t:IsMeeting")
            .map(|v| v == "true")
            .unwrap_or(false);
        let location = xml_content(&item_xml, "t:Location").filter(|s| !s.is_empty());
        let my_response_type = xml_content(&item_xml, "t:MyResponseType")
            .unwrap_or_else(|| "Unknown".to_string());

        // recurring_master_id is populated later via batch GetItem (CleanGlobalObjectId).
        let recurring_master_id: Option<String> = None;

        // Organizer is inside <t:Organizer><t:Mailbox>…</t:Mailbox></t:Organizer>
        let organizer_xml = xml_content(&item_xml, "t:Organizer");
        let organizer_name = organizer_xml
            .as_deref()
            .and_then(|o| xml_content(o, "t:Name"))
            .filter(|s| !s.is_empty());
        let organizer_email = organizer_xml
            .as_deref()
            .and_then(|o| xml_content(o, "t:EmailAddress"))
            .filter(|s| !s.is_empty());

        // Attendees
        let mut attendees: Vec<EwsAttendee> = Vec::new();

        for list_tag in &["t:RequiredAttendees", "t:OptionalAttendees"] {
            if let Some(list_xml) = xml_content(&item_xml, list_tag) {
                for att_xml in xml_all(&list_xml, "t:Attendee") {
                    let routing_type = xml_content(&att_xml, "t:RoutingType")
                        .unwrap_or_default();
                    let email = if routing_type.eq_ignore_ascii_case("SMTP") {
                        xml_content(&att_xml, "t:EmailAddress").unwrap_or_default()
                    } else {
                        String::new()
                    };
                    let name = xml_content(&att_xml, "t:Name").filter(|s| !s.is_empty());
                    let response_type = xml_content(&att_xml, "t:ResponseType")
                        .unwrap_or_else(|| "Unknown".to_string());
                    attendees.push(EwsAttendee {
                        email,
                        name,
                        response_type,
                    });
                }
            }
        }

        events.push(EwsEvent {
            item_id,
            change_key,
            subject,
            start,
            end,
            is_all_day,
            location,
            organizer_name,
            organizer_email,
            my_response_type,
            attendees,
            is_meeting,
            recurring_master_id,
        });
    }

    Ok(events)
}

/// Parse a `GetItem` response and return a minimal struct with only
/// item_id + attendees + organizer (the fields missing from FindItem).
struct GetItemDetail {
    item_id: String,
    organizer_name: Option<String>,
    organizer_email: Option<String>,
    attendees: Vec<EwsAttendee>,
    /// CleanGlobalObjectId (MAPI prop 0x0023 in PSETID_Meeting) — identical for all
    /// occurrences of the same recurring series.
    clean_global_object_id: Option<String>,
}

fn parse_get_item_response(xml: &str) -> Vec<GetItemDetail> {
    let mut results = Vec::new();

    for item_xml in xml_all(xml, "t:CalendarItem") {
        let item_id_str = item_xml
            .find("<t:ItemId ")
            .and_then(|s| item_xml[s..].find("/>").map(|e| &item_xml[s..s + e]));

        let item_id = match item_id_str.and_then(|e| xml_attr(e, "Id")) {
            Some(id) => id,
            None => continue,
        };

        let organizer_xml = xml_content(&item_xml, "t:Organizer");
        let organizer_name = organizer_xml.as_deref().and_then(|o| xml_content(o, "t:Name")).filter(|s| !s.is_empty());
        let organizer_email = organizer_xml.as_deref().and_then(|o| xml_content(o, "t:EmailAddress")).filter(|s| !s.is_empty());

        let mut attendees: Vec<EwsAttendee> = Vec::new();
        for list_tag in &["t:RequiredAttendees", "t:OptionalAttendees"] {
            if let Some(list_xml) = xml_content(&item_xml, list_tag) {
                for att_xml in xml_all(&list_xml, "t:Attendee") {
                    let routing_type = xml_content(&att_xml, "t:RoutingType")
                        .unwrap_or_default();
                    let email = if routing_type.eq_ignore_ascii_case("SMTP") {
                        xml_content(&att_xml, "t:EmailAddress").unwrap_or_default()
                    } else {
                        String::new()
                    };
                    let name = xml_content(&att_xml, "t:Name").filter(|s| !s.is_empty());
                    let response_type = xml_content(&att_xml, "t:ResponseType")
                        .unwrap_or_else(|| "Unknown".to_string());
                    attendees.push(EwsAttendee { email, name, response_type });
                }
            }
        }

        // CleanGlobalObjectId is in an ExtendedProperty block with PropertyId="35"
        let clean_global_object_id = xml_all(&item_xml, "t:ExtendedProperty")
            .into_iter()
            .find(|ep| ep.contains("PropertyId=\"35\""))
            .and_then(|ep| xml_content(&ep, "t:Value"))
            .filter(|s| !s.is_empty());

        results.push(GetItemDetail { item_id, organizer_name, organizer_email, attendees, clean_global_object_id });
    }

    results
}
