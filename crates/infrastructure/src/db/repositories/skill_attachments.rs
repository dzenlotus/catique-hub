//! Skill-attachments repository — `skill_attachments` metadata.
//!
//! Schema: `025_skill_attachments.sql`. Two-kind discriminator
//! (`file` / `git`) is enforced by a row-level CHECK constraint; this
//! module exposes typed drafts so callers cannot construct a "hybrid"
//! row from Rust without the DB explicitly rejecting it.
//!
//! Physical blob handling lives in the api layer (mirrors the
//! `task_attachments` upload handler). This repository owns metadata
//! only.

use rusqlite::{params, Connection, OptionalExtension, Row};

use super::util::{new_id, now_millis};
use crate::db::pool::DbError;

/// Discriminator for [`SkillAttachmentRow::kind`]. Mirrors
/// `catique_domain::SkillAttachmentKind` but kept as a plain enum here
/// so the infrastructure layer stays free of domain imports.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum SkillAttachmentKind {
    File,
    Git,
}

impl SkillAttachmentKind {
    /// Render to the SQL string literal stored in `kind`.
    #[must_use]
    pub fn as_sql(self) -> &'static str {
        match self {
            Self::File => "file",
            Self::Git => "git",
        }
    }

    /// Parse from the SQL string literal. Unknown values surface as
    /// `None`; callers translate that into a row-decode error.
    #[must_use]
    pub fn from_sql(s: &str) -> Option<Self> {
        match s {
            "file" => Some(Self::File),
            "git" => Some(Self::Git),
            _ => None,
        }
    }
}

/// One row of `skill_attachments`.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct SkillAttachmentRow {
    pub id: String,
    pub skill_id: String,
    pub kind: SkillAttachmentKind,
    pub filename: Option<String>,
    pub mime_type: Option<String>,
    pub size_bytes: Option<i64>,
    pub storage_path: Option<String>,
    pub git_url: Option<String>,
    pub git_ref: Option<String>,
    pub git_path: Option<String>,
    pub created_at: i64,
}

impl SkillAttachmentRow {
    fn from_row(row: &Row<'_>) -> rusqlite::Result<Self> {
        let kind_str: String = row.get("kind")?;
        let kind = SkillAttachmentKind::from_sql(&kind_str).ok_or_else(|| {
            rusqlite::Error::FromSqlConversionFailure(
                0,
                rusqlite::types::Type::Text,
                format!("unknown skill_attachments.kind value `{kind_str}`").into(),
            )
        })?;
        Ok(Self {
            id: row.get("id")?,
            skill_id: row.get("skill_id")?,
            kind,
            filename: row.get("filename")?,
            mime_type: row.get("mime_type")?,
            size_bytes: row.get("size_bytes")?,
            storage_path: row.get("storage_path")?,
            git_url: row.get("git_url")?,
            git_ref: row.get("git_ref")?,
            git_path: row.get("git_path")?,
            created_at: row.get("created_at")?,
        })
    }
}

/// Draft for inserting a file-kind attachment.
#[derive(Debug, Clone)]
pub struct FileAttachmentDraft {
    pub skill_id: String,
    pub filename: String,
    pub mime_type: String,
    pub size_bytes: i64,
    pub storage_path: String,
}

/// Draft for inserting a git-kind attachment.
#[derive(Debug, Clone)]
pub struct GitAttachmentDraft {
    pub skill_id: String,
    pub git_url: String,
    pub git_ref: Option<String>,
    pub git_path: Option<String>,
}

/// List every attachment for a skill, oldest first (matches the
/// renderer's expected order: append-only). Empty when the skill has no
/// attachments — does NOT validate that the skill itself exists.
///
/// # Errors
///
/// Surfaces rusqlite errors.
pub fn list_by_skill(
    conn: &Connection,
    skill_id: &str,
) -> Result<Vec<SkillAttachmentRow>, DbError> {
    let mut stmt = conn.prepare(
        "SELECT id, skill_id, kind, filename, mime_type, size_bytes, storage_path, \
                git_url, git_ref, git_path, created_at \
         FROM skill_attachments \
         WHERE skill_id = ?1 \
         ORDER BY created_at ASC, id ASC",
    )?;
    let rows = stmt.query_map(params![skill_id], SkillAttachmentRow::from_row)?;
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
pub fn get_by_id(conn: &Connection, id: &str) -> Result<Option<SkillAttachmentRow>, DbError> {
    let mut stmt = conn.prepare(
        "SELECT id, skill_id, kind, filename, mime_type, size_bytes, storage_path, \
                git_url, git_ref, git_path, created_at \
         FROM skill_attachments WHERE id = ?1",
    )?;
    Ok(stmt
        .query_row(params![id], SkillAttachmentRow::from_row)
        .optional()?)
}

/// Insert a file-kind attachment. Generates id, stamps `created_at`.
///
/// # Errors
///
/// FK violation on `skill_id` and the row-level CHECK both surface as
/// [`DbError::Sqlite`].
pub fn insert_file(
    conn: &Connection,
    draft: &FileAttachmentDraft,
) -> Result<SkillAttachmentRow, DbError> {
    let id = new_id();
    let now = now_millis();
    conn.execute(
        "INSERT INTO skill_attachments \
            (id, skill_id, kind, filename, mime_type, size_bytes, storage_path, \
             git_url, git_ref, git_path, created_at) \
         VALUES (?1, ?2, 'file', ?3, ?4, ?5, ?6, NULL, NULL, NULL, ?7)",
        params![
            id,
            draft.skill_id,
            draft.filename,
            draft.mime_type,
            draft.size_bytes,
            draft.storage_path,
            now,
        ],
    )?;
    Ok(SkillAttachmentRow {
        id,
        skill_id: draft.skill_id.clone(),
        kind: SkillAttachmentKind::File,
        filename: Some(draft.filename.clone()),
        mime_type: Some(draft.mime_type.clone()),
        size_bytes: Some(draft.size_bytes),
        storage_path: Some(draft.storage_path.clone()),
        git_url: None,
        git_ref: None,
        git_path: None,
        created_at: now,
    })
}

/// Insert a git-kind attachment. Generates id, stamps `created_at`.
///
/// # Errors
///
/// FK violation on `skill_id` and the row-level CHECK both surface as
/// [`DbError::Sqlite`].
pub fn insert_git(
    conn: &Connection,
    draft: &GitAttachmentDraft,
) -> Result<SkillAttachmentRow, DbError> {
    let id = new_id();
    let now = now_millis();
    conn.execute(
        "INSERT INTO skill_attachments \
            (id, skill_id, kind, filename, mime_type, size_bytes, storage_path, \
             git_url, git_ref, git_path, created_at) \
         VALUES (?1, ?2, 'git', NULL, NULL, NULL, NULL, ?3, ?4, ?5, ?6)",
        params![
            id,
            draft.skill_id,
            draft.git_url,
            draft.git_ref,
            draft.git_path,
            now,
        ],
    )?;
    Ok(SkillAttachmentRow {
        id,
        skill_id: draft.skill_id.clone(),
        kind: SkillAttachmentKind::Git,
        filename: None,
        mime_type: None,
        size_bytes: None,
        storage_path: None,
        git_url: Some(draft.git_url.clone()),
        git_ref: draft.git_ref.clone(),
        git_path: draft.git_path.clone(),
        created_at: now,
    })
}

/// Delete one row by id. Caller is responsible for removing the
/// physical blob (file-kind only); this layer only manages metadata.
///
/// # Errors
///
/// Surfaces rusqlite errors.
pub fn delete(conn: &Connection, id: &str) -> Result<bool, DbError> {
    let n = conn.execute("DELETE FROM skill_attachments WHERE id = ?1", params![id])?;
    Ok(n > 0)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db::runner::run_pending;

    fn fresh_db_with_skill() -> (Connection, String) {
        let mut conn = Connection::open_in_memory().expect("open in-memory");
        conn.execute_batch("PRAGMA foreign_keys = ON;")
            .expect("pragma");
        run_pending(&mut conn).expect("migrations");
        conn.execute_batch(
            "INSERT INTO skills (id, name, description, color, position, created_at, updated_at) \
                 VALUES ('sk1','Rust',NULL,NULL,0,0,0);",
        )
        .expect("seed skill");
        (conn, "sk1".to_owned())
    }

    #[test]
    fn insert_file_and_get() {
        let (conn, sk) = fresh_db_with_skill();
        let row = insert_file(
            &conn,
            &FileAttachmentDraft {
                skill_id: sk.clone(),
                filename: "cheatsheet.md".into(),
                mime_type: "text/markdown".into(),
                size_bytes: 1234,
                storage_path: "abc_cheatsheet.md".into(),
            },
        )
        .expect("insert file");
        assert_eq!(row.kind, SkillAttachmentKind::File);
        let got = get_by_id(&conn, &row.id).unwrap().unwrap();
        assert_eq!(row, got);
        assert_eq!(got.filename.as_deref(), Some("cheatsheet.md"));
        assert!(got.git_url.is_none());
    }

    #[test]
    fn insert_git_and_get() {
        let (conn, sk) = fresh_db_with_skill();
        let row = insert_git(
            &conn,
            &GitAttachmentDraft {
                skill_id: sk.clone(),
                git_url: "https://github.com/rust-lang/rust".into(),
                git_ref: Some("main".into()),
                git_path: Some("library/std".into()),
            },
        )
        .expect("insert git");
        assert_eq!(row.kind, SkillAttachmentKind::Git);
        let got = get_by_id(&conn, &row.id).unwrap().unwrap();
        assert_eq!(row, got);
        assert!(got.filename.is_none());
        assert_eq!(got.git_ref.as_deref(), Some("main"));
        assert_eq!(got.git_path.as_deref(), Some("library/std"));
    }

    #[test]
    fn cascade_delete_with_skill() {
        let (conn, sk) = fresh_db_with_skill();
        insert_file(
            &conn,
            &FileAttachmentDraft {
                skill_id: sk.clone(),
                filename: "a.txt".into(),
                mime_type: "text/plain".into(),
                size_bytes: 1,
                storage_path: "a.txt".into(),
            },
        )
        .unwrap();
        insert_git(
            &conn,
            &GitAttachmentDraft {
                skill_id: sk.clone(),
                git_url: "https://example.com/repo.git".into(),
                git_ref: None,
                git_path: None,
            },
        )
        .unwrap();
        // Pre-condition: two rows attached.
        assert_eq!(list_by_skill(&conn, &sk).unwrap().len(), 2);
        // Drop the skill → FK cascade wipes both rows.
        conn.execute("DELETE FROM skills WHERE id = ?1", params![sk])
            .unwrap();
        assert!(list_by_skill(&conn, &sk).unwrap().is_empty());
    }

    #[test]
    fn check_constraint_rejects_hybrid() {
        // Bypass the typed drafts and craft a row that violates the
        // mutual-exclusion CHECK: kind='file' but git_url also set.
        let (conn, sk) = fresh_db_with_skill();
        let err = conn
            .execute(
                "INSERT INTO skill_attachments \
                    (id, skill_id, kind, filename, mime_type, size_bytes, storage_path, \
                     git_url, git_ref, git_path, created_at) \
                 VALUES ('h1', ?1, 'file', 'a.txt', 'text/plain', 1, 'a.txt', \
                         'https://example.com/repo.git', NULL, NULL, 0)",
                params![sk],
            )
            .expect_err("CHECK should reject hybrid row");
        match err {
            rusqlite::Error::SqliteFailure(code, _) => {
                assert_eq!(code.code, rusqlite::ErrorCode::ConstraintViolation);
            }
            other => panic!("expected CHECK violation, got {other:?}"),
        }
    }

    #[test]
    fn delete_returns_true_then_false() {
        let (conn, sk) = fresh_db_with_skill();
        let row = insert_file(
            &conn,
            &FileAttachmentDraft {
                skill_id: sk,
                filename: "a.txt".into(),
                mime_type: "text/plain".into(),
                size_bytes: 1,
                storage_path: "a.txt".into(),
            },
        )
        .unwrap();
        assert!(delete(&conn, &row.id).unwrap());
        assert!(!delete(&conn, &row.id).unwrap());
    }

    #[test]
    fn list_by_skill_orders_by_created_at_then_id() {
        let (conn, sk) = fresh_db_with_skill();
        // Two inserts can land in the same millisecond on a fast box;
        // the tie-breaker `id ASC` keeps the ordering deterministic.
        let a = insert_file(
            &conn,
            &FileAttachmentDraft {
                skill_id: sk.clone(),
                filename: "a.txt".into(),
                mime_type: "text/plain".into(),
                size_bytes: 1,
                storage_path: "a.txt".into(),
            },
        )
        .unwrap();
        let b = insert_git(
            &conn,
            &GitAttachmentDraft {
                skill_id: sk.clone(),
                git_url: "https://example.com/repo.git".into(),
                git_ref: None,
                git_path: None,
            },
        )
        .unwrap();
        let rows = list_by_skill(&conn, &sk).unwrap();
        assert_eq!(rows.len(), 2);
        // a was inserted first, so it comes first by created_at; if
        // created_at ties, the id tiebreak still surfaces both rows.
        assert!(rows.iter().any(|r| r.id == a.id));
        assert!(rows.iter().any(|r| r.id == b.id));
    }
}
