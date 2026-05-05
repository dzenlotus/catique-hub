//! `settings` repository — generic key/value store backed by the
//! `settings` table (Promptery v0.4 schema, migration `001_initial.sql`).
//!
//! Two-method surface mirrors what `cat_migration_reviewed`,
//! `selected_space`, and other shell-level toggles need:
//!
//! * [`get_setting`] — `Option<String>` (`None` = unset).
//! * [`set_setting`] — UPSERT, refreshes `updated_at`.
//!
//! No batch / list helper yet: every call site so far reads or writes a
//! single named key, and a `list_settings` would invite leaks of internal
//! flags into UI-level features. If we ever need it, gate behind an
//! allow-list rather than dumping the whole table.

use rusqlite::{params, Connection, OptionalExtension};

use super::util::now_millis;
use crate::db::pool::DbError;

/// Read the value for `key`. `Ok(None)` for absent keys (caller decides
/// the default); `Ok(Some(value))` for present rows. Empty-string values
/// are returned verbatim — distinct from "absent".
///
/// # Errors
///
/// Surfaces rusqlite errors (lock, IO, etc.).
pub fn get_setting(conn: &Connection, key: &str) -> Result<Option<String>, DbError> {
    let mut stmt = conn.prepare("SELECT value FROM settings WHERE key = ?1")?;
    Ok(stmt
        .query_row(params![key], |row| row.get::<_, String>("value"))
        .optional()?)
}

/// Insert-or-update a single setting. `updated_at` is refreshed on every
/// call so the column doubles as a last-modified timestamp without an
/// extra column.
///
/// # Errors
///
/// Surfaces rusqlite errors (lock, IO, etc.).
pub fn set_setting(conn: &Connection, key: &str, value: &str) -> Result<(), DbError> {
    let now = now_millis();
    conn.execute(
        "INSERT INTO settings (key, value, updated_at) \
         VALUES (?1, ?2, ?3) \
         ON CONFLICT(key) DO UPDATE SET \
            value = excluded.value, \
            updated_at = excluded.updated_at",
        params![key, value, now],
    )?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db::runner::run_pending;

    fn fresh_db() -> Connection {
        let mut conn = Connection::open_in_memory().expect("open mem");
        conn.execute_batch("PRAGMA foreign_keys = ON;")
            .expect("PRAGMA");
        run_pending(&mut conn).expect("migrations");
        conn
    }

    #[test]
    fn get_returns_none_for_absent_key() {
        let conn = fresh_db();
        assert!(get_setting(&conn, "missing").unwrap().is_none());
    }

    #[test]
    fn set_then_get_round_trip() {
        let conn = fresh_db();
        set_setting(&conn, "selected_space", "sp1").unwrap();
        let got = get_setting(&conn, "selected_space").unwrap();
        assert_eq!(got.as_deref(), Some("sp1"));
    }

    #[test]
    fn set_twice_updates_value_and_refreshes_timestamp() {
        let conn = fresh_db();
        set_setting(&conn, "k", "v1").unwrap();
        let first_ts: i64 = conn
            .query_row(
                "SELECT updated_at FROM settings WHERE key = 'k'",
                [],
                |r| r.get(0),
            )
            .unwrap();
        std::thread::sleep(std::time::Duration::from_millis(2));
        set_setting(&conn, "k", "v2").unwrap();
        let got = get_setting(&conn, "k").unwrap();
        assert_eq!(got.as_deref(), Some("v2"));
        let second_ts: i64 = conn
            .query_row(
                "SELECT updated_at FROM settings WHERE key = 'k'",
                [],
                |r| r.get(0),
            )
            .unwrap();
        assert!(second_ts >= first_ts, "updated_at must be refreshed");
    }

    #[test]
    fn empty_string_value_is_distinct_from_absent() {
        let conn = fresh_db();
        set_setting(&conn, "k", "").unwrap();
        let got = get_setting(&conn, "k").unwrap();
        assert_eq!(got.as_deref(), Some(""), "empty string round-trips");
        assert!(get_setting(&conn, "other").unwrap().is_none());
    }
}
