//! Agent reports repository — typed FTS-indexed task artefacts.
//!
//! Schema: `001_initial.sql`, Promptery v0.4 lines 322-359 (table +
//! `agent_reports_fts` + 3 triggers).
//!
//! Wave-E2.4 (Olga). The repository writes rows; the
//! `agent_reports_fts_*` triggers in the schema keep the FTS sibling
//! table in sync. Search use cases (FTS5 query path) are deferred to E3
//! per wave-brief.

use rusqlite::{params, Connection, OptionalExtension, Row};

use super::util::{new_id, now_millis};
use crate::db::pool::DbError;

/// One row of the `agent_reports` table.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct AgentReportRow {
    pub id: String,
    pub task_id: String,
    pub kind: String,
    pub title: String,
    pub content: String,
    pub author: Option<String>,
    pub created_at: i64,
    pub updated_at: i64,
}

impl AgentReportRow {
    fn from_row(row: &Row<'_>) -> rusqlite::Result<Self> {
        Ok(Self {
            id: row.get("id")?,
            task_id: row.get("task_id")?,
            kind: row.get("kind")?,
            title: row.get("title")?,
            content: row.get("content")?,
            author: row.get("author")?,
            created_at: row.get("created_at")?,
            updated_at: row.get("updated_at")?,
        })
    }
}

/// Draft for inserting a new report.
#[derive(Debug, Clone)]
pub struct AgentReportDraft {
    pub task_id: String,
    pub kind: String,
    pub title: String,
    pub content: String,
    pub author: Option<String>,
}

/// Partial update payload.
#[derive(Debug, Clone, Default)]
pub struct AgentReportPatch {
    pub kind: Option<String>,
    pub title: Option<String>,
    pub content: Option<String>,
    pub author: Option<Option<String>>,
}

/// `SELECT … FROM agent_reports ORDER BY created_at DESC`.
///
/// # Errors
///
/// Surfaces rusqlite errors.
pub fn list_all(conn: &Connection) -> Result<Vec<AgentReportRow>, DbError> {
    let mut stmt = conn.prepare(
        "SELECT id, task_id, kind, title, content, author, created_at, updated_at \
         FROM agent_reports ORDER BY created_at DESC",
    )?;
    let rows = stmt.query_map([], AgentReportRow::from_row)?;
    let mut out = Vec::new();
    for row in rows {
        out.push(row?);
    }
    Ok(out)
}

/// Lookup by primary key.
///
/// # Errors
///
/// Surfaces rusqlite errors.
pub fn get_by_id(conn: &Connection, id: &str) -> Result<Option<AgentReportRow>, DbError> {
    let mut stmt = conn.prepare(
        "SELECT id, task_id, kind, title, content, author, created_at, updated_at \
         FROM agent_reports WHERE id = ?1",
    )?;
    Ok(stmt
        .query_row(params![id], AgentReportRow::from_row)
        .optional()?)
}

/// Insert one report. Generates id, stamps timestamps.
///
/// # Errors
///
/// FK violation on `task_id` surfaces as [`DbError::Sqlite`].
pub fn insert(conn: &Connection, draft: &AgentReportDraft) -> Result<AgentReportRow, DbError> {
    let id = new_id();
    let now = now_millis();
    conn.execute(
        "INSERT INTO agent_reports \
            (id, task_id, kind, title, content, author, created_at, updated_at) \
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?7)",
        params![
            id,
            draft.task_id,
            draft.kind,
            draft.title,
            draft.content,
            draft.author,
            now
        ],
    )?;
    Ok(AgentReportRow {
        id,
        task_id: draft.task_id.clone(),
        kind: draft.kind.clone(),
        title: draft.title.clone(),
        content: draft.content.clone(),
        author: draft.author.clone(),
        created_at: now,
        updated_at: now,
    })
}

/// Partial update via `COALESCE`. Bumps `updated_at`.
///
/// # Errors
///
/// Surfaces rusqlite errors.
pub fn update(
    conn: &Connection,
    id: &str,
    patch: &AgentReportPatch,
) -> Result<Option<AgentReportRow>, DbError> {
    let now = now_millis();
    let updated = match &patch.author {
        Some(new_author) => conn.execute(
            "UPDATE agent_reports SET \
                 kind = COALESCE(?1, kind), \
                 title = COALESCE(?2, title), \
                 content = COALESCE(?3, content), \
                 author = ?4, \
                 updated_at = ?5 \
             WHERE id = ?6",
            params![patch.kind, patch.title, patch.content, new_author, now, id],
        )?,
        None => conn.execute(
            "UPDATE agent_reports SET \
                 kind = COALESCE(?1, kind), \
                 title = COALESCE(?2, title), \
                 content = COALESCE(?3, content), \
                 updated_at = ?4 \
             WHERE id = ?5",
            params![patch.kind, patch.title, patch.content, now, id],
        )?,
    };
    if updated == 0 {
        return Ok(None);
    }
    get_by_id(conn, id)
}

/// Delete one report. The `agent_reports_fts_delete` trigger strips
/// the FTS row automatically.
///
/// # Errors
///
/// Surfaces rusqlite errors.
pub fn delete(conn: &Connection, id: &str) -> Result<bool, DbError> {
    let n = conn.execute("DELETE FROM agent_reports WHERE id = ?1", params![id])?;
    Ok(n > 0)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db::runner::run_pending;

    fn fresh_db_with_task() -> (Connection, String) {
        let mut conn = Connection::open_in_memory().unwrap();
        conn.execute_batch("PRAGMA foreign_keys = ON;").unwrap();
        run_pending(&mut conn).expect("migrations");
        conn.execute_batch(
            "INSERT INTO spaces (id, name, prefix, is_default, position, created_at, updated_at) \
                 VALUES ('sp1','Space','sp',0,0,0,0); \
             INSERT INTO boards (id, name, space_id, position, created_at, updated_at) \
                 VALUES ('bd1','B','sp1',0,0,0); \
             INSERT INTO columns (id, board_id, name, position, created_at) \
                 VALUES ('c1','bd1','C',0,0); \
             INSERT INTO tasks (id, board_id, column_id, slug, title, position, created_at, updated_at) \
                 VALUES ('t1','bd1','c1','sp-1','T',0,0,0);",
        )
        .unwrap();
        (conn, "t1".into())
    }

    fn draft(task_id: &str, kind: &str) -> AgentReportDraft {
        AgentReportDraft {
            task_id: task_id.into(),
            kind: kind.into(),
            title: "Investigation".into(),
            content: "the file is at /tmp/foo".into(),
            author: Some("olga".into()),
        }
    }

    #[test]
    fn insert_then_get() {
        let (conn, t) = fresh_db_with_task();
        let row = insert(&conn, &draft(&t, "investigation")).unwrap();
        let got = get_by_id(&conn, &row.id).unwrap().unwrap();
        assert_eq!(row, got);
    }

    #[test]
    fn fts_row_inserted_on_report_insert() {
        let (conn, t) = fresh_db_with_task();
        let _row = insert(&conn, &draft(&t, "plan")).unwrap();
        let count: i64 = conn
            .query_row("SELECT COUNT(*) FROM agent_reports_fts", [], |r| r.get(0))
            .unwrap();
        assert_eq!(count, 1);
    }

    #[test]
    fn fts_row_removed_on_report_delete() {
        let (conn, t) = fresh_db_with_task();
        let row = insert(&conn, &draft(&t, "summary")).unwrap();
        delete(&conn, &row.id).unwrap();
        let count: i64 = conn
            .query_row("SELECT COUNT(*) FROM agent_reports_fts", [], |r| r.get(0))
            .unwrap();
        assert_eq!(count, 0);
    }

    #[test]
    fn update_only_supplied_fields() {
        let (conn, t) = fresh_db_with_task();
        let row = insert(&conn, &draft(&t, "investigation")).unwrap();
        let updated = update(
            &conn,
            &row.id,
            &AgentReportPatch {
                title: Some("New title".into()),
                ..AgentReportPatch::default()
            },
        )
        .unwrap()
        .unwrap();
        assert_eq!(updated.title, "New title");
        assert_eq!(updated.content, "the file is at /tmp/foo");
    }

    #[test]
    fn insert_with_bad_task_violates_fk() {
        let (conn, _) = fresh_db_with_task();
        let err = insert(&conn, &draft("ghost", "review")).expect_err("FK");
        match err {
            DbError::Sqlite(rusqlite::Error::SqliteFailure(code, _)) => {
                assert_eq!(code.code, rusqlite::ErrorCode::ConstraintViolation);
            }
            other => panic!("got {other:?}"),
        }
    }

    #[test]
    fn update_returns_none_for_missing_id() {
        let (conn, _) = fresh_db_with_task();
        assert!(update(&conn, "ghost", &AgentReportPatch::default())
            .unwrap()
            .is_none());
    }
}
