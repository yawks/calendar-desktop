use super::*;

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

    // Déterminer le Bias du timezone local (en minutes)
    let now = Local::now();
    let offset_seconds = now.offset().local_minus_utc();
    let bias = -(offset_seconds / 60); // EWS Bias en minutes (négatif de offset UTC)

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
    <t:Bias>{bias}</t:Bias>
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
        bias = bias,
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
    owner_email: String,
    body: Option<String>,
) -> Result<(), String> {
    let element = match response_type.as_str() {
        "accept" => "AcceptItem",
        "decline" => "DeclineItem",
        "tentative" => "TentativelyAcceptItem",
        other => return Err(format!("Invalid response_type: {}", other)),
    };

    let body_element = match &body {
        Some(text) if !text.is_empty() => format!(
            "\n      <t:Body BodyType=\"Text\">{}</t:Body>",
            text.replace('&', "&amp;").replace('<', "&lt;").replace('>', "&gt;")
        ),
        _ => String::new(),
    };

    let soap_body = format!(
        r#"<m:CreateItem MessageDisposition="SendAndSaveCopy">
  <m:Items>
    <t:{element}>{body_element}
      <t:ReferenceItemId Id="{item_id}" ChangeKey="{change_key}"/>
    </t:{element}>
  </m:Items>
</m:CreateItem>"#,
        element = element,
        body_element = body_element,
        item_id = item_id,
        change_key = change_key
    );

    let xml = send_ews_request(&access_token, &soap_body, Some(owner_email.as_str())).await?;

    if xml.contains("ResponseClass=\"Error\"") {
        let msg = xml_content(&xml, "m:MessageText")
            .unwrap_or_else(|| "Unknown EWS error".to_string());
        return Err(msg);
    }

    Ok(())
}

