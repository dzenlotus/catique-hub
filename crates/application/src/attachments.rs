//! Attachments use case.
//!
//! Wave-E2.4 (Olga). Metadata-only — physical-blob handling
//! (`<app_data>/attachments/<task_id>/<storage_path>`) is deferred to
//! E3. The `create` call accepts the storage path the caller has
//! already written to disk; this layer only persists the metadata row.

use catique_domain::Attachment;
use catique_infrastructure::db::{
    pool::{acquire, Pool},
    repositories::attachments::{self as repo, AttachmentDraft, AttachmentPatch, AttachmentRow},
};
use rusqlite::params;

use crate::{
    error::AppError,
    error_map::{map_db_err, validate_non_empty},
};

/// Maximum attachment size we accept (10 MiB) — matches NFR §3.4
/// blob-budget. Caller may pass anything; this gate is a defensive
/// safety net before the row even hits SQLite.
const MAX_SIZE_BYTES: i64 = 10 * 1024 * 1024;

/// Attachments use case.
pub struct AttachmentsUseCase<'a> {
    pool: &'a Pool,
}

impl<'a> AttachmentsUseCase<'a> {
    /// Constructor.
    #[must_use]
    pub fn new(pool: &'a Pool) -> Self {
        Self { pool }
    }

    /// List every attachment metadata row (newest first).
    ///
    /// # Errors
    ///
    /// Forwards storage-layer errors.
    pub fn list(&self) -> Result<Vec<Attachment>, AppError> {
        let conn = acquire(self.pool).map_err(map_db_err)?;
        let rows = repo::list_all(&conn).map_err(map_db_err)?;
        Ok(rows.into_iter().map(row_to_attachment).collect())
    }

    /// Look up an attachment by id.
    ///
    /// # Errors
    ///
    /// `AppError::NotFound` if missing.
    pub fn get(&self, id: &str) -> Result<Attachment, AppError> {
        let conn = acquire(self.pool).map_err(map_db_err)?;
        match repo::get_by_id(&conn, id).map_err(map_db_err)? {
            Some(row) => Ok(row_to_attachment(row)),
            None => Err(AppError::NotFound {
                entity: "attachment".into(),
                id: id.to_owned(),
            }),
        }
    }

    /// Create an attachment metadata row.
    ///
    /// # Errors
    ///
    /// `AppError::Validation` for empty filename / mime / storage_path
    /// / out-of-range size; `AppError::NotFound` for missing `task_id`.
    #[allow(clippy::needless_pass_by_value, clippy::too_many_arguments)]
    pub fn create(
        &self,
        task_id: String,
        filename: String,
        mime_type: String,
        size_bytes: i64,
        storage_path: String,
        uploaded_by: Option<String>,
    ) -> Result<Attachment, AppError> {
        let trimmed_filename = validate_non_empty("filename", &filename)?;
        let trimmed_mime = validate_non_empty("mime_type", &mime_type)?;
        let trimmed_path = validate_non_empty("storage_path", &storage_path)?;
        if size_bytes < 0 {
            return Err(AppError::Validation {
                field: "size_bytes".into(),
                reason: "must be non-negative".into(),
            });
        }
        if size_bytes > MAX_SIZE_BYTES {
            return Err(AppError::Validation {
                field: "size_bytes".into(),
                reason: format!("must be ≤ {MAX_SIZE_BYTES} bytes"),
            });
        }
        let conn = acquire(self.pool).map_err(map_db_err)?;
        let task_exists: bool = conn
            .query_row("SELECT 1 FROM tasks WHERE id = ?1", params![task_id], |_| {
                Ok(())
            })
            .map(|()| true)
            .or_else(|e| match e {
                rusqlite::Error::QueryReturnedNoRows => Ok(false),
                other => Err(other),
            })
            .map_err(|e| map_db_err(catique_infrastructure::db::pool::DbError::Sqlite(e)))?;
        if !task_exists {
            return Err(AppError::NotFound {
                entity: "task".into(),
                id: task_id,
            });
        }
        let row = repo::insert(
            &conn,
            &AttachmentDraft {
                task_id,
                filename: trimmed_filename,
                mime_type: trimmed_mime,
                size_bytes,
                storage_path: trimmed_path,
                uploaded_by,
            },
        )
        .map_err(map_db_err)?;
        Ok(row_to_attachment(row))
    }

    /// Partial update — really only `filename` and `uploaded_by` are
    /// mutable in practice (storage_path is the on-disk binding).
    ///
    /// # Errors
    ///
    /// `AppError::NotFound` if id is unknown.
    #[allow(clippy::needless_pass_by_value)]
    pub fn update(
        &self,
        id: String,
        filename: Option<String>,
        uploaded_by: Option<Option<String>>,
    ) -> Result<Attachment, AppError> {
        if let Some(f) = filename.as_deref() {
            validate_non_empty("filename", f)?;
        }
        let conn = acquire(self.pool).map_err(map_db_err)?;
        let patch = AttachmentPatch {
            filename: filename.map(|f| f.trim().to_owned()),
            uploaded_by,
        };
        match repo::update(&conn, &id, &patch).map_err(map_db_err)? {
            Some(row) => Ok(row_to_attachment(row)),
            None => Err(AppError::NotFound {
                entity: "attachment".into(),
                id,
            }),
        }
    }

    /// Delete an attachment metadata row. Does NOT touch the on-disk
    /// blob — callers are responsible for that (E3 will wire it).
    ///
    /// # Errors
    ///
    /// `AppError::NotFound` if id is unknown.
    pub fn delete(&self, id: &str) -> Result<(), AppError> {
        let conn = acquire(self.pool).map_err(map_db_err)?;
        let removed = repo::delete(&conn, id).map_err(map_db_err)?;
        if removed {
            Ok(())
        } else {
            Err(AppError::NotFound {
                entity: "attachment".into(),
                id: id.to_owned(),
            })
        }
    }
}

fn row_to_attachment(row: AttachmentRow) -> Attachment {
    Attachment {
        id: row.id,
        task_id: row.task_id,
        filename: row.filename,
        mime_type: row.mime_type,
        size_bytes: row.size_bytes,
        storage_path: row.storage_path,
        uploaded_at: row.uploaded_at,
        uploaded_by: row.uploaded_by,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use catique_infrastructure::db::pool::memory_pool_for_tests;
    use catique_infrastructure::db::runner::run_pending;

    fn fresh_pool_with_task() -> Pool {
        let pool = memory_pool_for_tests();
        let mut conn = pool.get().unwrap();
        run_pending(&mut conn).unwrap();
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
        drop(conn);
        pool
    }

    #[test]
    fn create_with_missing_task_returns_not_found() {
        let pool = fresh_pool_with_task();
        let uc = AttachmentsUseCase::new(&pool);
        let err = uc
            .create(
                "ghost".into(),
                "f.png".into(),
                "image/png".into(),
                100,
                "f.png".into(),
                None,
            )
            .expect_err("nf");
        match err {
            AppError::NotFound { entity, .. } => assert_eq!(entity, "task"),
            other => panic!("got {other:?}"),
        }
    }

    #[test]
    fn create_with_oversize_returns_validation() {
        let pool = fresh_pool_with_task();
        let uc = AttachmentsUseCase::new(&pool);
        let err = uc
            .create(
                "t1".into(),
                "big.bin".into(),
                "application/octet-stream".into(),
                MAX_SIZE_BYTES + 1,
                "big.bin".into(),
                None,
            )
            .expect_err("v");
        match err {
            AppError::Validation { field, .. } => assert_eq!(field, "size_bytes"),
            other => panic!("got {other:?}"),
        }
    }

    #[test]
    fn create_then_list_then_delete() {
        let pool = fresh_pool_with_task();
        let uc = AttachmentsUseCase::new(&pool);
        let a = uc
            .create(
                "t1".into(),
                "f.png".into(),
                "image/png".into(),
                100,
                "f.png".into(),
                None,
            )
            .unwrap();
        assert_eq!(uc.list().unwrap().len(), 1);
        uc.delete(&a.id).unwrap();
        match uc.delete(&a.id).expect_err("second") {
            AppError::NotFound { entity, .. } => assert_eq!(entity, "attachment"),
            other => panic!("got {other:?}"),
        }
    }

    #[test]
    fn update_renames_filename() {
        let pool = fresh_pool_with_task();
        let uc = AttachmentsUseCase::new(&pool);
        let a = uc
            .create(
                "t1".into(),
                "old.png".into(),
                "image/png".into(),
                100,
                "stored.png".into(),
                None,
            )
            .unwrap();
        let renamed = uc
            .update(a.id.clone(), Some("new.png".into()), None)
            .unwrap();
        assert_eq!(renamed.filename, "new.png");
        assert_eq!(renamed.storage_path, "stored.png");
    }
}
