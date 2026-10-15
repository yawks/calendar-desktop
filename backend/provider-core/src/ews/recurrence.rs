use chrono::{Datelike, NaiveDate};
use std::collections::HashMap;

/// Convert the supported editor rules to EWS. Reject unsupported input before sending SOAP.
pub fn recurrence_xml(rule: &str, start: &str) -> Result<String, String> {
    let invalid = || "Invalid recurrence rule".to_string();
    let date = NaiveDate::parse_from_str(start.get(..10).ok_or_else(invalid)?, "%Y-%m-%d").map_err(|_| invalid())?;
    let mut fields = HashMap::new();
    for part in rule.split(';') {
        let (key, value) = part.split_once('=').ok_or_else(invalid)?;
        if !["FREQ", "INTERVAL", "BYDAY", "COUNT", "UNTIL"].contains(&key) || fields.insert(key, value).is_some() { return Err(invalid()); }
    }
    let number = |value: &str| -> Result<u32, String> {
        value.parse::<u32>().ok().filter(|n| (1..=999).contains(n)).ok_or_else(invalid)
    };
    let interval = number(fields.get("INTERVAL").copied().unwrap_or("1"))?;
    let day_names = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];
    let day_codes = ["MO", "TU", "WE", "TH", "FR", "SA", "SU"];
    let pattern = match fields.get("FREQ").copied() {
        Some("DAILY") => format!("<t:DailyRecurrence><t:Interval>{interval}</t:Interval></t:DailyRecurrence>"),
        Some("WEEKLY") => {
            let days = fields.get("BYDAY").ok_or_else(invalid)?.split(',').map(|code| {
                day_codes.iter().position(|day| *day == code).map(|i| day_names[i]).ok_or_else(invalid)
            }).collect::<Result<Vec<_>, _>>()?;
            format!("<t:WeeklyRecurrence><t:Interval>{interval}</t:Interval><t:DaysOfWeek>{}</t:DaysOfWeek><t:FirstDayOfWeek>Monday</t:FirstDayOfWeek></t:WeeklyRecurrence>", days.join(" "))
        }
        Some("MONTHLY") => {
            if let Some(day) = fields.get("BYDAY") {
                let split = day.len().checked_sub(2).ok_or_else(invalid)?;
                if !day.is_ascii() { return Err(invalid()); }
                let name = day_codes.iter().position(|code| *code == &day[split..]).map(|i| day_names[i]).ok_or_else(invalid)?;
                let ordinal = match &day[..split] { "1" => "First", "2" => "Second", "3" => "Third", "4" => "Fourth", "-1" => "Last", _ => return Err(invalid()) };
                format!("<t:RelativeMonthlyRecurrence><t:Interval>{interval}</t:Interval><t:DaysOfWeek>{name}</t:DaysOfWeek><t:DayOfWeekIndex>{ordinal}</t:DayOfWeekIndex></t:RelativeMonthlyRecurrence>")
            } else {
                format!("<t:AbsoluteMonthlyRecurrence><t:Interval>{interval}</t:Interval><t:DayOfMonth>{}</t:DayOfMonth></t:AbsoluteMonthlyRecurrence>", date.day())
            }
        }
        Some("YEARLY") if interval == 1 => {
            let month = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"][date.month0() as usize];
            format!("<t:AbsoluteYearlyRecurrence><t:DayOfMonth>{}</t:DayOfMonth><t:Month>{month}</t:Month></t:AbsoluteYearlyRecurrence>", date.day())
        }
        _ => return Err(invalid()),
    };
    let range = match (fields.get("COUNT"), fields.get("UNTIL")) {
        (Some(count), None) => format!("<t:NumberedRecurrence><t:StartDate>{date}</t:StartDate><t:NumberOfOccurrences>{}</t:NumberOfOccurrences></t:NumberedRecurrence>", number(count)?),
        (None, Some(until)) => {
            let end = NaiveDate::parse_from_str(until.get(..8).ok_or_else(invalid)?, "%Y%m%d").map_err(|_| invalid())?;
            if end < date { return Err(invalid()); }
            format!("<t:EndDateRecurrence><t:StartDate>{date}</t:StartDate><t:EndDate>{end}</t:EndDate></t:EndDateRecurrence>")
        }
        (None, None) => format!("<t:NoEndRecurrence><t:StartDate>{date}</t:StartDate></t:NoEndRecurrence>"),
        _ => return Err(invalid()),
    };
    Ok(format!("<t:Recurrence>{pattern}{range}</t:Recurrence>"))
}

pub fn recurrence_update_xml(rule: Option<&str>, start: &str) -> Result<String, String> {
    match rule {
        None => Ok(String::new()),
        Some("") => Ok("<t:DeleteItemField><t:FieldURI FieldURI=\"calendar:Recurrence\"/></t:DeleteItemField>".into()),
        Some(rule) => Ok(format!("<t:SetItemField><t:FieldURI FieldURI=\"calendar:Recurrence\"/><t:CalendarItem>{}</t:CalendarItem></t:SetItemField>", recurrence_xml(rule, start)?)),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn reads_exchange_rule_for_the_editor() {
        let xml = "<t:Recurrence><t:WeeklyRecurrence><t:Interval>2</t:Interval><t:DaysOfWeek>Monday Thursday</t:DaysOfWeek></t:WeeklyRecurrence><t:NumberedRecurrence><t:StartDate>2026-10-15</t:StartDate><t:NumberOfOccurrences>13</t:NumberOfOccurrences></t:NumberedRecurrence></t:Recurrence>";
        assert_eq!(rule_from_xml(xml).as_deref(), Some("FREQ=WEEKLY;INTERVAL=2;BYDAY=MO,TH;COUNT=13"));
        assert_eq!(rule_from_xml("<t:Recurrence><t:RelativeYearlyRecurrence/></t:Recurrence>"), None);
    }
    #[test]
    fn supported_rules_and_invalid_input() {
        assert!(recurrence_xml("FREQ=WEEKLY;BYDAY=MO,FR;COUNT=13", "2026-10-15").unwrap().contains("Monday Friday"));
        assert!(recurrence_xml("FREQ=MONTHLY;BYDAY=-1TH;UNTIL=20270114", "2026-10-15").unwrap().contains("Last"));
        assert!(recurrence_xml("FREQ=DAILY;INTERVAL=0", "2026-10-15").is_err());
        assert!(recurrence_xml("FREQ=WEEKLY;BYDAY=<xml>", "2026-10-15").is_err());
        assert!(recurrence_xml("FREQ=DAILY;UNTIL=20200101", "2026-10-15").is_err());
        assert!(recurrence_update_xml(None, "2026-10-15").unwrap().is_empty());
        assert!(recurrence_update_xml(Some(""), "2026-10-15").unwrap().contains("DeleteItemField"));
    }
}

pub async fn get_recurrence(access_token: String, item_id: String) -> Result<Option<String>, String> {
    let body = format!(r#"<m:GetItem><m:ItemShape><t:BaseShape>IdOnly</t:BaseShape><t:AdditionalProperties><t:FieldURI FieldURI="calendar:Recurrence"/></t:AdditionalProperties></m:ItemShape><m:ItemIds><t:RecurringMasterItemId OccurrenceId="{}"/></m:ItemIds></m:GetItem>"#, super::xml_escape(&item_id));
    let xml = super::send_ews_request(&access_token, &body, None).await?;
    if xml.contains("ResponseClass=\"Error\"") { return Err(super::xml_content(&xml, "m:MessageText").unwrap_or_else(|| "EWS recurrence read error".into())); }
    Ok(rule_from_xml(&xml))
}

fn rule_from_xml(xml: &str) -> Option<String> {
    let recurrence = super::xml_content(xml, "t:Recurrence")?;
    let value = |name: &str| super::xml_content(&recurrence, &format!("t:{name}"));
    let frequency = if recurrence.contains("<t:DailyRecurrence>") { "DAILY" }
        else if recurrence.contains("<t:WeeklyRecurrence>") { "WEEKLY" }
        else if recurrence.contains("<t:AbsoluteMonthlyRecurrence>") || recurrence.contains("<t:RelativeMonthlyRecurrence>") { "MONTHLY" }
        else if recurrence.contains("<t:AbsoluteYearlyRecurrence>") { "YEARLY" } else { return None; };
    let mut parts = vec![format!("FREQ={frequency}"), format!("INTERVAL={}", value("Interval").unwrap_or_else(|| "1".into()))];
    if let Some(days) = value("DaysOfWeek") {
        let ordinal = match value("DayOfWeekIndex").as_deref() { Some("First") => "1", Some("Second") => "2", Some("Third") => "3", Some("Fourth") => "4", Some("Last") => "-1", None => "", _ => return None };
        let mut codes = Vec::new();
        for day in days.split_whitespace() {
            let code = match day { "Monday" => "MO", "Tuesday" => "TU", "Wednesday" => "WE", "Thursday" => "TH", "Friday" => "FR", "Saturday" => "SA", "Sunday" => "SU", _ => return None };
            codes.push(format!("{ordinal}{code}"));
        }
        parts.push(format!("BYDAY={}", codes.join(",")));
    }
    if let Some(count) = value("NumberOfOccurrences") { parts.push(format!("COUNT={count}")); }
    if let Some(until) = value("EndDate") { parts.push(format!("UNTIL={}", until.get(..10)?.replace('-', ""))); }
    Some(parts.join(";"))
}
