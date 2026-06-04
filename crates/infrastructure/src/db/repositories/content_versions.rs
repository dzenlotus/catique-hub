//! `role_content_versions` + `prompt_content_versions` repository —
//! refactor-v3 D-C.
//!
//! Two parallel tables, one per long-form text source kind. Both share
//! the same row shape — see `migrations/034_content_versions.sql`. The
//! use-case layer drives the 5-min debounce + last-50 retention; the
//! repository surface is intentionally narrow: insert, list, get,
//! prune.
//!
//! ## Why two tables and not one polymorphic table
//!
//! SQLite doesn't model polymorphic FKs cleanly — a single
//! `(source_kind TEXT, source_id TEXT)` column pair loses ON DELETE
//! CASCADE without a `BEFORE DELETE` trigger per parent table, which
//! is more code than just duplicating the schema. The pair stays in
//! lockstep through the migration; the API stays symmetrical.

use rusqlite::{params, Connection, OptionalExtension, Row};

use super::util::{new_id, now_millis};
use crate::db::pool::DbError;

/// One row of either `role_content_versions` or
/// `prompt_content_versions`. The repository functions are typed per
/// table — the row struct is shared because the wire-shape is identical
/// downstream (the UI just renders `created_at` + a content preview).
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ContentVersionRow {
    pub id: String,
    /// `role_id` for `list_role_versions` callers, `prompt_id` for
    /// prompt callers. The column name in SQL is the per-table one;
    /// this struct just stores whichever the loader sees.
    pub source_id: String,
    pub content: String,
    pub created_at: i64,
    pub author_note: Option<String>,
}

impl ContentVersionRow {
    fn from_row(source_col: &str, row: &Row<'_>) -> rusqlite::Result<Self> {
        Ok(Self {
            id: row.get("id")?,
            source_id: row.get(source_col)?,
            content: row.get("content")?,
            created_at: row.get("created_at")?,
            author_note: row.get("author_note")?,
        })
    }
}

// ------------------------------------------------------------------ roles

/// Insert one row of `role_content_versions`. Returns the new id.
///
/// `created_at` defaults to `now_millis()` — use [`insert_role_version_at`]
/// from tests if you need to inject a deterministic clock.
///
/// # Errors
///
/// FK violation on `role_id` surfaces as [`DbError::Sqlite`].
pub fn insert_role_version(
    conn: &Connection,
    role_id: &str,
    content: &str,
    author_note: Option<&str>,
) -> Result<String, DbError> {
    insert_role_version_at(conn, role_id, content, author_note, now_millis())
}

/// Clock-injected variant of [`insert_role_version`]. The
/// production code path goes through the non-`_at` helper; tests use
/// this directly to verify the 5-minute debounce without sleeping.
///
/// # Errors
///
/// FK violation on `role_id` surfaces as [`DbError::Sqlite`].
pub fn insert_role_version_at(
    conn: &Connection,
    role_id: &str,
    content: &str,
    author_note: Option<&str>,
    created_at: i64,
) -> Result<String, DbError> {
    let id = new_id();
    conn.execute(
        "INSERT INTO role_content_versions (id, role_id, content, created_at, author_note) \
         VALUES (?1, ?2, ?3, ?4, ?5)",
        params![id, role_id, content, created_at, author_note],
    )?;
    Ok(id)
}

/// Most-recent versions for a role, newest first, capped at `limit`.
///
/// # Errors
///
/// Surfaces rusqlite errors.
pub fn list_role_versions(
    conn: &Connection,
    role_id: &str,
    limit: usize,
) -> Result<Vec<ContentVersionRow>, DbError> {
    let mut stmt = conn.prepare(
        "SELECT id, role_id, content, created_at, author_note \
         FROM role_content_versions \
         WHERE role_id = ?1 \
         ORDER BY created_at DESC, id DESC \
         LIMIT ?2",
    )?;
    // Cap at i64::MAX to dodge `usize`→`i64` overflow paths — realistic
    // values are well under 100.
    let limit_i64 = i64::try_from(limit).unwrap_or(i64::MAX);
    let rows = stmt.query_map(params![role_id, limit_i64], |row| {
        ContentVersionRow::from_row("role_id", row)
    })?;
    let mut out = Vec::new();
    for row in rows {
        out.push(row?);
    }
    Ok(out)
}

/// Lookup one version by id.
///
/// # Errors
///
/// Surfaces rusqlite errors.
pub fn get_role_version(
    conn: &Connection,
    version_id: &str,
) -> Result<Option<ContentVersionRow>, DbError> {
    let mut stmt = conn.prepare(
        "SELECT id, role_id, content, created_at, author_note \
         FROM role_content_versions WHERE id = ?1",
    )?;
    Ok(stmt
        .query_row(params![version_id], |row| {
            ContentVersionRow::from_row("role_id", row)
        })
        .optional()?)
}

/// Most-recent `created_at` for a role's version stream, or `None`
/// when no versions exist. Used by the use-case's debounce check —
/// keeps the "should we snapshot?" decision on a single indexed read
/// instead of pulling the full row.
///
/// # Errors
///
/// Surfaces rusqlite errors.
pub fn latest_role_version_timestamp(
    conn: &Connection,
    role_id: &str,
) -> Result<Option<i64>, DbError> {
    let mut stmt = conn.prepare(
        "SELECT created_at FROM role_content_versions \
         WHERE role_id = ?1 \
         ORDER BY created_at DESC, id DESC \
         LIMIT 1",
    )?;
    Ok(stmt
        .query_row(params![role_id], |row| row.get::<_, i64>(0))
        .optional()?)
}

/// Delete every row beyond the `keep` newest for `role_id`. Returns
/// the number of rows removed. `keep = 0` clears the stream.
///
/// # Errors
///
/// Surfaces rusqlite errors.
pub fn prune_role_versions(
    conn: &Connection,
    role_id: &str,
    keep: usize,
) -> Result<usize, DbError> {
    let keep_i64 = i64::try_from(keep).unwrap_or(i64::MAX);
    // `LIMIT -1 OFFSET ?` is SQLite-idiomatic for "all rows after the
    // first N". `id NOT IN (... LIMIT ?)` keeps the newest N regardless
    // of ties on `created_at`.
    let removed = conn.execute(
        "DELETE FROM role_content_versions \
         WHERE role_id = ?1 \
           AND id NOT IN ( \
             SELECT id FROM role_content_versions \
              WHERE role_id = ?1 \
              ORDER BY created_at DESC, id DESC \
              LIMIT ?2 \
           )",
        params![role_id, keep_i64],
    )?;
    Ok(removed)
}

// ----------------------------------------------------------------- prompts

/// Insert one row of `prompt_content_versions`. Returns the new id.
///
/// # Errors
///
/// FK violation on `prompt_id` surfaces as [`DbError::Sqlite`].
pub fn insert_prompt_version(
    conn: &Connection,
    prompt_id: &str,
    content: &str,
    author_note: Option<&str>,
) -> Result<String, DbError> {
    insert_prompt_version_at(conn, prompt_id, content, author_note, now_millis())
}

/// Clock-injected variant of [`insert_prompt_version`].
///
/// # Errors
///
/// FK violation on `prompt_id` surfaces as [`DbError::Sqlite`].
pub fn insert_prompt_version_at(
    conn: &Connection,
    prompt_id: &str,
    content: &str,
    author_note: Option<&str>,
    created_at: i64,
) -> Result<String, DbError> {
    let id = new_id();
    conn.execute(
        "INSERT INTO prompt_content_versions (id, prompt_id, content, created_at, author_note) \
         VALUES (?1, ?2, ?3, ?4, ?5)",
        params![id, prompt_id, content, created_at, author_note],
    )?;
    Ok(id)
}

/// Most-recent versions for a prompt, newest first, capped at `limit`.
///
/// # Errors
///
/// Surfaces rusqlite errors.
pub fn list_prompt_versions(
    conn: &Connection,
    prompt_id: &str,
    limit: usize,
) -> Result<Vec<ContentVersionRow>, DbError> {
    let mut stmt = conn.prepare(
        "SELECT id, prompt_id, content, created_at, author_note \
         FROM prompt_content_versions \
         WHERE prompt_id = ?1 \
         ORDER BY created_at DESC, id DESC \
         LIMIT ?2",
    )?;
    let limit_i64 = i64::try_from(limit).unwrap_or(i64::MAX);
    let rows = stmt.query_map(params![prompt_id, limit_i64], |row| {
        ContentVersionRow::from_row("prompt_id", row)
    })?;
    let mut out = Vec::new();
    for row in rows {
        out.push(row?);
    }
    Ok(out)
}

/// Lookup one prompt version by id.
///
/// # Errors
///
/// Surfaces rusqlite errors.
pub fn get_prompt_version(
    conn: &Connection,
    version_id: &str,
) -> Result<Option<ContentVersionRow>, DbError> {
    let mut stmt = conn.prepare(
        "SELECT id, prompt_id, content, created_at, author_note \
         FROM prompt_content_versions WHERE id = ?1",
    )?;
    Ok(stmt
        .query_row(params![version_id], |row| {
            ContentVersionRow::from_row("prompt_id", row)
        })
        .optional()?)
}

/// Most-recent `created_at` for a prompt's version stream.
///
/// # Errors
///
/// Surfaces rusqlite errors.
pub fn latest_prompt_version_timestamp(
    conn: &Connection,
    prompt_id: &str,
) -> Result<Option<i64>, DbError> {
    let mut stmt = conn.prepare(
        "SELECT created_at FROM prompt_content_versions \
         WHERE prompt_id = ?1 \
         ORDER BY created_at DESC, id DESC \
         LIMIT 1",
    )?;
    Ok(stmt
        .query_row(params![prompt_id], |row| row.get::<_, i64>(0))
        .optional()?)
}

/// Delete every row beyond the `keep` newest for `prompt_id`. Returns
/// the number of rows removed.
///
/// # Errors
///
/// Surfaces rusqlite errors.
pub fn prune_prompt_versions(
    conn: &Connection,
    prompt_id: &str,
    keep: usize,
) -> Result<usize, DbError> {
    let keep_i64 = i64::try_from(keep).unwrap_or(i64::MAX);
    let removed = conn.execute(
        "DELETE FROM prompt_content_versions \
         WHERE prompt_id = ?1 \
           AND id NOT IN ( \
             SELECT id FROM prompt_content_versions \
              WHERE prompt_id = ?1 \
              ORDER BY created_at DESC, id DESC \
              LIMIT ?2 \
           )",
        params![prompt_id, keep_i64],
    )?;
    Ok(removed)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db::runner::run_pending;
    use rusqlite::Connection;

    fn fresh_db_with_role_and_prompt() -> (Connection, String, String) {
        let mut conn = Connection::open_in_memory().expect("open mem");
        conn.execute_batch("PRAGMA foreign_keys = ON;")
            .expect("PRAGMA");
        run_pending(&mut conn).expect("migrations");
        conn.execute_batch(
            "INSERT INTO roles (id, name, content, created_at, updated_at, is_system) \
                 VALUES ('r1','RoleA','seed-role',0,0,0); \
             INSERT INTO prompts (id, name, content, created_at, updated_at) \
                 VALUES ('p1','PromptA','seed-prompt',0,0);",
        )
        .expect("seed");
        (conn, "r1".into(), "p1".into())
    }

    #[test]
    fn role_version_round_trip() {
        let (conn, role_id, _) = fresh_db_with_role_and_prompt();
        let id = insert_role_version_at(&conn, &role_id, "v1-content", None, 1_000).expect("ins");
        let got = get_role_version(&conn, &id).expect("get").expect("some");
        assert_eq!(got.source_id, role_id);
        assert_eq!(got.content, "v1-content");
        assert_eq!(got.created_at, 1_000);
        assert!(got.author_note.is_none());
    }

    #[test]
    fn role_list_orders_newest_first_and_respects_limit() {
        let (conn, role_id, _) = fresh_db_with_role_and_prompt();
        for i in 0..5 {
            insert_role_version_at(
                &conn,
                &role_id,
                &format!("v{i}"),
                None,
                1_000 + i64::from(i),
            )
            .expect("ins");
        }
        let rows = list_role_versions(&conn, &role_id, 3).expect("list");
        assert_eq!(rows.len(), 3);
        // Newest first: v4 > v3 > v2.
        assert_eq!(rows[0].content, "v4");
        assert_eq!(rows[1].content, "v3");
        assert_eq!(rows[2].content, "v2");
    }

    #[test]
    fn role_latest_timestamp_tracks_inserts() {
        let (conn, role_id, _) = fresh_db_with_role_and_prompt();
        assert!(latest_role_version_timestamp(&conn, &role_id)
            .unwrap()
            .is_none());
        insert_role_version_at(&conn, &role_id, "a", None, 1_000).unwrap();
        insert_role_version_at(&conn, &role_id, "b", None, 5_000).unwrap();
        insert_role_version_at(&conn, &role_id, "c", None, 3_000).unwrap();
        assert_eq!(
            latest_role_version_timestamp(&conn, &role_id).unwrap(),
            Some(5_000)
        );
    }

    #[test]
    fn role_prune_keeps_newest_n() {
        let (conn, role_id, _) = fresh_db_with_role_and_prompt();
        for i in 0..10 {
            insert_role_version_at(
                &conn,
                &role_id,
                &format!("v{i}"),
                None,
                1_000 + i64::from(i),
            )
            .unwrap();
        }
        let removed = prune_role_versions(&conn, &role_id, 4).expect("prune");
        assert_eq!(removed, 6);
        let surviving = list_role_versions(&conn, &role_id, 100).unwrap();
        assert_eq!(surviving.len(), 4);
        // Newest four: v9, v8, v7, v6.
        let contents: Vec<&str> = surviving.iter().map(|r| r.content.as_str()).collect();
        assert_eq!(contents, vec!["v9", "v8", "v7", "v6"]);
    }

    #[test]
    fn deleting_role_cascades_versions() {
        let (conn, role_id, _) = fresh_db_with_role_and_prompt();
        insert_role_version_at(&conn, &role_id, "v", None, 1_000).unwrap();
        conn.execute("DELETE FROM roles WHERE id = ?1", params![role_id])
            .unwrap();
        let rows = list_role_versions(&conn, &role_id, 100).unwrap();
        assert!(rows.is_empty(), "FK cascade should sweep versions");
    }

    #[test]
    fn prompt_version_round_trip_and_prune() {
        let (conn, _, prompt_id) = fresh_db_with_role_and_prompt();
        for i in 0..6 {
            insert_prompt_version_at(
                &conn,
                &prompt_id,
                &format!("p-v{i}"),
                Some("note"),
                2_000 + i64::from(i),
            )
            .unwrap();
        }
        assert_eq!(
            latest_prompt_version_timestamp(&conn, &prompt_id).unwrap(),
            Some(2_005)
        );
        let removed = prune_prompt_versions(&conn, &prompt_id, 2).unwrap();
        assert_eq!(removed, 4);
        let surviving = list_prompt_versions(&conn, &prompt_id, 100).unwrap();
        assert_eq!(surviving.len(), 2);
        assert_eq!(surviving[0].content, "p-v5");
        assert_eq!(surviving[1].content, "p-v4");
        assert_eq!(surviving[0].author_note.as_deref(), Some("note"));
    }
}
