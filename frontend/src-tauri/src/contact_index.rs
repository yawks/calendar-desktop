use rusqlite::{params, Connection};
use serde::{Deserialize, Serialize};
use std::{fs, time::Duration};
use tauri::{command, AppHandle, Manager};

const DEFAULT_RETENTION_DAYS: i64 = 365;

#[derive(Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ContactObservation {
    pub email: String,
    pub display_name: Option<String>,
    pub kind: String,
    pub occurred_at: i64,
    pub event_id: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct IndexedContact {
    pub email: String,
    pub name: Option<String>,
    pub received_count: i64,
    pub sent_count: i64,
    pub event_count: i64,
    pub last_seen_at: i64,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BackfillState {
    pub offset: u32,
    pub completed: bool,
}

fn open(app: &AppHandle) -> Result<Connection, String> {
    let dir = app.path().app_data_dir().map_err(|e| e.to_string())?;
    fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    let connection =
        Connection::open(dir.join("contact-index.sqlite3")).map_err(|e| e.to_string())?;
    connection
        .busy_timeout(Duration::from_secs(5))
        .map_err(|e| e.to_string())?;
    initialize(&connection)?;
    Ok(connection)
}

fn initialize(connection: &Connection) -> Result<(), String> {
    connection.execute_batch(
        "PRAGMA journal_mode=WAL;
         PRAGMA foreign_keys=ON;
         CREATE TABLE IF NOT EXISTS contact_index (
           account_id TEXT NOT NULL,
           email TEXT NOT NULL,
           display_name TEXT,
           display_name_quality INTEGER NOT NULL DEFAULT 0,
           received_count INTEGER NOT NULL DEFAULT 0,
           sent_count INTEGER NOT NULL DEFAULT 0,
           event_count INTEGER NOT NULL DEFAULT 0,
           first_seen_at INTEGER NOT NULL,
           last_seen_at INTEGER NOT NULL,
           last_received_at INTEGER,
           last_sent_at INTEGER,
           last_event_at INTEGER,
           PRIMARY KEY (account_id, email)
         );
         CREATE TABLE IF NOT EXISTS contact_observations (
           account_id TEXT NOT NULL,
           email TEXT NOT NULL,
           kind TEXT NOT NULL,
           event_id TEXT NOT NULL,
           occurred_at INTEGER NOT NULL,
           PRIMARY KEY (account_id, email, kind, event_id),
           FOREIGN KEY (account_id, email) REFERENCES contact_index(account_id, email) ON DELETE CASCADE
         );
         CREATE INDEX IF NOT EXISTS idx_contact_search ON contact_index(account_id, email);
         CREATE INDEX IF NOT EXISTS idx_contact_last_seen ON contact_index(last_seen_at);
         CREATE TABLE IF NOT EXISTS contact_backfill_state (
           account_id TEXT NOT NULL,
           folder TEXT NOT NULL,
           offset INTEGER NOT NULL DEFAULT 0,
           completed INTEGER NOT NULL DEFAULT 0,
           updated_at INTEGER NOT NULL,
           PRIMARY KEY (account_id, folder)
         );
         UPDATE contact_index SET display_name = NULL
         WHERE length(display_name) = 36
           AND substr(display_name, 9, 1) = '-'
           AND substr(display_name, 14, 1) = '-'
           AND substr(display_name, 19, 1) = '-'
           AND substr(display_name, 24, 1) = '-';"
    ).map_err(|e| e.to_string())?;
    let has_quality = {
        let mut statement = connection
            .prepare("PRAGMA table_info(contact_index)")
            .map_err(|e| e.to_string())?;
        let columns = statement
            .query_map([], |row| row.get::<_, String>(1))
            .map_err(|e| e.to_string())?;
        let found = columns
            .filter_map(Result::ok)
            .any(|column| column == "display_name_quality");
        found
    };
    if !has_quality {
        connection.execute("ALTER TABLE contact_index ADD COLUMN display_name_quality INTEGER NOT NULL DEFAULT 0", [])
            .map_err(|e| e.to_string())?;
    }
    connection
        .execute(
            "UPDATE contact_index SET display_name = NULL, display_name_quality = 0
         WHERE length(display_name) = 36
           AND substr(display_name,9,1) = '-' AND substr(display_name,14,1) = '-'
           AND substr(display_name,19,1) = '-' AND substr(display_name,24,1) = '-'",
            [],
        )
        .map_err(|e| e.to_string())?;
    Ok(())
}

fn normalized_email(email: &str) -> Option<String> {
    let value = email.trim().to_lowercase();
    (value.contains('@') && !value.contains(char::is_whitespace)).then_some(value)
}

fn display_name_quality(name: Option<&str>, email: &str) -> (Option<String>, i64) {
    let Some(trimmed) = name.map(str::trim).filter(|value| !value.is_empty()) else {
        return (None, 0);
    };
    let looks_like_uuid = trimmed.len() == 36
        && [8, 13, 18, 23]
            .iter()
            .all(|index| trimmed.as_bytes().get(*index) == Some(&b'-'))
        && trimmed
            .chars()
            .all(|character| character.is_ascii_hexdigit() || character == '-');
    if looks_like_uuid || trimmed.eq_ignore_ascii_case(email) || trimmed.contains('@') {
        return (None, 0);
    }
    let quality = if trimmed.chars().any(char::is_whitespace) {
        3
    } else {
        2
    };
    (Some(trimmed.to_string()), quality)
}

#[command]
pub fn contact_index_record(
    app: AppHandle,
    account_id: String,
    observations: Vec<ContactObservation>,
) -> Result<u64, String> {
    let mut connection = open(&app)?;
    let tx = connection.transaction().map_err(|e| e.to_string())?;
    let mut inserted = 0_u64;
    for observation in observations {
        let Some(email) = normalized_email(&observation.email) else {
            continue;
        };
        if !matches!(observation.kind.as_str(), "received" | "sent" | "event") {
            continue;
        }
        let (display_name, display_name_quality) =
            display_name_quality(observation.display_name.as_deref(), &email);
        tx.execute(
            "INSERT INTO contact_index(account_id, email, display_name, display_name_quality, first_seen_at, last_seen_at)
             VALUES (?1, ?2, ?3, ?4, ?5, ?5)
             ON CONFLICT(account_id, email) DO UPDATE SET
               display_name = CASE
                 WHEN excluded.display_name_quality > contact_index.display_name_quality THEN excluded.display_name
                 ELSE contact_index.display_name END,
               display_name_quality = MAX(display_name_quality, excluded.display_name_quality),
               first_seen_at = MIN(first_seen_at, excluded.first_seen_at),
               last_seen_at = MAX(last_seen_at, excluded.last_seen_at)",
            params![account_id, email, display_name, display_name_quality, observation.occurred_at],
        ).map_err(|e| e.to_string())?;
        let changed = tx.execute(
            "INSERT OR IGNORE INTO contact_observations(account_id, email, kind, event_id, occurred_at)
             VALUES (?1, ?2, ?3, ?4, ?5)",
            params![account_id, email, observation.kind, observation.event_id, observation.occurred_at],
        ).map_err(|e| e.to_string())?;
        if changed == 0 {
            continue;
        }
        inserted += 1;
        let (count_column, date_column) = match observation.kind.as_str() {
            "sent" => ("sent_count", "last_sent_at"),
            "event" => ("event_count", "last_event_at"),
            _ => ("received_count", "last_received_at"),
        };
        tx.execute(
            &format!(
                "UPDATE contact_index SET {count_column} = {count_column} + 1,
                       {date_column} = MAX(COALESCE({date_column}, 0), ?3)
                       WHERE account_id = ?1 AND email = ?2"
            ),
            params![account_id, email, observation.occurred_at],
        )
        .map_err(|e| e.to_string())?;
    }
    tx.commit().map_err(|e| e.to_string())?;
    Ok(inserted)
}

#[command]
pub fn contact_index_search(
    app: AppHandle,
    account_ids: Vec<String>,
    query: String,
    max_count: Option<u32>,
) -> Result<Vec<IndexedContact>, String> {
    if account_ids.is_empty() {
        return Ok(Vec::new());
    }
    let connection = open(&app)?;
    let cutoff = chrono::Utc::now().timestamp() - DEFAULT_RETENTION_DAYS * 86_400;
    let placeholders = (1..=account_ids.len())
        .map(|i| format!("?{i}"))
        .collect::<Vec<_>>()
        .join(",");
    let query_param = format!("{}%", query.trim().to_lowercase());
    let query_index = account_ids.len() + 1;
    let limit_index = account_ids.len() + 2;
    let sql = format!(
        "SELECT email, MAX(display_name), SUM(received_count), SUM(sent_count), SUM(event_count), MAX(last_seen_at)
         FROM contact_index
         WHERE account_id IN ({placeholders}) AND last_seen_at >= ?{cutoff_index}
           AND (?{query_index} = '%' OR email LIKE ?{query_index} OR LOWER(COALESCE(display_name, '')) LIKE ?{query_index})
         GROUP BY email
         ORDER BY (SUM(sent_count) * 8 + SUM(received_count) * 2 + SUM(event_count) * 4
                   + CASE WHEN MAX(last_seen_at) >= strftime('%s','now','-7 days') THEN 20
                          WHEN MAX(last_seen_at) >= strftime('%s','now','-90 days') THEN 8 ELSE 0 END) DESC,
                  MAX(last_seen_at) DESC
         LIMIT ?{limit_index}",
        cutoff_index = account_ids.len() + 3,
    );
    let mut values: Vec<Box<dyn rusqlite::ToSql>> = account_ids
        .into_iter()
        .map(|value| Box::new(value) as Box<dyn rusqlite::ToSql>)
        .collect();
    values.push(Box::new(query_param));
    values.push(Box::new(max_count.unwrap_or(200).min(1000)));
    values.push(Box::new(cutoff));
    let refs = values
        .iter()
        .map(|value| value.as_ref())
        .collect::<Vec<_>>();
    let mut statement = connection.prepare(&sql).map_err(|e| e.to_string())?;
    let rows = statement
        .query_map(refs.as_slice(), |row| {
            Ok(IndexedContact {
                email: row.get(0)?,
                name: row.get(1)?,
                received_count: row.get(2)?,
                sent_count: row.get(3)?,
                event_count: row.get(4)?,
                last_seen_at: row.get(5)?,
            })
        })
        .map_err(|e| e.to_string())?;
    rows.collect::<Result<Vec<_>, _>>()
        .map_err(|e| e.to_string())
}

#[command]
pub fn contact_index_cleanup(app: AppHandle, max_age_days: Option<u32>) -> Result<u64, String> {
    let connection = open(&app)?;
    let days = i64::from(max_age_days.unwrap_or(DEFAULT_RETENTION_DAYS as u32).max(1));
    let cutoff = chrono::Utc::now().timestamp() - days * 86_400;
    cleanup_before(&connection, cutoff)
}

#[command]
pub fn contact_backfill_get_state(
    app: AppHandle,
    account_id: String,
    folder: String,
) -> Result<BackfillState, String> {
    let connection = open(&app)?;
    connection.query_row(
        "SELECT offset, completed FROM contact_backfill_state WHERE account_id = ?1 AND folder = ?2",
        params![account_id, folder],
        |row| Ok(BackfillState { offset: row.get(0)?, completed: row.get::<_, i64>(1)? != 0 }),
    ).or_else(|error| {
        if error == rusqlite::Error::QueryReturnedNoRows {
            Ok(BackfillState { offset: 0, completed: false })
        } else {
            Err(error)
        }
    }).map_err(|e| e.to_string())
}

#[command]
pub fn contact_backfill_set_state(
    app: AppHandle,
    account_id: String,
    folder: String,
    offset: u32,
    completed: bool,
) -> Result<(), String> {
    let connection = open(&app)?;
    connection.execute(
        "INSERT INTO contact_backfill_state(account_id, folder, offset, completed, updated_at)
         VALUES (?1, ?2, ?3, ?4, strftime('%s','now'))
         ON CONFLICT(account_id, folder) DO UPDATE SET
           offset = excluded.offset, completed = excluded.completed, updated_at = excluded.updated_at",
        params![account_id, folder, offset, completed],
    ).map(|_| ()).map_err(|e| e.to_string())
}

fn cleanup_before(connection: &Connection, cutoff: i64) -> Result<u64, String> {
    connection
        .execute(
            "DELETE FROM contact_index WHERE last_seen_at < ?1",
            [cutoff],
        )
        .map(|count| count as u64)
        .map_err(|e| e.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn cleanup_removes_only_stale_contacts_and_their_observations() {
        let connection = Connection::open_in_memory().unwrap();
        initialize(&connection).unwrap();
        for (email, timestamp) in [
            ("old@example.com", 100_i64),
            ("recent@example.com", 500_i64),
        ] {
            connection.execute(
                "INSERT INTO contact_index(account_id,email,first_seen_at,last_seen_at) VALUES ('account',?1,?2,?2)",
                params![email, timestamp],
            ).unwrap();
            connection
                .execute(
                    "INSERT INTO contact_observations(account_id,email,kind,event_id,occurred_at)
                 VALUES ('account',?1,'received','message',?2)",
                    params![email, timestamp],
                )
                .unwrap();
        }

        assert_eq!(cleanup_before(&connection, 300).unwrap(), 1);
        let contacts: i64 = connection
            .query_row("SELECT COUNT(*) FROM contact_index", [], |row| row.get(0))
            .unwrap();
        let observations: i64 = connection
            .query_row("SELECT COUNT(*) FROM contact_observations", [], |row| {
                row.get(0)
            })
            .unwrap();
        assert_eq!(contacts, 1);
        assert_eq!(observations, 1);
    }

    #[test]
    fn email_normalization_rejects_invalid_values() {
        assert_eq!(
            normalized_email(" Alice@Example.COM ").as_deref(),
            Some("alice@example.com")
        );
        assert_eq!(normalized_email("not-an-email"), None);
        assert_eq!(normalized_email("bad address@example.com"), None);
    }

    #[test]
    fn technical_uuid_is_not_a_display_name() {
        assert_eq!(
            display_name_quality(
                Some("7e00f310-9430-4d22-9f61-d04addd597ef"),
                "a@example.com"
            ),
            (None, 0)
        );
        assert_eq!(
            display_name_quality(Some("Alice Martin"), "a@example.com"),
            (Some("Alice Martin".to_string()), 3)
        );
    }
}
