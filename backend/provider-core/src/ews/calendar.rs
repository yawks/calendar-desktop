use super::*;

fn validate_event_options(sensitivity: Option<&str>, availability: Option<&str>) -> Result<(), String> {
    if sensitivity.is_some_and(|v| !["Normal", "Personal", "Private", "Confidential"].contains(&v)) {
        return Err("Invalid EWS sensitivity".into());
    }
    if availability.is_some_and(|v| !["Free", "Tentative", "Busy", "OOF", "WorkingElsewhere"].contains(&v)) {
        return Err("Invalid EWS availability".into());
    }
    Ok(())
}

// ── Calendar commands ──────────────────────────────────────────────────────────

/// Fetch calendar events in the given date range.
/// `start` and `end` must be ISO 8601 strings (e.g. "2026-03-01T00:00:00Z").
pub async fn ews_get_calendar_events(
    access_token: String,
    owner_email: Option<String>,
    start: String,
    end: String,
    folder_id: Option<String>,
    shared_mailbox: Option<String>,
) -> Result<Vec<EwsEvent>, String> {
    let parent = calendar_parent(folder_id.as_deref(), shared_mailbox.as_deref());
    let soap_body = format!(
        r#"<m:FindItem Traversal="Shallow">
  <m:ItemShape>
    <t:BaseShape>AllProperties</t:BaseShape>
  </m:ItemShape>
  <m:CalendarView MaxEntriesReturned="500" StartDate="{}" EndDate="{}"/>
  <m:ParentFolderIds>
    {}
  </m:ParentFolderIds>
</m:FindItem>"#,
        xml_escape(&start), xml_escape(&end), parent
    );

    let anchor_mailbox = calendar_anchor_mailbox(shared_mailbox.as_deref(), owner_email.as_deref());
    let xml = send_ews_request(&access_token, &soap_body, anchor_mailbox).await?;
    let mut events = match parse_calendar_events(&xml) {
        Ok(events) => events,
        Err(error) => {
            if let Some(mailbox) = shared_mailbox.as_deref().filter(|email| !email.trim().is_empty()) {
                if shared_read_allows_availability(&xml) {
                    let primary = calendar_parent(None, Some(mailbox));
                    let lookup = format!("<m:GetFolder><m:FolderShape><t:BaseShape>Default</t:BaseShape></m:FolderShape><m:FolderIds>{primary}</m:FolderIds></m:GetFolder>");
                    let default_id = match shared_folder_response(send_ews_request(&access_token, &lookup, Some(mailbox)).await) {
                        Ok(response) => parse_shared_folders(&response).into_iter().next().map(|folder| folder.id),
                        Err(_) => None,
                    };
                    if shared_primary_matches(folder_id.as_deref(), default_id.as_deref()) {
                        return shared_availability_events(&access_token, mailbox, &start, &end).await;
                    }
                }
                return Err(shared_calendar_read_error(&xml, folder_id.as_deref(), &error));
            }
            return Err(error);
        }
    };

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
            refresh_event_snapshots(&mut events, &details_xml)?;
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

// Keep the version token and editable fields from the same, most recent read.
fn refresh_event_snapshots(events: &mut [EwsEvent], xml: &str) -> Result<(), String> {
    for snapshot in parse_calendar_events(xml)? {
        if snapshot.change_key.is_empty() || snapshot.start.is_empty() || snapshot.end.is_empty() {
            continue;
        }
        if let Some(event) = events.iter_mut().find(|event| event.item_id == snapshot.item_id) {
            *event = snapshot;
        }
    }
    Ok(())
}

fn verify_event_version(xml: &str, expected_key: &str) -> Result<(), String> {
    check_update_response(xml)?;
    let (_, current_key) = parse_response_master(xml)?;
    if expected_key.is_empty() || current_key != expected_key {
        return Err("EWS update ErrorIrresolvableConflict: Event changed since it was loaded; refresh before editing again".into());
    }
    Ok(())
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
    sensitivity: Option<String>,
    availability: Option<String>,
) -> Result<String, String> {
    validate_event_options(sensitivity.as_deref(), availability.as_deref())?;
    let sensitivity_xml = sensitivity.map(|v| format!("<t:Sensitivity>{v}</t:Sensitivity>")).unwrap_or_default();
    let availability_xml = availability.map(|v| format!("<t:LegacyFreeBusyStatus>{v}</t:LegacyFreeBusyStatus>")).unwrap_or_default();
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
      {sensitivity_xml}
      {body_xml}
      <t:Start>{start}</t:Start>
      <t:End>{end}</t:End>
      <t:IsAllDayEvent>{is_all_day}</t:IsAllDayEvent>
      {availability_xml}
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
    sensitivity: Option<String>,
    availability: Option<String>,
) -> Result<(), String> {
    validate_event_options(sensitivity.as_deref(), availability.as_deref())?;
    let mut target_item_id = item_id.clone();
    let mut target_change_key = change_key.clone();
    if update_series {
        // An occurrence's ChangeKey cannot be used to update its master.
        // Check the user's occurrence version before resolving the master, without retrying conflicts.
        let lookup = format!(r#"<m:GetItem><m:ItemShape><t:BaseShape>IdOnly</t:BaseShape></m:ItemShape><m:ItemIds><t:ItemId Id="{}"/></m:ItemIds></m:GetItem>"#, xml_escape(&item_id));
        let current = send_ews_request(&access_token, &lookup, None).await?;
        verify_event_version(&current, &change_key)?;
        let body = format!(r#"<m:GetItem><m:ItemShape><t:BaseShape>IdOnly</t:BaseShape><t:AdditionalProperties><t:FieldURI FieldURI="calendar:Start"/></t:AdditionalProperties></m:ItemShape><m:ItemIds><t:RecurringMasterItemId OccurrenceId="{}"/></m:ItemIds></m:GetItem>"#, xml_escape(&item_id));
        let master = send_ews_request(&access_token, &body, None).await?;
        check_update_response(&master)?;
        (target_item_id, target_change_key) = parse_response_master(&master)?;
        if target_change_key.is_empty() { return Err("EWS recurring master ChangeKey missing".into()); }
        if let Some(original) = original_start {
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

    if let Some(value) = sensitivity {
        updates.push(set_field("item:Sensitivity", "t:Sensitivity", &value));
    }
    if let Some(value) = availability {
        updates.push(set_field("calendar:LegacyFreeBusyStatus", "t:LegacyFreeBusyStatus", &value));
    }
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

    let target_id = format!(r#"<t:ItemId Id="{}" ChangeKey="{}"/>"#,
        xml_escape(&target_item_id), xml_escape(&target_change_key));

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
    #[serde(skip_serializing_if = "Option::is_none")]
    pub subject: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub location: Option<String>,
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

    ews_availability_with_token(&access_token, emails, start, end, anchor_mailbox).await
}

async fn ews_availability_with_token(
    access_token: &str, emails: Vec<String>, start: String, end: String, anchor_mailbox: Option<String>,
) -> Result<std::collections::HashMap<String, Vec<EwsFreeBusySlot>>, String> {
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

        if xml_content_ns(freebusy_response, "t:FreeBusyViewType").as_deref() == Some("None") {
            return Err("EWS availability: access unavailable".into());
        }
        let events = xml_all_ns(freebusy_response, "t:CalendarEvent");
        for event_xml in events {
            let st = xml_content_ns(&event_xml, "t:StartTime").unwrap_or_default();
            let en = xml_content_ns(&event_xml, "t:EndTime").unwrap_or_default();
            let busy_type = xml_content_ns(&event_xml, "t:BusyType").unwrap_or_default();

            let busy_type = match busy_type.as_str() {
                "NoData" => return Err("EWS availability: data unavailable".into()),
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
                subject: xml_content_ns(&event_xml, "t:CalendarEventDetails").and_then(|details| {
                    if xml_content_ns(&details, "t:IsPrivate").as_deref() == Some("true") { None }
                    else { xml_content_ns(&details, "t:Subject").map(|value| xml_decode(&value)) }
                }),
                location: xml_content_ns(&event_xml, "t:CalendarEventDetails").and_then(|details| {
                    if xml_content_ns(&details, "t:IsPrivate").as_deref() == Some("true") { None }
                    else { xml_content_ns(&details, "t:Location").map(|value| xml_decode(&value)) }
                }),
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
        assert!(parse_availability(&xml.replace("<FreeBusyView>", "<FreeBusyView><FreeBusyViewType>None</FreeBusyViewType>"), &emails).is_err());
        assert!(parse_availability(&xml.replace("<BusyType>Tentative", "<BusyType>NoData"), &emails).is_err());
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
            "2026-10-15T15:00:00Z".into(), false, None, None, None, None, true, None, None, None,
        ).await;
        assert_eq!(result.unwrap_err(), "teams_auth_required");
    }
}

fn shared_read_allows_availability(xml: &str) -> bool {
    matches!(xml_content_ns(xml, "m:ResponseCode").as_deref(), Some("ErrorAccessDenied" | "ErrorItemNotFound" | "ErrorFolderNotFound"))
}

fn shared_primary_matches(selected: Option<&str>, primary: Option<&str>) -> bool {
    match selected.filter(|id| !id.is_empty()) {
        None => true,
        Some(selected) => primary == Some(selected),
    }
}

async fn shared_availability_events(token: &str, mailbox: &str, start: &str, end: &str) -> Result<Vec<EwsEvent>, String> {
    let mut events = Vec::new();
    // Exchange limits an availability request to 62 days; use shorter UTC windows.
    for (from, to) in availability_windows(start, end)? {
        let slots = ews_availability_with_token(token, vec![mailbox.into()], from, to, None).await?;
        for slot in slots.into_values().flatten() {
            let event = availability_event(slot);
            if !events.iter().any(|known: &EwsEvent| known.item_id == event.item_id) { events.push(event); }
        }
    }
    Ok(events)
}

fn availability_windows(start: &str, end: &str) -> Result<Vec<(String, String)>, String> {
    let mut from = chrono::DateTime::parse_from_rfc3339(start).map_err(|_| "ews_invalid_availability_range")?.with_timezone(&chrono::Utc);
    let end = chrono::DateTime::parse_from_rfc3339(end).map_err(|_| "ews_invalid_availability_range")?.with_timezone(&chrono::Utc);
    if from >= end || end - from > chrono::Duration::days(1096) { return Err("ews_invalid_availability_range".into()); }
    let mut windows = Vec::new();
    while from < end {
        let to = std::cmp::min(from + chrono::Duration::days(60), end);
        windows.push((from.to_rfc3339_opts(chrono::SecondsFormat::Secs, true), to.to_rfc3339_opts(chrono::SecondsFormat::Secs, true)));
        from = to;
    }
    Ok(windows)
}

fn availability_event(slot: EwsFreeBusySlot) -> EwsEvent {
    EwsEvent {
        item_id: format!("availability:{}:{}:{}", slot.start, slot.end, slot.busy_type),
        change_key: String::new(), subject: slot.subject.unwrap_or_default(),
        start: slot.start, end: slot.end, is_all_day: false, location: slot.location,
        organizer_name: None, organizer_email: None, my_response_type: "Accept".into(),
        attendees: Vec::new(), is_meeting: false, is_cancelled: false, recurring_master_id: None, body: None,
        availability_only: true,
        sensitivity: None, availability: Some(slot.busy_type),
    }
}

// Retain the failing operation and SOAP code, never identifiers or the full server response.
fn shared_calendar_read_error(xml: &str, folder_id: Option<&str>, message: &str) -> String {
    let code = xml_content_ns(xml, "m:ResponseCode").filter(|code|
        code.starts_with("Error") && code.len() < 96 && code.bytes().all(|byte| byte.is_ascii_alphanumeric())
    ).unwrap_or_else(|| "UnknownEwsError".into());
    let target = if folder_id.is_some_and(|id| !id.trim().is_empty()) { "selected-folder" } else { "default-calendar" };
    format!("[ews-shared-read-v2 FindItem {code} {target}] {message}")
}

// Discovery and subsequent reads must route to the same mailbox, including GetItem batches.
fn calendar_anchor_mailbox<'a>(shared_mailbox: Option<&'a str>, owner_email: Option<&'a str>) -> Option<&'a str> {
    shared_mailbox.filter(|email| !email.trim().is_empty())
        .or_else(|| owner_email.filter(|email| !email.trim().is_empty()))
}

// A shared mailbox must be in the folder identifier; X-AnchorMailbox only routes requests.
fn calendar_parent(folder_id: Option<&str>, mailbox: Option<&str>) -> String {
    if let Some(id) = folder_id.filter(|id| !id.is_empty()) {
        return format!(r#"<t:FolderId Id="{}"/>"#, xml_escape(id));
    }
    let mailbox = mailbox.map(|email| format!("<t:Mailbox><t:EmailAddress>{}</t:EmailAddress></t:Mailbox>", xml_escape(email))).unwrap_or_default();
    format!(r#"<t:DistinguishedFolderId Id="calendar">{mailbox}</t:DistinguishedFolderId>"#)
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SharedCalendarFolder { id: String, name: String }

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SharedCalendarFolders { calendars: Vec<SharedCalendarFolder>, limited_discovery: bool }

pub async fn ews_shared_calendars(access_token: String, email: String) -> Result<SharedCalendarFolders, String> {
    let parent = calendar_parent(None, Some(&email));
    let body = format!("<m:GetFolder><m:FolderShape><t:BaseShape>Default</t:BaseShape></m:FolderShape><m:FolderIds>{parent}</m:FolderIds></m:GetFolder>");
    let primary = shared_folder_response(send_ews_request(&access_token, &body, Some(&email)).await);
    let mut calendars = primary.as_ref().map(|xml| parse_shared_folders(xml)).unwrap_or_default();
    let root = format!(r#"<t:DistinguishedFolderId Id="msgfolderroot"><t:Mailbox><t:EmailAddress>{}</t:EmailAddress></t:Mailbox></t:DistinguishedFolderId>"#, xml_escape(&email));
    let body = format!(r#"<m:FindFolder Traversal="Deep"><m:FolderShape><t:BaseShape>Default</t:BaseShape></m:FolderShape><m:IndexedPageFolderView MaxEntriesReturned="100" Offset="0" BasePoint="Beginning"/><m:Restriction><t:IsEqualTo><t:FieldURI FieldURI="folder:FolderClass"/><t:FieldURIOrConstant><t:Constant Value="IPF.Appointment"/></t:FieldURIOrConstant></t:IsEqualTo></m:Restriction><m:ParentFolderIds>{root}</m:ParentFolderIds></m:FindFolder>"#);
    // Folder-level calendar sharing may not grant permission to enumerate the mailbox root.
    let limited_discovery = match shared_folder_response(send_ews_request(&access_token, &body, Some(&email)).await) {
        Ok(xml) => {
            for folder in parse_shared_folders(&xml) {
                if !calendars.iter().any(|known| known.id == folder.id) { calendars.push(folder); }
            }
            !xml.contains("IncludesLastItemInRange=\"true\"")
        }
        Err(_) => true,
    };
    if calendars.is_empty() {
        let error = primary.err().unwrap_or_else(|| "ews_shared_invalid_response".into());
        if error == "ews_shared_access_denied" || error == "ews_shared_folder_not_found" {
            let now = chrono::Utc::now();
            ews_availability_with_token(&access_token, vec![email.clone()], now.to_rfc3339_opts(chrono::SecondsFormat::Secs, true), (now + chrono::Duration::days(1)).to_rfc3339_opts(chrono::SecondsFormat::Secs, true), None).await?;
            calendars.push(SharedCalendarFolder { id: String::new(), name: String::new() });
        } else { return Err(error); }
    }
    Ok(SharedCalendarFolders { calendars, limited_discovery })
}

// EWS can return HTTP 200 with a SOAP error; never treat it as an empty folder list.
fn shared_folder_response(response: Result<String, String>) -> Result<String, String> {
    let xml = response.map_err(|error| {
        if error.contains("ews_unauthorized") || error.contains("401") { "ews_shared_unauthorized" }
        else if error.contains("403") { "ews_shared_access_denied" }
        else { "ews_shared_request_failed" }.to_string()
    })?;
    let code = xml_content_ns(&xml, "m:ResponseCode").unwrap_or_default();
    if code == "NoError" { return Ok(xml); }
    let error = match code.as_str() {
        "ErrorAccessDenied" | "ErrorAccessModeSpecified" => "ews_shared_access_denied",
        "ErrorFolderNotFound" | "ErrorItemNotFound" => "ews_shared_folder_not_found",
        "ErrorNonExistentMailbox" | "ErrorInvalidSmtpAddress" | "ErrorRecipientNotFound" => "ews_shared_mailbox_not_found",
        "ErrorInvalidClientAccessToken" | "ErrorInvalidToken" | "ErrorTokenExpired" => "ews_shared_unauthorized",
        "ErrorServerBusy" | "ErrorTimeoutExpired" => "ews_shared_server_busy",
        _ => "ews_shared_invalid_response",
    };
    Err(error.into())
}

fn parse_shared_folders(xml: &str) -> Vec<SharedCalendarFolder> {
    xml_all_ns(xml, "t:CalendarFolder").iter().filter_map(|folder| {
        let start = folder.find("<t:FolderId ").or_else(|| folder.find("<FolderId "))?;
        let id = xml_attr(&folder[start..], "Id")?;
        Some(SharedCalendarFolder { id: xml_decode(&id), name: xml_decode(&xml_content_ns(folder, "t:DisplayName").unwrap_or_default()) })
    }).collect()
}

#[cfg(test)]
mod shared_calendar_tests {
    use super::*;
    #[test]
    fn availability_fallback_never_substitutes_a_secondary_calendar() {
        assert!(shared_primary_matches(None, None));
        assert!(shared_primary_matches(Some(""), None));
        assert!(shared_primary_matches(Some("primary-id"), Some("primary-id")));
        assert!(!shared_primary_matches(Some("secondary-id"), Some("primary-id")));
        assert!(!shared_primary_matches(Some("selected-id"), None));
        assert!(shared_read_allows_availability("<m:ResponseCode>ErrorItemNotFound</m:ResponseCode>"));
        assert!(shared_read_allows_availability("<ResponseCode>ErrorAccessDenied</ResponseCode>"));
        assert!(!shared_read_allows_availability("<ResponseCode>ErrorServerBusy</ResponseCode>"));
        assert!(!shared_read_allows_availability("<ResponseCode>ErrorInvalidToken</ResponseCode>"));
    }
    #[test]
    fn availability_splits_long_calendar_ranges_without_gaps_or_overlaps() {
        let windows = availability_windows("2026-01-01T00:00:00Z", "2026-08-01T00:00:00Z").unwrap();
        assert_eq!(windows.len(), 4);
        assert_eq!(windows[0].0, "2026-01-01T00:00:00Z");
        assert_eq!(windows.last().unwrap().1, "2026-08-01T00:00:00Z");
        for pair in windows.windows(2) { assert_eq!(pair[0].1, pair[1].0); }
        for (from, to) in &windows {
            let duration = chrono::DateTime::parse_from_rfc3339(to).unwrap() - chrono::DateTime::parse_from_rfc3339(from).unwrap();
            assert!(duration <= chrono::Duration::days(60));
        }
        assert!(availability_windows("invalid", "2026-08-01T00:00:00Z").is_err());
        assert!(availability_windows("2026-08-01T00:00:00Z", "2026-01-01T00:00:00Z").is_err());
    }
    #[test]
    fn availability_preserves_allowed_details_and_anonymizes_private_events() {
        let xml = r#"<FreeBusyResponse><ResponseMessage ResponseClass="Success"><ResponseCode>NoError</ResponseCode></ResponseMessage><FreeBusyView><CalendarEventArray><CalendarEvent><StartTime>2026-10-16T14:00:00</StartTime><EndTime>2026-10-16T15:00:00</EndTime><BusyType>Busy</BusyType><CalendarEventDetails><Subject>Team &amp; planning</Subject><Location>Room</Location><IsPrivate>false</IsPrivate></CalendarEventDetails></CalendarEvent></CalendarEventArray></FreeBusyView></FreeBusyResponse>"#;
        let emails = vec!["other@example.com".into()];
        let slots = parse_availability(xml, &emails).unwrap();
        let event = availability_event(slots.into_values().next().unwrap().remove(0));
        assert_eq!(event.subject, "Team & planning");
        assert_eq!(event.location.as_deref(), Some("Room"));
        assert!(event.availability_only);
        assert!(!event.is_meeting);
        assert!(event.attendees.is_empty());
        let private = xml.replace("<IsPrivate>false", "<IsPrivate>true");
        let slots = parse_availability(&private, &emails).unwrap();
        assert!(slots[&emails[0]][0].subject.is_none());
        assert!(slots[&emails[0]][0].location.is_none());
        let busy_only = xml.replace("<CalendarEventDetails><Subject>Team &amp; planning</Subject><Location>Room</Location><IsPrivate>false</IsPrivate></CalendarEventDetails>", "");
        let slots = parse_availability(&busy_only, &emails).unwrap();
        assert_eq!(slots[&emails[0]][0].start, "2026-10-16T14:00:00Z");
        assert!(slots[&emails[0]][0].subject.is_none());
    }
    #[test]
    fn shared_read_errors_identify_the_stage_and_target_without_leaking_identifiers() {
        let xml = "<m:ResponseCode>ErrorItemNotFound</m:ResponseCode><t:FolderId Id=\"private-id\"/>";
        let error = shared_calendar_read_error(xml, Some("private-id"), "Item not found.");
        assert_eq!(error, "[ews-shared-read-v2 FindItem ErrorItemNotFound selected-folder] Item not found.");
        assert!(!error.contains("private-id"));
        assert!(shared_calendar_read_error(xml, None, "Item not found.").contains("default-calendar"));
    }
    #[test]
    fn shared_calendar_reads_route_to_the_discovered_mailbox_even_without_owner_email() {
        assert_eq!(calendar_anchor_mailbox(Some("shared@example.com"), None), Some("shared@example.com"));
        assert_eq!(calendar_anchor_mailbox(Some("shared@example.com"), Some("me@example.com")), Some("shared@example.com"));
        assert_eq!(calendar_anchor_mailbox(None, Some("me@example.com")), Some("me@example.com"));
        assert_eq!(calendar_anchor_mailbox(Some(" "), Some("me@example.com")), Some("me@example.com"));
        assert_eq!(calendar_anchor_mailbox(None, None), None);
        // Retain the selected secondary folder; do not silently use the default calendar.
        assert_eq!(calendar_parent(Some("secondary-folder"), Some("shared@example.com")), r#"<t:FolderId Id="secondary-folder"/>"#);
    }
    #[test]
    fn shared_mailbox_and_folder_identifiers_are_explicit_and_escaped() {
        assert!(calendar_parent(None, Some("a&b@example.com")).contains("<t:EmailAddress>a&amp;b@example.com</t:EmailAddress>"));
        assert_eq!(calendar_parent(Some("a\"&"), Some("other@example.com")), r#"<t:FolderId Id="a&quot;&amp;"/>"#);
        assert!(!calendar_parent(None, None).contains("Mailbox"));
    }
    #[test]
    fn soap_errors_are_reported_even_when_http_succeeded() {
        for (code, expected) in [
            ("ErrorAccessDenied", "ews_shared_access_denied"),
            ("ErrorFolderNotFound", "ews_shared_folder_not_found"),
            ("ErrorNonExistentMailbox", "ews_shared_mailbox_not_found"),
            ("ErrorInvalidSmtpAddress", "ews_shared_mailbox_not_found"),
            ("ErrorServerBusy", "ews_shared_server_busy"),
        ] {
            let xml = format!("<m:GetFolderResponseMessage ResponseClass=\"Error\"><m:ResponseCode>{code}</m:ResponseCode><m:MessageText>Private provider detail</m:MessageText></m:GetFolderResponseMessage>");
            assert_eq!(shared_folder_response(Ok(xml)).unwrap_err(), expected);
        }
        assert!(shared_folder_response(Ok("<ResponseCode>NoError</ResponseCode>".into())).is_ok());
        assert_eq!(shared_folder_response(Ok("<html>unexpected response</html>".into())).unwrap_err(), "ews_shared_invalid_response");
        assert_eq!(shared_folder_response(Err("EWS HTTP 403: private body".into())).unwrap_err(), "ews_shared_access_denied");
    }
    #[test]
    fn shared_folders_keep_their_names_and_ids() {
        let folders = parse_shared_folders(r#"<t:Folders><t:CalendarFolder><t:FolderId Id="one"/><t:DisplayName>Research &amp; work</t:DisplayName></t:CalendarFolder><t:CalendarFolder><t:FolderId Id="two"/><t:DisplayName>Team</t:DisplayName></t:CalendarFolder></t:Folders>"#);
        assert_eq!(folders.len(), 2);
        assert_eq!(folders[0].name, "Research & work");
        assert_eq!(folders[1].id, "two");
    }
}

#[cfg(test)]
mod event_options_tests {
    #[test]
    fn validates_independent_ews_values_and_rejects_injected_xml() {
        for availability in ["Free", "Tentative", "Busy", "OOF", "WorkingElsewhere"] {
            for sensitivity in ["Normal", "Personal", "Private", "Confidential"] {
                assert!(super::validate_event_options(Some(sensitivity), Some(availability)).is_ok());
            }
        }
        assert!(super::validate_event_options(None, None).is_ok());
        assert!(super::validate_event_options(Some("Private</t:Sensitivity>"), None).is_err());
        assert!(super::validate_event_options(None, Some("NoData")).is_err());
    }

    #[test]
    fn reads_privacy_and_absence_from_ews() {
        let xml = r#"<m:FindItemResponseMessage ResponseClass="Success"><m:ResponseCode>NoError</m:ResponseCode><t:CalendarItem><t:ItemId Id="id" ChangeKey="key"/><t:Subject>Absence</t:Subject><t:Start>2026-10-20T08:00:00Z</t:Start><t:End>2026-10-20T18:00:00Z</t:End><t:Sensitivity>Private</t:Sensitivity><t:LegacyFreeBusyStatus>OOF</t:LegacyFreeBusyStatus></t:CalendarItem></m:FindItemResponseMessage>"#;
        let events = super::parse_calendar_events(xml).unwrap();
        assert_eq!(events[0].sensitivity.as_deref(), Some("Private"));
        assert_eq!(events[0].availability.as_deref(), Some("OOF"));
    }
}

#[cfg(test)]
mod event_version_tests {
    use super::*;

    #[test]
    fn latest_read_keeps_version_and_editable_fields_together() {
        let old = r#"<t:CalendarItem><t:ItemId Id="event" ChangeKey="old"/><t:Subject>Old</t:Subject><t:Start>2026-10-20T08:00:00Z</t:Start><t:End>2026-10-20T09:00:00Z</t:End></t:CalendarItem>"#;
        let mut events = parse_calendar_events(old).unwrap();
        let latest = old.replace("old", "new").replace("Old", "Updated").replace("</t:CalendarItem>", "<t:Sensitivity>Private</t:Sensitivity><t:LegacyFreeBusyStatus>OOF</t:LegacyFreeBusyStatus></t:CalendarItem>");
        refresh_event_snapshots(&mut events, &latest).unwrap();
        assert_eq!(events[0].change_key, "new");
        assert_eq!(events[0].subject, "Updated");
        assert_eq!(events[0].sensitivity.as_deref(), Some("Private"));
        assert_eq!(events[0].availability.as_deref(), Some("OOF"));
        refresh_event_snapshots(&mut events, r#"<t:CalendarItem><t:ItemId Id="event" ChangeKey="incomplete"/></t:CalendarItem>"#).unwrap();
        assert_eq!(events[0].change_key, "new");
    }

    #[test]
    fn series_lookup_rejects_a_stale_occurrence_before_resolving_its_master() {
        let current = r#"<m:ResponseCode>NoError</m:ResponseCode><t:CalendarItem><t:ItemId Id="occurrence" ChangeKey="current"/></t:CalendarItem>"#;
        assert!(verify_event_version(current, "current").is_ok());
        assert!(verify_event_version(current, "stale").unwrap_err().contains("ErrorIrresolvableConflict"));
        assert!(verify_event_version(current, "").is_err());
        assert!(verify_event_version(&current.replace("NoError", "ErrorAccessDenied"), "current").is_err());
        let master = current.replace("occurrence", "master").replace("current", "master-key");
        assert_eq!(parse_response_master(&master).unwrap(), ("master".into(), "master-key".into()));
    }
}
