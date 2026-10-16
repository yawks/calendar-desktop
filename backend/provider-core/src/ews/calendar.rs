use super::*;

// ── Calendar commands ──────────────────────────────────────────────────────────

/// Fetch calendar events in the given date range.
/// `start` and `end` must be ISO 8601 strings (e.g. "2026-03-01T00:00:00Z").
pub async fn ews_get_calendar_events(
    access_token: String,
    owner_email: Option<String>,
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

    let anchor_mailbox = owner_email.as_deref().filter(|email| !email.is_empty());
    let xml = send_ews_request(&access_token, &soap_body, anchor_mailbox).await?;
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
      <t:FieldURI FieldURI="item:Attachments"/>
      <t:ExtendedFieldURI PropertySetId="6ED8DA90-450B-101B-98DA-00AA003F1305" PropertyId="35" PropertyType="Binary"/>
    </t:AdditionalProperties>
  </m:ItemShape>
  <m:ItemIds>
    {}
  </m:ItemIds>
</m:GetItem>"#,
            item_ids_xml
        );

        if let Ok(details_xml) = send_ews_request(&access_token, &get_body, anchor_mailbox).await {
            let mut detailed = parse_get_item_response(&details_xml);
            for detail in detailed.iter_mut() {
                let Some(mut body) = detail.body.take() else {
                    continue;
                };
                if body.contains("cid:") {
                    eprintln!(
                        "[EWS calendar] resolving {} inline image(s) for item {}",
                        detail.inline_images.len(),
                        detail.item_id
                    );
                }
                for image in &detail.inline_images {
                    match crate::mail::fetch_ews_attachment_base64(
                        &access_token,
                        &image.attachment_id,
                    )
                    .await
                    {
                        Ok(base64) => {
                            let data_uri = format!("data:{};base64,{}", image.content_type, base64);
                            let double_quoted = format!("src=\"cid:{}\"", image.content_id);
                            let single_quoted = format!("src='cid:{}'", image.content_id);
                            body = body
                                .replace(&double_quoted, &format!("src=\"{}\"", data_uri))
                                .replace(&single_quoted, &format!("src='{}'", data_uri));
                        }
                        Err(error) => {
                            eprintln!("[EWS calendar] inline image fetch failed: {}", error)
                        }
                    }
                }
                detail.body = Some(body);
            }
            for event in events.iter_mut() {
                if let Some(detail) = detailed.iter().find(|d| d.item_id == event.item_id) {
                    // Only use CleanGlobalObjectId as the series identifier when the event was
                    // already identified as a recurring occurrence (RecurringMasterId present in
                    // the FindItem response).  CleanGlobalObjectId exists for *every* Exchange
                    // item, so blindly assigning it would mark all single events as recurring.
                    if event.recurring_master_id.is_some() {
                        event.recurring_master_id = detail.clean_global_object_id.clone();
                    }
                    event.body = detail.body.clone();
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
pub async fn ews_create_event(
    access_token: String,
    title: String,
    start: String,
    end: String,
    is_all_day: bool,
    location: Option<String>,
    description: Option<String>,
    attendees: Option<Vec<String>>, // list of email addresses
    recurrence: Option<String>,
    online_meeting: bool,
    refresh_token: Option<String>,
) -> Result<String, String> {
    let recurrence_xml = recurrence.as_deref().filter(|s| !s.is_empty()).map(|rule| super::recurrence::recurrence_xml(rule, &start)).transpose()?.unwrap_or_default();
    // shortcut: standalone Teams links have an independent lifetime; use calendar-backed Graph meetings when synchronizing cancellation.
    let description = if online_meeting {
        let refresh = refresh_token.as_deref().filter(|s| !s.is_empty())
            .ok_or("teams_auth_required")?;
        let token = get_graph_token_for_scope(refresh, "https://graph.microsoft.com/OnlineMeetings.ReadWrite offline_access").await.map_err(|_| "teams_auth_required".to_string())?;
        let date_time = |value: &str| if value.len() == 10 { format!("{value}T00:00:00Z") } else { value.to_string() };
        let response = reqwest::Client::new()
            .post("https://graph.microsoft.com/v1.0/me/onlineMeetings")
            .bearer_auth(token)
            .json(&serde_json::json!({ "subject": title, "startDateTime": date_time(&start), "endDateTime": date_time(&end) }))
            .send().await.map_err(|_| "teams_request_failed".to_string())?;
        if !response.status().is_success() {
            return Err(format!("teams_creation_failed_http_{}", response.status().as_u16()));
        }
        let meeting: serde_json::Value = response.json().await.map_err(|_| "teams_invalid_response".to_string())?;
        let url = meeting["joinWebUrl"].as_str().filter(|url| url.starts_with("https://"))
            .ok_or("teams_missing_link")?;
        Some(format!("{}<p><a href=\"{}\">Microsoft Teams</a></p>", description.unwrap_or_default(), xml_escape(url)))
    } else { description };
    let location_xml = location
        .filter(|s| !s.is_empty())
        .map(|s| format!("<t:Location>{}</t:Location>", xml_escape(&s)))
        .unwrap_or_default();

    let body_xml = description
        .filter(|s| !s.is_empty())
        .map(|s| format!(r#"<t:Body BodyType="HTML">{}</t:Body>"#, xml_escape(&s)))
        .unwrap_or_default();

    let attendees_xml = attendees
        .unwrap_or_default()
        .iter()
        .map(|email| {
            format!(
            "<t:Attendee><t:Mailbox><t:EmailAddress>{}</t:EmailAddress></t:Mailbox></t:Attendee>",
            xml_escape(email)
        )
        })
        .collect::<Vec<_>>()
        .join("\n");
    let attendees_block = if attendees_xml.is_empty() {
        String::new()
    } else {
        format!(
            "<t:RequiredAttendees>{}</t:RequiredAttendees>",
            attendees_xml
        )
    };

    let invitations_attr = if attendees_xml.is_empty() {
        "SendToNone"
    } else {
        "SendToAllAndSaveCopy"
    };

    let title_escaped = xml_escape(&title);
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
      {recurrence_xml}
    </t:CalendarItem>
  </m:Items>
</m:CreateItem>"#,
        invitations_attr = invitations_attr,
        title = title_escaped,
        body_xml = body_xml,
        start = xml_escape(&start),
        end = xml_escape(&end),
        is_all_day = is_all_day,
        location_xml = location_xml,
        attendees_block = attendees_block,
    );

    let xml = send_ews_request(&access_token, &soap_body, None).await?;

    if xml.contains("ResponseClass=\"Error\"") {
        let msg =
            xml_content(&xml, "m:MessageText").unwrap_or_else(|| "EWS create error".to_string());
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

// None at the call site preserves participants; an empty list explicitly removes them.
fn attendees_update_xml(attendees: &[String]) -> String {
    if attendees.is_empty() {
        return r#"<t:DeleteItemField><t:FieldURI FieldURI="calendar:RequiredAttendees"/></t:DeleteItemField>"#.into();
    }
    let mailboxes = attendees.iter().map(|email| format!(
        "<t:Attendee><t:Mailbox><t:EmailAddress>{}</t:EmailAddress></t:Mailbox></t:Attendee>",
        xml_escape(email)
    )).collect::<Vec<_>>().join("");
    format!(r#"<t:SetItemField><t:FieldURI FieldURI="calendar:RequiredAttendees"/><t:CalendarItem><t:RequiredAttendees>{mailboxes}</t:RequiredAttendees></t:CalendarItem></t:SetItemField>"#)
}

fn check_update_response(xml: &str) -> Result<(), String> {
    let code = xml_content_ns(xml, "m:ResponseCode").unwrap_or_else(|| "MissingResponseCode".into());
    if code != "NoError" {
        let message = xml_content_ns(xml, "m:MessageText").unwrap_or_default();
        return Err(format!("EWS update {code}: {message}"));
    }
    Ok(())
}

fn verify_updated_attendees(xml: &str, expected: &[String]) -> Result<(), String> {
    check_update_response(xml)?;
    let item = xml_all_ns(xml, "t:CalendarItem").into_iter().next()
        .ok_or("ews_attendees_verification_failed")?;
    let actual: Vec<String> = xml_content_ns(&item, "t:RequiredAttendees")
        .map(|list| xml_all_ns(&list, "t:Attendee").iter().filter_map(|attendee|
            xml_content_ns(attendee, "t:EmailAddress").map(|email| xml_decode(&email))
        ).collect()).unwrap_or_default();
    if actual.len() != expected.len() || expected.iter().any(|email|
        !actual.iter().any(|stored| stored.eq_ignore_ascii_case(email.trim()))
    ) {
        return Err("ews_attendees_verification_failed".into());
    }
    Ok(())
}

/// Update an existing calendar event.
pub async fn ews_update_event(
    access_token: String,
    item_id: String,
    change_key: String,
    title: String,
    mut start: String,
    mut end: String,
    is_all_day: bool,
    location: Option<String>,
    description: Option<String>,
    update_series: bool,
    recurrence: Option<String>,
    original_start: Option<String>,
    attendees: Option<Vec<String>>,
) -> Result<(), String> {
    if update_series {
        if let Some(original) = original_start {
            let body = format!(r#"<m:GetItem><m:ItemShape><t:BaseShape>IdOnly</t:BaseShape><t:AdditionalProperties><t:FieldURI FieldURI="calendar:Start"/></t:AdditionalProperties></m:ItemShape><m:ItemIds><t:RecurringMasterItemId OccurrenceId="{}"/></m:ItemIds></m:GetItem>"#, xml_escape(&item_id));
            let master = send_ews_request(&access_token, &body, None).await?;
            let master_start = xml_content(&master, "t:Start").ok_or("Recurring master start missing")?;
            let parse = |value: &str| chrono::DateTime::parse_from_rfc3339(value).map_err(|_| "Invalid series date".to_string());
            let normalize = |value: &str| if value.len() == 10 { format!("{value}T00:00:00Z") } else { value.to_string() };
            let next_start = parse(&normalize(&start))?;
            let duration = parse(&normalize(&end))? - next_start;
            let anchored = parse(&master_start)? + (next_start - parse(&normalize(&original))?);
            start = anchored.to_rfc3339();
            end = (anchored + duration).to_rfc3339();
        }
    }
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
        set_field("item:Subject", "t:Subject", &xml_escape(&title)),
        set_field("calendar:Start", "t:Start", &xml_escape(&start)),
        set_field("calendar:End", "t:End", &xml_escape(&end)),
        set_field(
            "calendar:IsAllDayEvent",
            "t:IsAllDayEvent",
            if is_all_day { "true" } else { "false" },
        ),
    ];

    if let Some(loc) = location.filter(|s| !s.is_empty()) {
        updates.push(set_field("calendar:Location", "t:Location", &xml_escape(&loc)));
    }
    if let Some(desc) = description.filter(|s| !s.is_empty()) {
        updates.push(format!(
            r#"<t:SetItemField>
  <t:FieldURI FieldURI="item:Body"/>
  <t:CalendarItem><t:Body BodyType="HTML">{}</t:Body></t:CalendarItem>
</t:SetItemField>"#,
            xml_escape(&desc)
        ));
    }

    if let Some(attendees) = &attendees {
        updates.push(attendees_update_xml(attendees));
    }

    updates.push(super::recurrence::recurrence_update_xml(recurrence.as_deref(), &start)?);

    // RecurringMasterItemId lets EWS resolve the master from the occurrence
    // currently being edited, without confusing it with our local series key.
    let target_id = if update_series {
        format!(
            r#"<t:RecurringMasterItemId OccurrenceId="{}" ChangeKey="{}"/>"#,
            xml_escape(&item_id), xml_escape(&change_key)
        )
    } else {
        format!(r#"<t:ItemId Id="{}" ChangeKey="{}"/>"#, xml_escape(&item_id), xml_escape(&change_key))
    };

    let soap_body = format!(
        r#"<m:UpdateItem MessageDisposition="SaveOnly" ConflictResolution="AutoResolve" SendMeetingInvitationsOrCancellations="SendToAllAndSaveCopy">
  <m:ItemChanges>
    <t:ItemChange>
      {target_id}
      <t:Updates>
        {updates}
      </t:Updates>
    </t:ItemChange>
  </m:ItemChanges>
</m:UpdateItem>"#,
        target_id = target_id,
        updates = updates.join("\n"),
    );

    let xml = send_ews_request(&access_token, &soap_body, None).await?;

    check_update_response(&xml)?;
    if let Some(attendees) = attendees {
        // Read the saved item with its new ID, never the stale pre-update ChangeKey.
        let (saved_id, _) = parse_response_master(&xml)?;
        let body = format!(r#"<m:GetItem><m:ItemShape><t:BaseShape>IdOnly</t:BaseShape><t:AdditionalProperties><t:FieldURI FieldURI="calendar:RequiredAttendees"/></t:AdditionalProperties></m:ItemShape><m:ItemIds><t:ItemId Id="{}"/></m:ItemIds></m:GetItem>"#, xml_escape(&saved_id));
        let saved = send_ews_request(&access_token, &body, None).await?;
        verify_updated_attendees(&saved, &attendees)?;
    }
    Ok(())
}

/// Delete a calendar event.
pub async fn ews_delete_event(
    access_token: String,
    item_id: String,
    change_key: String,
    send_cancellations: bool,
    delete_series: bool,
) -> Result<(), String> {
    let cancellation_mode = if send_cancellations {
        "SendToAllAndSaveCopy"
    } else {
        "SendToNone"
    };
    let target_id = if delete_series {
        format!(
            r#"<t:RecurringMasterItemId OccurrenceId="{}" ChangeKey="{}"/>"#,
            item_id, change_key
        )
    } else {
        format!(r#"<t:ItemId Id="{}" ChangeKey="{}"/>"#, item_id, change_key)
    };
    let soap_body = format!(
        r#"<m:DeleteItem DeleteType="MoveToDeletedItems" SendMeetingCancellations="{}">
  <m:ItemIds>
    {}
  </m:ItemIds>
</m:DeleteItem>"#,
        cancellation_mode, target_id
    );

    let xml = send_ews_request(&access_token, &soap_body, None).await?;

    if xml.contains("ResponseClass=\"Error\"") {
        let msg =
            xml_content(&xml, "m:MessageText").unwrap_or_else(|| "EWS delete error".to_string());
        return Err(msg);
    }
    Ok(())
}

async fn resolve_response_item(
    access_token: &str,
    item_id: String,
    change_key: String,
    series: bool,
    owner_email: Option<&str>,
) -> Result<(String, String), String> {
    let reference = if series {
        let get_master_body = format!(
            r#"<m:GetItem>
  <m:ItemShape><t:BaseShape>IdOnly</t:BaseShape></m:ItemShape>
  <m:ItemIds>
    <t:RecurringMasterItemId OccurrenceId="{}" ChangeKey="{}"/>
  </m:ItemIds>
</m:GetItem>"#,
            item_id, change_key,
        );
        let master_xml = send_ews_request(&access_token, &get_master_body, owner_email).await?;
        if master_xml.contains("ResponseClass=\"Error\"") {
            let msg = xml_content(&master_xml, "m:MessageText")
                .unwrap_or_else(|| "EWS recurring master lookup error".to_string());
            return Err(msg);
        }
        parse_response_master(&master_xml)?
    } else {
        (item_id, change_key)
    };

    Ok(reference)
}

fn parse_response_master(xml: &str) -> Result<(String, String), String> {
    let item_element = xml
        .find("<t:ItemId ")
        .and_then(|start| {
            xml[start..]
                .find("/>")
                .map(|end| &xml[start..start + end])
        })
        .ok_or_else(|| "EWS recurring master ID missing".to_string())?;
    Ok((
        xml_attr(item_element, "Id")
            .ok_or_else(|| "EWS recurring master ID missing".to_string())?,
        xml_attr(item_element, "ChangeKey").unwrap_or_default(),
    ))
}

/// Cancel an organizer meeting using the same EWS response object as Outlook.
pub async fn ews_cancel_event(
    access_token: String,
    item_id: String,
    change_key: String,
    cancel_series: bool,
) -> Result<(), String> {
    let (reference_id, reference_change_key) =
        resolve_response_item(&access_token, item_id, change_key, cancel_series, None).await?;
    let soap_body = format!(
        r#"<m:CreateItem MessageDisposition="SendAndSaveCopy">
  <m:Items>
    <t:CancelCalendarItem>
      <t:ReferenceItemId Id="{}" ChangeKey="{}"/>
    </t:CancelCalendarItem>
  </m:Items>
</m:CreateItem>"#,
        reference_id, reference_change_key,
    );
    let xml = send_ews_request(&access_token, &soap_body, None).await?;
    if xml.contains("ResponseClass=\"Error\"") {
        let msg =
            xml_content(&xml, "m:MessageText").unwrap_or_else(|| "EWS cancel error".to_string());
        return Err(msg);
    }
    Ok(())
}

/// Free/busy slot returned by EWS GetUserAvailability.
#[derive(Serialize, Debug)]
pub struct EwsFreeBusySlot {
    pub start: String,
    pub end: String,
    pub busy_type: String, // "Busy" | "Tentative" | "OOF"
}

fn availability_utc(value: &str) -> String {
    if value.ends_with('Z') { value.into() } else { format!("{value}Z") }
}

pub async fn ews_get_free_busy_ews(
    refresh_token: String,
    emails: Vec<String>,
    start: String,
    end: String,
    anchor_mailbox: Option<String>,
) -> Result<std::collections::HashMap<String, Vec<EwsFreeBusySlot>>, String> {
    let token_response = ews_refresh_access_token(refresh_token).await?;
    let access_token = token_response.access_token;

    // The frontend sends UTC dates; the host timezone must not shift the requested window.
    let bias = 0;

    let start_time = availability_utc(&start);
    let end_time = availability_utc(&end);

    let mailbox_data = emails
        .iter()
        .map(|email| {
            format!(
                r#"<t:MailboxData>
  <t:Email><t:Address>{}</t:Address></t:Email>
  <t:AttendeeType>Required</t:AttendeeType>
  <t:ExcludeConflicts>false</t:ExcludeConflicts>
</t:MailboxData>"#,
                xml_escape(email)
            )
        })
        .collect::<Vec<_>>()
        .join("\n");

    let soap_body = format!(
        r#"<m:GetUserAvailabilityRequest>
  <t:TimeZone>
    <t:Bias>{bias}</t:Bias>
    <t:StandardTime><t:Bias>0</t:Bias><t:Time>00:00:00</t:Time><t:DayOrder>1</t:DayOrder><t:Month>1</t:Month><t:DayOfWeek>Sunday</t:DayOfWeek></t:StandardTime>
    <t:DaylightTime><t:Bias>0</t:Bias><t:Time>00:00:00</t:Time><t:DayOrder>1</t:DayOrder><t:Month>7</t:Month><t:DayOfWeek>Sunday</t:DayOfWeek></t:DaylightTime>
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

    let anchor_mailbox = anchor_mailbox.as_deref();
    let xml = send_ews_request(&access_token, &soap_body, anchor_mailbox).await?;

    parse_availability(&xml, &emails)
}

fn parse_availability(xml: &str, emails: &[String]) -> Result<std::collections::HashMap<String, Vec<EwsFreeBusySlot>>, String> {
    if xml.contains("ResponseClass=\"Error\"") {
        let msg =
            xml_content(&xml, "m:MessageText").unwrap_or_else(|| "EWS free/busy error".to_string());
        return Err(msg);
    }

    let mut result = std::collections::HashMap::new();
    for email in emails {
        result.insert(email.clone(), Vec::new());
    }

    let freebusy_responses = xml_all_ns(xml, "m:FreeBusyResponse");
    if freebusy_responses.len() != emails.len() {
        return Err("EWS availability: incomplete response".into());
    }
    for (idx, freebusy_response) in freebusy_responses.iter().enumerate() {
        let email = emails
            .get(idx)
            .cloned()
            .unwrap_or_else(|| format!("unknown-{}", idx));

        let mut slots = Vec::new();

        if !freebusy_response.contains("ResponseClass=\"Success\"") {
            return Err("EWS availability: missing success response".into());
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
                start: availability_utc(&st),
                end: availability_utc(&en),
                busy_type,
            });
        }

        result.insert(email, slots);
    }

    Ok(result)
}

async fn get_graph_token_for_scope(refresh_token: &str, scope: &str) -> Result<String, String> {
    let client = reqwest::Client::new();
    let scope = urlencoding::encode(scope);
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
        let desc = json
            .get("error_description")
            .and_then(|e| e.as_str())
            .unwrap_or("");
        return Err(format!("Graph token error: {}: {}", err, desc));
    }
    json["access_token"]
        .as_str()
        .map(|s| s.to_string())
        .ok_or_else(|| "No access_token in Graph token response".to_string())
}

/// Respond to a meeting invitation.
/// `response_type` must be "accept", "decline", or "tentative".
pub async fn ews_respond_to_invitation(
    access_token: String,
    item_id: String,
    change_key: String,
    response_type: String,
    owner_email: String,
    body: Option<String>,
    respond_series: bool,
) -> Result<(), String> {
    let element = match response_type.as_str() {
        "accept" => "AcceptItem",
        "decline" => "DeclineItem",
        "tentative" => "TentativelyAcceptItem",
        other => return Err(format!("Invalid response_type: {}", other)),
    };

    let (item_id, change_key) = resolve_response_item(
        &access_token,
        item_id,
        change_key,
        respond_series,
        Some(&owner_email),
    )
    .await?;

    let body_element = match &body {
        Some(text) if !text.is_empty() => format!(
            "\n      <t:Body BodyType=\"Text\">{}</t:Body>",
            text.replace('&', "&amp;")
                .replace('<', "&lt;")
                .replace('>', "&gt;")
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

    let response_code =
        xml_content_ns(&xml, "m:ResponseCode").unwrap_or_else(|| "MissingResponseCode".to_string());
    if response_code != "NoError" {
        let msg =
            xml_content(&xml, "m:MessageText").unwrap_or_else(|| "Unknown EWS error".to_string());
        return Err(format!("EWS RSVP {}: {}", response_code, msg));
    }
    eprintln!("[EWS RSVP] {} succeeded for {}", response_type, owner_email);

    // When declining, Exchange moves the CalendarItem to Deleted Items.
    // Move it back to the Calendar folder so it stays visible as declined.
    if response_type == "decline" {
        let move_soap = format!(
            r#"<m:MoveItem>
  <m:ToFolderId>
    <t:DistinguishedFolderId Id="calendar">
      <t:Mailbox>
        <t:EmailAddress>{owner_email}</t:EmailAddress>
      </t:Mailbox>
    </t:DistinguishedFolderId>
  </m:ToFolderId>
  <m:ItemIds>
    <t:ItemId Id="{item_id}"/>
  </m:ItemIds>
</m:MoveItem>"#,
            owner_email = owner_email,
            item_id = item_id,
        );

        let move_xml =
            send_ews_request(&access_token, &move_soap, Some(owner_email.as_str())).await?;

        if move_xml.contains("ResponseClass=\"Error\"") {
            // Non-fatal: the decline was sent successfully, the item just stays in Deleted Items.
            eprintln!(
                "[EWS] MoveItem after decline failed (item stays in Deleted Items): {}",
                xml_content(&move_xml, "m:MessageText").unwrap_or_default()
            );
        }
    }

    Ok(())
}

#[cfg(test)]
mod response_tests {
    use super::*;

    #[test]
    fn update_requires_explicit_success_and_preserved_participants() {
        assert!(check_update_response("<ResponseCode>ErrorAccessDenied</ResponseCode>").unwrap_err().contains("ErrorAccessDenied"));
        assert!(check_update_response("<m:ResponseCode>ErrorIrresolvableConflict</m:ResponseCode>").is_err());
        assert!(check_update_response("<m:ResponseMessages/>").is_err());
        let saved = r#"<m:ResponseCode>NoError</m:ResponseCode><t:CalendarItem><t:RequiredAttendees><t:Attendee><t:Mailbox><t:EmailAddress>New@example.org</t:EmailAddress></t:Mailbox></t:Attendee></t:RequiredAttendees></t:CalendarItem>"#;
        assert!(verify_updated_attendees(saved, &["new@example.org".into()]).is_ok());
        assert_eq!(verify_updated_attendees(saved, &["missing@example.org".into()]).unwrap_err(), "ews_attendees_verification_failed");
        assert!(verify_updated_attendees("<m:ResponseCode>NoError</m:ResponseCode>", &[]).is_err());
        assert!(verify_updated_attendees("<m:ResponseCode>NoError</m:ResponseCode><t:CalendarItem></t:CalendarItem>", &[]).is_ok());
    }

    #[test]
    fn ews_availability_parses_utc_slots_and_rejects_errors() {
        let emails = vec!["guest@example.org".into()];
        let xml = r#"<FreeBusyResponse><ResponseMessage ResponseClass="Success"><ResponseCode>NoError</ResponseCode></ResponseMessage><FreeBusyView><CalendarEventArray><CalendarEvent><StartTime>2026-10-16T14:00:00</StartTime><EndTime>2026-10-16T15:00:00</EndTime><BusyType>Tentative</BusyType></CalendarEvent></CalendarEventArray></FreeBusyView></FreeBusyResponse>"#;
        let slots = parse_availability(xml, &emails).unwrap();
        assert_eq!(slots[&emails[0]][0].start, "2026-10-16T14:00:00Z");
        assert_eq!(slots[&emails[0]][0].busy_type, "Tentative");
        assert!(parse_availability("<Response/>", &emails).is_err());
        assert!(parse_availability(&xml.replace("Success", "Error"), &emails).is_err());
        assert_eq!(availability_utc("2026-10-16T14:00:00Z"), "2026-10-16T14:00:00Z");
    }

    #[test]
    fn attendee_updates_include_every_address_and_escape_xml() {
        let update = attendees_update_xml(&["first@example.org".into(), "a&b@example.org".into()]);
        assert!(update.contains(r#"FieldURI="calendar:RequiredAttendees""#));
        assert!(update.contains("<t:EmailAddress>first@example.org</t:EmailAddress>"));
        assert!(update.contains("<t:EmailAddress>a&amp;b@example.org</t:EmailAddress>"));
        assert_eq!(update.matches("<t:Attendee>").count(), 2);
        assert!(attendees_update_xml(&[]).contains("<t:DeleteItemField>"));
    }

    #[test]
    fn resolves_master_id_and_its_own_change_key() {
        let xml =
            r#"<t:CalendarItem><t:ItemId Id="master" ChangeKey="master-key"/></t:CalendarItem>"#;
        assert_eq!(
            parse_response_master(xml).unwrap(),
            ("master".into(), "master-key".into())
        );
        assert!(parse_response_master("<m:Items/>").is_err());
    }

    #[tokio::test]
    async fn single_occurrence_keeps_its_reference_without_lookup() {
        assert_eq!(
            resolve_response_item(
                "",
                "occurrence".into(),
                "occurrence-key".into(),
                false,
                None
            )
            .await
            .unwrap(),
            ("occurrence".into(), "occurrence-key".into())
        );
    }
}

#[cfg(test)]
mod online_meeting_tests {
    #[tokio::test]
    async fn teams_requires_refresh_token_before_creating_an_ews_event() {
        let result = super::ews_create_event(
            "unused".into(), "Meeting".into(), "2026-10-15T14:00:00Z".into(),
            "2026-10-15T15:00:00Z".into(), false, None, None, None, None, true, None,
        ).await;
        assert_eq!(result.unwrap_err(), "teams_auth_required");
    }
}
