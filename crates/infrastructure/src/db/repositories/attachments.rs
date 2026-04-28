//! Attachments repository — `task_attachments` metadata.
//!
//! Schema: `001_initial.sql`, Promptery v0.4 lines 239-250.
//!
//! Wave-E2.4 (Olga): metadata-only CRUD. Physical blob handling (read /
//! write under `<app_data>/attachments/<task_id>/<storage_path>`) is
//! **deferred to E3** — see wave-brief. The repository stores the
//! `storage_path` string verbatim; nothing here verifies that the file
//! actually exists on disk.

use rusqlite::{params, Connection, OptionalExtension, Row};

use super::util::{new_id, now_millis};
use crate::db::pool::DbError;

/// One row of the `task_attachments` table.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct AttachmentRow {
    pub id: String,
    pub task_id: String,
    pub filename: String,
    pub mime_type: String,
    pub size_bytes: i64,
    pub storage_path: String,
    pub uploaded_at: i64,
    pub uploaded_by: Option<String>,
}

impl AttachmentRow {
    fn from_row(row: &Row<'_>) -> rusqlite::Result<Self> {
        Ok(Self {
            id: row.get("id")?,
            task_id: row.get("task_id")?,
            filename: row.get("filename")?,
            mime_type: row.get("mime_type")?,
            size_bytes: row.get("size_bytes")?,
            storage_path: row.get("storage_path")?,
            uploaded_at: row.get("uploaded_at")?,
            uploaded_by: row.get("uploaded_by")?,
        })
    }
}

/// Draft for inserting a new attachment.
#[derive(Debug, Clone)]
pub struct AttachmentDraft {
    pub task_id: String,
    pub filename: String,
    pub mime_type: String,
    pub size_bytes: i64,
    pub storage_path: String,
    pub uploaded_by: Option<String>,
}

/// Partial update payload. Most attachment fields are immutable
/// (filename / mime / size / storage_path). The only mutable field in
/// practice is `uploaded_by` — we still expose `filename` patch since
/// rename-without-replace is a reasonable UI affordance.
#[derive(Debug, Clone, Default)]
pub struct AttachmentPatch {
    pub filename: Option<String>,
    pub uploaded_by: Option<Option<String>>,
}

/// `SELECT … FROM task_attachments ORDER BY uploaded_at DESC`.
///
/// # Errors
///
/// Surfaces rusqlite errors.
pub fn list_all(conn: &Connection) -> Result<Vec<AttachmentRow>, DbError> {
    let mut stmt = conn.prepare(
        "SELECT id, task_id, filename, mime_type, size_bytes, storage_path, uploaded_at, uploaded_by \
         FROM task_attachments ORDER BY uploaded_at DESC",
    )?;
    let rows = stmt.query_map([], AttachmentRow::from_row)?;
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
pub fn get_by_id(conn: &Connection, id: &str) -> Result<Option<AttachmentRow>, DbError> {
    let mut stmt = conn.prepare(
        "SELECT id, task_id, filename, mime_type, size_bytes, storage_path, uploaded_at, uploaded_by \
         FROM task_attachments WHERE id = ?1",
    )?;
    Ok(stmt
        .query_row(params![id], AttachmentRow::from_row)
        .optional()?)
}

/// Insert one attachment metadata row. Generates id, stamps
/// `uploaded_at`. Note: this layer does NOT touch the filesystem.
///
/// # Errors
///
/// FK violation on `task_id` surfaces as [`DbError::Sqlite`].
pub fn insert(conn: &Connection, draft: &AttachmentDraft) -> Result<AttachmentRow, DbError> {
    let id = new_id();
    let now = now_millis();
    conn.execute(
        "INSERT INTO task_attachments \
            (id, task_id, filename, mime_type, size_bytes, storage_path, uploaded_at, uploaded_by) \
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)",
        params![
            id,
            draft.task_id,
            draft.filename,
            draft.mime_type,
            draft.size_bytes,
            draft.storage_path,
            now,
            draft.uploaded_by,
        ],
    )?;
    Ok(AttachmentRow {
        id,
        task_id: draft.task_id.clone(),
        filename: draft.filename.clone(),
        mime_type: draft.mime_type.clone(),
        size_bytes: draft.size_bytes,
        storage_path: draft.storage_path.clone(),
        uploaded_at: now,
        uploaded_by: draft.uploaded_by.clone(),
    })
}

/// Partial update via `COALESCE`. Does not bump `uploaded_at` —
/// that field is the wall-clock-stamp of the original upload, not a
/// last-modified marker.
///
/// # Errors
///
/// Surfaces rusqlite errors.
pub fn update(
    conn: &Connection,
    id: &str,
    patch: &AttachmentPatch,
) -> Result<Option<AttachmentRow>, DbError> {
    let updated = match &patch.uploaded_by {
        Some(new_by) => conn.execute(
            "UPDATE task_attachments SET \
                 filename = COALESCE(?1, filename), \
                 uploaded_by = ?2 \
             WHERE id = ?3",
            params![patch.filename, new_by, id],
        )?,
        None => conn.execute(
            "UPDATE task_attachments SET \
                 filename = COALESCE(?1, filename) \
             WHERE id = ?2",
            params![patch.filename, id],
        )?,
    };
    if updated == 0 {
        return Ok(None);
    }
    get_by_id(conn, id)
}

/// Delete one attachment row. Caller is responsible for removing the
/// physical blob (E3); this layer only manages metadata.
///
/// # Errors
///
/// Surfaces rusqlite errors.
pub fn delete(conn: &Connection, id: &str) -> Result<bool, DbError> {
    let n = conn.execute("DELETE FROM task_attachments WHERE id = ?1", params![id])?;
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

    fn draft(task_id: &str) -> AttachmentDraft {
        AttachmentDraft {
            task_id: task_id.into(),
            filename: "screenshot.png".into(),
            mime_type: "image/png".into(),
            size_bytes: 12_345,
            storage_path: "abc.png".into(),
            uploaded_by: Some("olga".into()),
        }
    }

    #[test]
    fn insert_then_get() {
        let (conn, t) = fresh_db_with_task();
        let row = insert(&conn, &draft(&t)).unwrap();
        let got = get_by_id(&conn, &row.id).unwrap().unwrap();
        assert_eq!(row, got);
    }

    #[test]
    fn list_all_returns_inserted() {
        let (conn, t) = fresh_db_with_task();
        let _r1 = insert(&conn, &draft(&t)).unwrap();
        let _r2 = insert(&conn, &draft(&t)).unwrap();
        let rows = list_all(&conn).unwrap();
        assert_eq!(rows.len(), 2);
    }

    #[test]
    fn update_renames_filename() {
        let (conn, t) = fresh_db_with_task();
        let row = insert(&conn, &draft(&t)).unwrap();
        let updated = update(
            &conn,
            &row.id,
            &AttachmentPatch {
                filename: Some("renamed.png".into()),
                ..AttachmentPatch::default()
            },
        )
        .unwrap()
        .unwrap();
        assert_eq!(updated.filename, "renamed.png");
        assert_eq!(updated.storage_path, "abc.png"); // unchanged
    }

    #[test]
    fn delete_returns_true_then_false() {
        let (conn, t) = fresh_db_with_task();
        let row = insert(&conn, &draft(&t)).unwrap();
        assert!(delete(&conn, &row.id).unwrap());
        assert!(!delete(&conn, &row.id).unwrap());
    }

    #[test]
    fn insert_with_bad_task_violates_fk() {
        let (conn, _) = fresh_db_with_task();
        let err = insert(&conn, &draft("ghost")).expect_err("FK");
        match err {
            DbError::Sqlite(rusqlite::Error::SqliteFailure(code, _)) => {
                assert_eq!(code.code, rusqlite::ErrorCode::ConstraintViolation);
            }
            other => panic!("got {other:?}"),
        }
    }

    #[test]
    fn task_delete_cascades_attachments() {
        let (conn, t) = fresh_db_with_task();
        let _row = insert(&conn, &draft(&t)).unwrap();
        conn.execute("DELETE FROM tasks WHERE id = ?1", params![t])
            .unwrap();
        let rows = list_all(&conn).unwrap();
        assert!(rows.is_empty());
    }
}
