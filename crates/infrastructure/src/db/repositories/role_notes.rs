//! Role-notes repository — per-role retrospective memory (ctq-137 /
//! MEM-S1).
//!
//! Schema: `026_role_notes.sql`. Two tables (`role_notes` +
//! `role_note_tags`) plus an FTS5 mirror (`role_notes_fts`). Tags live
//! in the side table so the recall path can intersect by tag without
//! pulling note bodies into memory.
//!
//! ## Write atomicity
//!
//! `insert` and the `update` path that swaps the tag set both take a
//! `&mut Connection` and open a single immediate transaction so the
//! note row + its tag rows commit (or roll back) together. Tag
//! normalisation lives one layer up
//! (`crates/application/src/role_notes.rs::normalise_tag`) — this
//! repository assumes every `tag` slice is already canonical.

use rusqlite::{params, Connection, OptionalExtension, Row};

use super::util::{new_id, now_millis};
use crate::db::pool::DbError;

/// One row of `role_notes` (sans tags — joined in by the application
/// layer via [`list_tags_for_note`]).
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct RoleNoteRow {
    pub id: String,
    pub role_id: String,
    pub source_task_id: Option<String>,
    pub body: String,
    pub priority: i64,
    pub pinned: bool,
    /// `'agent'` or `'user'` — pinned by the schema CHECK constraint.
    pub authored_by: String,
    pub created_at: i64,
    pub updated_at: i64,
}

impl RoleNoteRow {
    fn from_row(row: &Row<'_>) -> rusqlite::Result<Self> {
        let pinned_int: i64 = row.get("pinned")?;
        Ok(Self {
            id: row.get("id")?,
            role_id: row.get("role_id")?,
            source_task_id: row.get("source_task_id")?,
            body: row.get("body")?,
            priority: row.get("priority")?,
            pinned: pinned_int != 0,
            authored_by: row.get("authored_by")?,
            created_at: row.get("created_at")?,
            updated_at: row.get("updated_at")?,
        })
    }
}

/// Insert draft. `tags` MUST already be normalised + deduplicated by
/// the caller (`application::role_notes::normalise_tag`).
#[derive(Debug, Clone)]
pub struct RoleNoteDraft {
    pub role_id: String,
    pub source_task_id: Option<String>,
    pub body: String,
    pub priority: i64,
    pub pinned: bool,
    /// `'agent'` or `'user'`. Application layer validates the value
    /// before reaching this point.
    pub authored_by: String,
}

/// Partial update payload. `None` = leave alone; `Some(_)` = set.
#[derive(Debug, Clone, Default)]
pub struct RoleNotePatch {
    pub body: Option<String>,
    pub priority: Option<i64>,
    pub pinned: Option<bool>,
}

/// One `(tag, count)` aggregation row for [`list_tags_for_role`].
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct TagCountRow {
    pub tag: String,
    pub count: i64,
}

// ---------------------------------------------------------------------
// CRUD — alphabetised in file order: list_all, get_by_id, insert,
// update, delete. Tag helpers follow.
// ---------------------------------------------------------------------

/// `SELECT … FROM role_notes WHERE role_id = ?1 ORDER BY created_at DESC`.
///
/// # Errors
///
/// Surfaces rusqlite errors.
pub fn list_all(conn: &Connection, role_id: &str) -> Result<Vec<RoleNoteRow>, DbError> {
    let mut stmt = conn.prepare(
        "SELECT id, role_id, source_task_id, body, priority, pinned, authored_by, \
                created_at, updated_at \
         FROM role_notes \
         WHERE role_id = ?1 \
         ORDER BY created_at DESC",
    )?;
    let rows = stmt.query_map(params![role_id], RoleNoteRow::from_row)?;
    let mut out = Vec::new();
    for row in rows {
        out.push(row?);
    }
    Ok(out)
}

/// Lookup one note by primary key.
///
/// # Errors
///
/// Surfaces rusqlite errors.
pub fn get_by_id(conn: &Connection, id: &str) -> Result<Option<RoleNoteRow>, DbError> {
    let mut stmt = conn.prepare(
        "SELECT id, role_id, source_task_id, body, priority, pinned, authored_by, \
                created_at, updated_at \
         FROM role_notes WHERE id = ?1",
    )?;
    Ok(stmt
        .query_row(params![id], RoleNoteRow::from_row)
        .optional()?)
}

/// Insert one note + its tag list atomically.
///
/// Opens a single immediate transaction so the note row, its FTS
/// mirror (via the `role_notes_ai` trigger), and the tag rows commit
/// together. `tags` is expected to be already normalised + deduped by
/// the caller.
///
/// # Errors
///
/// FK violation on `role_id` / `source_task_id` and CHECK violations on
/// `authored_by` / `pinned` surface as [`DbError::Sqlite`].
pub fn insert(
    conn: &mut Connection,
    draft: &RoleNoteDraft,
    tags: &[String],
) -> Result<RoleNoteRow, DbError> {
    let id = new_id();
    let now = now_millis();
    let pinned_int: i64 = i64::from(draft.pinned);
    let tx = conn.transaction_with_behavior(rusqlite::TransactionBehavior::Immediate)?;
    tx.execute(
        "INSERT INTO role_notes \
            (id, role_id, source_task_id, body, priority, pinned, authored_by, \
             created_at, updated_at) \
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?8)",
        params![
            id,
            draft.role_id,
            draft.source_task_id,
            draft.body,
            draft.priority,
            pinned_int,
            draft.authored_by,
            now,
        ],
    )?;
    {
        let mut tag_stmt =
            tx.prepare("INSERT INTO role_note_tags (note_id, tag) VALUES (?1, ?2)")?;
        for tag in tags {
            tag_stmt.execute(params![id, tag])?;
        }
    }
    tx.commit()?;
    Ok(RoleNoteRow {
        id,
        role_id: draft.role_id.clone(),
        source_task_id: draft.source_task_id.clone(),
        body: draft.body.clone(),
        priority: draft.priority,
        pinned: draft.pinned,
        authored_by: draft.authored_by.clone(),
        created_at: now,
        updated_at: now,
    })
}

/// Partial update. `tags = Some(slice)` replaces the entire tag set
/// for the note (replace-all semantics); `tags = None` leaves tags
/// untouched. Both branches commit inside one immediate transaction so
/// a mid-write failure cannot leave the note's tag rows in a torn
/// state.
///
/// Returns the updated row when present, `Ok(None)` when the id is
/// unknown.
///
/// # Errors
///
/// Surfaces rusqlite errors.
pub fn update(
    conn: &mut Connection,
    id: &str,
    patch: &RoleNotePatch,
    tags: Option<&[String]>,
) -> Result<Option<RoleNoteRow>, DbError> {
    let now = now_millis();
    let pinned_int: Option<i64> = patch.pinned.map(i64::from);
    let tx = conn.transaction_with_behavior(rusqlite::TransactionBehavior::Immediate)?;
    let updated = tx.execute(
        "UPDATE role_notes SET \
            body = COALESCE(?1, body), \
            priority = COALESCE(?2, priority), \
            pinned = COALESCE(?3, pinned), \
            updated_at = ?4 \
         WHERE id = ?5",
        params![patch.body, patch.priority, pinned_int, now, id],
    )?;
    if updated == 0 {
        // No row to update; bail out without touching the tag table.
        tx.rollback()?;
        return Ok(None);
    }
    if let Some(new_tags) = tags {
        tx.execute("DELETE FROM role_note_tags WHERE note_id = ?1", params![id])?;
        let mut tag_stmt =
            tx.prepare("INSERT INTO role_note_tags (note_id, tag) VALUES (?1, ?2)")?;
        for tag in new_tags {
            tag_stmt.execute(params![id, tag])?;
        }
    }
    tx.commit()?;
    get_by_id(conn, id)
}

/// Delete one note. The `role_notes_ad` trigger strips the FTS mirror
/// row, and the `role_note_tags` rows cascade via the FK
/// `ON DELETE CASCADE`.
///
/// # Errors
///
/// Surfaces rusqlite errors.
pub fn delete(conn: &Connection, id: &str) -> Result<bool, DbError> {
    let n = conn.execute("DELETE FROM role_notes WHERE id = ?1", params![id])?;
    Ok(n > 0)
}

// ---------------------------------------------------------------------
// Tag helpers + recall.
// ---------------------------------------------------------------------

/// Load every tag for one note (used by the application layer to
/// hydrate [`catique_domain::RoleNote::tags`]).
///
/// # Errors
///
/// Surfaces rusqlite errors.
pub fn list_tags_for_note(conn: &Connection, note_id: &str) -> Result<Vec<String>, DbError> {
    let mut stmt =
        conn.prepare("SELECT tag FROM role_note_tags WHERE note_id = ?1 ORDER BY tag ASC")?;
    let rows = stmt.query_map(params![note_id], |r| r.get::<_, String>(0))?;
    let mut out = Vec::new();
    for r in rows {
        out.push(r?);
    }
    Ok(out)
}

/// `(tag, count)` aggregation across every note for the role, sorted
/// by count DESC then tag ASC. Empty role → empty Vec.
///
/// # Errors
///
/// Surfaces rusqlite errors.
pub fn list_tags_for_role(conn: &Connection, role_id: &str) -> Result<Vec<TagCountRow>, DbError> {
    let mut stmt = conn.prepare(
        "SELECT t.tag AS tag, COUNT(*) AS cnt \
         FROM role_note_tags t \
         INNER JOIN role_notes n ON n.id = t.note_id \
         WHERE n.role_id = ?1 \
         GROUP BY t.tag \
         ORDER BY cnt DESC, t.tag ASC",
    )?;
    let rows = stmt.query_map(params![role_id], |r| {
        Ok(TagCountRow {
            tag: r.get("tag")?,
            count: r.get("cnt")?,
        })
    })?;
    let mut out = Vec::new();
    for r in rows {
        out.push(r?);
    }
    Ok(out)
}

/// Load every non-pinned note for the role that overlaps any of `tags`
/// (set-membership). Returned rows are unordered; the application layer
/// scores + sorts them. The query stays away from `ORDER BY` because the
/// composite score (overlap × priority × recency) is too expressive for
/// the SQL layer to compute in-line.
///
/// # Errors
///
/// Surfaces rusqlite errors.
pub fn notes_with_any_tag(
    conn: &Connection,
    role_id: &str,
    tags: &[String],
) -> Result<Vec<RoleNoteRow>, DbError> {
    if tags.is_empty() {
        return Ok(Vec::new());
    }
    // Build `(?,?,…)` placeholder list for the IN clause. The slice is
    // bounded by the IPC payload size (and capped at the use-case
    // layer's `MAX_TAGS_PER_QUERY`), so this is safe.
    let placeholders = std::iter::repeat("?")
        .take(tags.len())
        .collect::<Vec<_>>()
        .join(",");
    let sql = format!(
        "SELECT DISTINCT n.id, n.role_id, n.source_task_id, n.body, n.priority, n.pinned, \
                n.authored_by, n.created_at, n.updated_at \
         FROM role_notes n \
         INNER JOIN role_note_tags t ON t.note_id = n.id \
         WHERE n.role_id = ? \
           AND n.pinned = 0 \
           AND t.tag IN ({placeholders})",
    );
    let mut stmt = conn.prepare(&sql)?;
    // First bind is role_id; tags follow.
    let mut binds: Vec<&dyn rusqlite::ToSql> = Vec::with_capacity(1 + tags.len());
    binds.push(&role_id);
    for tag in tags {
        binds.push(tag);
    }
    let rows = stmt.query_map(binds.as_slice(), RoleNoteRow::from_row)?;
    let mut out = Vec::new();
    for r in rows {
        out.push(r?);
    }
    Ok(out)
}

/// Load every pinned note for the role. Used by recall to fold pinned
/// rows into the result regardless of tag overlap.
///
/// # Errors
///
/// Surfaces rusqlite errors.
pub fn pinned_for_role(conn: &Connection, role_id: &str) -> Result<Vec<RoleNoteRow>, DbError> {
    let mut stmt = conn.prepare(
        "SELECT id, role_id, source_task_id, body, priority, pinned, authored_by, \
                created_at, updated_at \
         FROM role_notes \
         WHERE role_id = ?1 AND pinned = 1",
    )?;
    let rows = stmt.query_map(params![role_id], RoleNoteRow::from_row)?;
    let mut out = Vec::new();
    for r in rows {
        out.push(r?);
    }
    Ok(out)
}

/// FTS5 fallback: run a MATCH against `role_notes_fts.body` filtered to
/// `role_id`, dropping pinned rows (they're added separately by the
/// application layer). Returns `(row, bm25_score)` pairs — lower bm25
/// is better; the application layer flips it into an ascending recall
/// score.
///
/// # Errors
///
/// Surfaces rusqlite errors. A malformed FTS5 query (e.g. unbalanced
/// quotes) returns `DbError::Sqlite(_)`; the use case maps it to
/// `Validation` so callers see a usable error.
pub fn fts_search(
    conn: &Connection,
    role_id: &str,
    query: &str,
) -> Result<Vec<(RoleNoteRow, f64)>, DbError> {
    let mut stmt = conn.prepare(
        "SELECT n.id, n.role_id, n.source_task_id, n.body, n.priority, n.pinned, \
                n.authored_by, n.created_at, n.updated_at, \
                bm25(role_notes_fts) AS bm25_score \
         FROM role_notes_fts \
         INNER JOIN role_notes n ON n.id = role_notes_fts.note_id \
         WHERE role_notes_fts MATCH ?1 \
           AND n.role_id = ?2 \
           AND n.pinned = 0",
    )?;
    let rows = stmt.query_map(params![query, role_id], |r| {
        Ok((RoleNoteRow::from_row(r)?, r.get::<_, f64>("bm25_score")?))
    })?;
    let mut out = Vec::new();
    for r in rows {
        out.push(r?);
    }
    Ok(out)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db::runner::run_pending;

    fn fresh_db_with_role(role_id: &str) -> Connection {
        let mut conn = Connection::open_in_memory().unwrap();
        conn.execute_batch("PRAGMA foreign_keys = ON;").unwrap();
        run_pending(&mut conn).expect("migrations");
        conn.execute(
            "INSERT INTO roles (id, name, content, created_at, updated_at) \
             VALUES (?1, ?1, '', 0, 0)",
            params![role_id],
        )
        .unwrap();
        conn
    }

    fn draft(role_id: &str, body: &str) -> RoleNoteDraft {
        RoleNoteDraft {
            role_id: role_id.into(),
            source_task_id: None,
            body: body.into(),
            priority: 0,
            pinned: false,
            authored_by: "agent".into(),
        }
    }

    #[test]
    fn insert_then_get_round_trips() {
        let mut conn = fresh_db_with_role("r1");
        let row = insert(
            &mut conn,
            &draft("r1", "first note"),
            &["rust".to_owned(), "async".to_owned()],
        )
        .unwrap();
        let got = get_by_id(&conn, &row.id).unwrap().unwrap();
        assert_eq!(got, row);
        let tags = list_tags_for_note(&conn, &row.id).unwrap();
        assert_eq!(tags, vec!["async".to_owned(), "rust".to_owned()]);
    }

    #[test]
    fn insert_with_unknown_role_violates_fk() {
        let mut conn = fresh_db_with_role("r1");
        let err = insert(&mut conn, &draft("ghost", "n"), &[]).expect_err("FK");
        match err {
            DbError::Sqlite(rusqlite::Error::SqliteFailure(code, _)) => {
                assert_eq!(code.code, rusqlite::ErrorCode::ConstraintViolation);
            }
            other => panic!("got {other:?}"),
        }
    }

    #[test]
    fn fts_mirror_populates_on_insert_and_clears_on_delete() {
        let mut conn = fresh_db_with_role("r1");
        let row = insert(&mut conn, &draft("r1", "vibrant body"), &[]).unwrap();
        let n: i64 = conn
            .query_row("SELECT COUNT(*) FROM role_notes_fts", [], |r| r.get(0))
            .unwrap();
        assert_eq!(n, 1);
        delete(&conn, &row.id).unwrap();
        let n: i64 = conn
            .query_row("SELECT COUNT(*) FROM role_notes_fts", [], |r| r.get(0))
            .unwrap();
        assert_eq!(n, 0);
    }

    #[test]
    fn update_replaces_tags_atomically() {
        let mut conn = fresh_db_with_role("r1");
        let row = insert(
            &mut conn,
            &draft("r1", "n"),
            &["a".to_owned(), "b".to_owned()],
        )
        .unwrap();

        let _ = update(
            &mut conn,
            &row.id,
            &RoleNotePatch {
                body: Some("updated".into()),
                ..RoleNotePatch::default()
            },
            Some(&["c".to_owned()]),
        )
        .unwrap()
        .unwrap();

        let tags = list_tags_for_note(&conn, &row.id).unwrap();
        assert_eq!(tags, vec!["c".to_owned()]);
        let got = get_by_id(&conn, &row.id).unwrap().unwrap();
        assert_eq!(got.body, "updated");
    }

    #[test]
    fn cascade_delete_when_role_drops() {
        let mut conn = fresh_db_with_role("r1");
        let row = insert(&mut conn, &draft("r1", "n"), &["alpha".to_owned()]).unwrap();
        // Drop the role; cascade should wipe the note + its tags.
        conn.execute("DELETE FROM roles WHERE id = 'r1'", [])
            .unwrap();
        assert!(get_by_id(&conn, &row.id).unwrap().is_none());
        let n: i64 = conn
            .query_row("SELECT COUNT(*) FROM role_note_tags", [], |r| r.get(0))
            .unwrap();
        assert_eq!(n, 0);
    }

    #[test]
    fn list_tags_for_role_counts_and_orders() {
        let mut conn = fresh_db_with_role("r1");
        let _ = insert(
            &mut conn,
            &draft("r1", "a"),
            &["rust".to_owned(), "async".to_owned()],
        )
        .unwrap();
        let _ = insert(
            &mut conn,
            &draft("r1", "b"),
            &["rust".to_owned(), "macros".to_owned()],
        )
        .unwrap();
        let counts = list_tags_for_role(&conn, "r1").unwrap();
        // rust appears twice → highest count; async + macros tied on 1
        // → alphabetical order.
        assert_eq!(counts.len(), 3);
        assert_eq!(counts[0].tag, "rust");
        assert_eq!(counts[0].count, 2);
        assert_eq!(counts[1].tag, "async");
        assert_eq!(counts[1].count, 1);
        assert_eq!(counts[2].tag, "macros");
    }

    #[test]
    fn notes_with_any_tag_excludes_pinned() {
        let mut conn = fresh_db_with_role("r1");
        let unpinned = insert(&mut conn, &draft("r1", "regular"), &["alpha".to_owned()]).unwrap();
        let mut pinned = draft("r1", "pinned");
        pinned.pinned = true;
        let _ = insert(&mut conn, &pinned, &["alpha".to_owned()]).unwrap();

        let rows = notes_with_any_tag(&conn, "r1", &["alpha".to_owned()]).unwrap();
        assert_eq!(rows.len(), 1, "pinned rows must be excluded");
        assert_eq!(rows[0].id, unpinned.id);
    }

    #[test]
    fn pinned_for_role_returns_only_pinned() {
        let mut conn = fresh_db_with_role("r1");
        let _ = insert(&mut conn, &draft("r1", "n1"), &[]).unwrap();
        let mut p = draft("r1", "n2");
        p.pinned = true;
        let pinned_note = insert(&mut conn, &p, &[]).unwrap();
        let pinned = pinned_for_role(&conn, "r1").unwrap();
        assert_eq!(pinned.len(), 1);
        assert_eq!(pinned[0].id, pinned_note.id);
    }

    #[test]
    fn fts_search_finds_match_by_body_token() {
        let mut conn = fresh_db_with_role("r1");
        let _ = insert(&mut conn, &draft("r1", "tauri ipc handler crash"), &[]).unwrap();
        let _ = insert(&mut conn, &draft("r1", "irrelevant body"), &[]).unwrap();
        let hits = fts_search(&conn, "r1", "tauri").unwrap();
        assert_eq!(hits.len(), 1);
        assert!(hits[0].0.body.contains("tauri"));
    }

    #[test]
    fn update_returns_none_for_missing_id() {
        let mut conn = fresh_db_with_role("r1");
        assert!(update(&mut conn, "ghost", &RoleNotePatch::default(), None)
            .unwrap()
            .is_none());
    }
}
