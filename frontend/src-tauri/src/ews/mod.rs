use serde::{Deserialize, Serialize};
use tauri::command;
use chrono::Local;

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

pub mod calendar;
pub use calendar::*;

// ── Internal helpers ───────────────────────────────────────────────────────────

pub(crate) fn soap_envelope(body: &str) -> String {
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

pub(crate) async fn send_ews_request(
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

/// Escape XML special characters in a text value.
pub(crate) fn xml_escape(s: &str) -> String {
    s.replace('&', "&amp;")
     .replace('<', "&lt;")
     .replace('>', "&gt;")
     .replace('"', "&quot;")
     .replace('\'', "&apos;")
}

/// Extract the text content of the first occurrence of `<tag>…</tag>`.
/// Uses exact tag-name matching: the character immediately after the tag name must be
/// `>` or whitespace, so that `<t:Content` does NOT match `<t:ContentType>`.
pub(crate) fn xml_content(xml: &str, tag: &str) -> Option<String> {
    let open_prefix = format!("<{}", tag);
    let close_tag = format!("</{}>", tag);
    let bytes = xml.as_bytes();

    let mut search_from = 0;
    let open_pos = loop {
        let rel = xml[search_from..].find(&open_prefix)?;
        let pos = search_from + rel;
        // The byte right after the tag name must be '>', ' ', '\t', '\n', '\r', or '/'
        // (self-closing tags), but NOT another identifier character.
        match bytes.get(pos + open_prefix.len()) {
            Some(b'>') | Some(b' ') | Some(b'\t') | Some(b'\n') | Some(b'\r') | Some(b'/') | None => break pos,
            _ => search_from = pos + 1,
        }
    };

    let gt_pos = xml[open_pos..].find('>')? + open_pos + 1;
    let close_pos = xml[gt_pos..].find(&close_tag)? + gt_pos;

    Some(xml[gt_pos..close_pos].to_string())
}

pub(crate) fn xml_content_ns(xml: &str, tag: &str) -> Option<String> {
    if let Some(content) = xml_content(xml, tag) {
        return Some(content);
    }
    if let Some(colon) = tag.find(':') {
        return xml_content(xml, &tag[colon + 1..]);
    }
    xml_content(xml, &format!("t:{}", tag))
}

pub(crate) fn xml_all_ns(xml: &str, tag: &str) -> Vec<String> {
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
pub(crate) fn xml_attr(element: &str, attr: &str) -> Option<String> {
    let needle = format!("{}=\"", attr);
    let start = element.find(&needle)? + needle.len();
    let end = element[start..].find('"')? + start;
    Some(element[start..end].to_string())
}

/// Collect all occurrences of `<tag …>…</tag>` in `xml`.
pub(crate) fn xml_all(xml: &str, tag: &str) -> Vec<String> {
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

        // RecurringMasterId is included for recurring exceptions; use it as a stable series identifier.
        let recurring_master_id = xml_content(&item_xml, "t:RecurringMasterId").filter(|s| !s.is_empty());

        // recurring_master_id may be enriched later via batch GetItem (CleanGlobalObjectId) if available.
        let recurring_master_id = recurring_master_id;

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
            .filter(|s| !s.is_empty())
            // Fallback: for recurring exceptions, RecurringMasterId is a stable series identifier.
            .or_else(|| xml_content(&item_xml, "t:RecurringMasterId").filter(|s| !s.is_empty()));

        results.push(GetItemDetail { item_id, organizer_name, organizer_email, attendees, clean_global_object_id });
    }

    results
}
