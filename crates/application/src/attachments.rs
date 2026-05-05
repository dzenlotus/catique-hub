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

    /// List attachment metadata rows (newest first).
    ///
    /// `task_id` is an optional filter. When `None`, every row is
    /// returned — preserving legacy callers' behaviour. When `Some`, the
    /// filter `task_id = ?1` is applied at the SQL layer using the
    /// `idx_task_attachments_task` index. The repository's `list_all`
    /// is reused for the unfiltered branch; the filtered query is
    /// issued in-place here so the repository crate stays untouched
    /// (per ctq-92 minimal-change rule).
    ///
    /// # Errors
    ///
    /// Forwards storage-layer errors.
    pub fn list(&self, task_id: Option<String>) -> Result<Vec<Attachment>, AppError> {
        let conn = acquire(self.pool).map_err(map_db_err)?;
        match task_id {
            None => {
                let rows = repo::list_all(&conn).map_err(map_db_err)?;
                Ok(rows.into_iter().map(row_to_attachment).collect())
            }
            Some(tid) => {
                // SQL: `WHERE (?1 IS NULL OR task_id = ?1)` per spec.
                // Branch on `Option` outside the query: the `Some` arm
                // is the indexed path; the `None` arm reuses the
                // repository helper. Same end result either way.
                let mut stmt = conn
                    .prepare(
                        "SELECT id, task_id, filename, mime_type, size_bytes, \
                                storage_path, uploaded_at, uploaded_by \
                         FROM task_attachments \
                         WHERE (?1 IS NULL OR task_id = ?1) \
                         ORDER BY uploaded_at DESC",
                    )
                    .map_err(|e| {
                        map_db_err(catique_infrastructure::db::pool::DbError::Sqlite(e))
                    })?;
                let rows = stmt
                    .query_map(params![tid], |row| {
                        Ok(AttachmentRow {
                            id: row.get("id")?,
                            task_id: row.get("task_id")?,
                            filename: row.get("filename")?,
                            mime_type: row.get("mime_type")?,
                            size_bytes: row.get("size_bytes")?,
                            storage_path: row.get("storage_path")?,
                            uploaded_at: row.get("uploaded_at")?,
                            uploaded_by: row.get("uploaded_by")?,
                        })
                    })
                    .map_err(|e| {
                        map_db_err(catique_infrastructure::db::pool::DbError::Sqlite(e))
                    })?;
                let mut out = Vec::new();
                for r in rows {
                    out.push(row_to_attachment(r.map_err(|e| {
                        map_db_err(catique_infrastructure::db::pool::DbError::Sqlite(e))
                    })?));
                }
                Ok(out)
            }
        }
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
            .query_row(
                "SELECT 1 FROM tasks WHERE id = ?1",
                params![task_id],
                |_| Ok(()),
            )
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

    /// Delete an attachment metadata row.
    ///
    /// **Metadata-only.** Does not touch the on-disk blob. Use
    /// [`AttachmentsUseCase::delete_with_blob`] from the IPC layer (or
    /// any caller that has resolved the on-disk root) so the file is
    /// removed in lock-step with the row.
    ///
    /// Kept as a separate entry point for callers that intentionally
    /// don't own the filesystem (e.g. unit tests for the metadata path,
    /// or future remote-storage backends).
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

    /// Delete an attachment metadata row **and** unlink the underlying
    /// blob from disk.
    ///
    /// `blob_root` is the root directory under which task-scoped
    /// attachments live — typically `$APPLOCALDATA/catique/attachments`.
    /// The full blob path is reconstructed as
    /// `<blob_root>/<task_id>/<storage_path>` so deletion mirrors the
    /// layout `upload_attachment` writes (`handlers/attachments.rs`).
    ///
    /// Failure modes:
    ///
    /// * If the row is missing → `AppError::NotFound` (same as `delete`).
    /// * If the row was deleted but the file is **not present** on disk
    ///   → success, with a `[catique-hub]` warning logged. Idempotency
    ///   over orphan-cleanup correctness is the right tradeoff: a re-run
    ///   of `delete` on a half-cleaned attachment must not fail.
    /// * If `fs::remove_file` returns any other error
    ///   (permission, mount-busy, …) → success with a warning. The
    ///   metadata row is already gone and surfacing the FS error to the
    ///   IPC caller would force the UI to handle a half-deleted state
    ///   that is functionally equivalent to "blob orphaned" — the
    ///   nightly orphan-sweep job (E3) will reconcile.
    ///
    /// # Errors
    ///
    /// `AppError::NotFound` if id is unknown.
    pub fn delete_with_blob(&self, id: &str, blob_root: &std::path::Path) -> Result<(), AppError> {
        let conn = acquire(self.pool).map_err(map_db_err)?;
        // Look up the row first so we know the on-disk path before the
        // metadata vanishes. If the row is missing, surface `NotFound`
        // before touching the filesystem.
        let Some(row) = repo::get_by_id(&conn, id).map_err(map_db_err)? else {
            return Err(AppError::NotFound {
                entity: "attachment".into(),
                id: id.to_owned(),
            });
        };
        let removed = repo::delete(&conn, id).map_err(map_db_err)?;
        if !removed {
            // Race: another caller deleted the row between our SELECT
            // and DELETE. Treat as `NotFound` for the same reason
            // `delete` does — the post-condition (no row with this id)
            // is satisfied.
            return Err(AppError::NotFound {
                entity: "attachment".into(),
                id: id.to_owned(),
            });
        }
        // Reconstruct the on-disk path. `storage_path` is a leaf name
        // produced by `upload_attachment` (`<id>_<sanitized_name>`),
        // which is already collision-safe.
        let blob_path = blob_root.join(&row.task_id).join(&row.storage_path);
        match std::fs::remove_file(&blob_path) {
            Ok(()) => {}
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => {
                // File missing on disk: log + continue. This is the
                // idempotent re-delete path — see the doc-comment.
                eprintln!(
                    "[catique-hub] delete_attachment: blob already missing at {} ({})",
                    blob_path.display(),
                    e
                );
            }
            Err(e) => {
                eprintln!(
                    "[catique-hub] delete_attachment: failed to remove blob at {}: {}",
                    blob_path.display(),
                    e
                );
            }
        }
        Ok(())
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
        assert_eq!(uc.list(None).unwrap().len(), 1);
        uc.delete(&a.id).unwrap();
        match uc.delete(&a.id).expect_err("second") {
            AppError::NotFound { entity, .. } => assert_eq!(entity, "attachment"),
            other => panic!("got {other:?}"),
        }
    }

    fn fresh_pool_with_two_tasks() -> Pool {
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
                 VALUES ('t1','bd1','c1','sp-1','T1',0,0,0), \
                        ('t2','bd1','c1','sp-2','T2',1,0,0);",
        )
        .unwrap();
        drop(conn);
        pool
    }

    #[test]
    fn list_with_task_id_filters_to_that_task() {
        let pool = fresh_pool_with_two_tasks();
        let uc = AttachmentsUseCase::new(&pool);
        let a1 = uc
            .create(
                "t1".into(),
                "a.png".into(),
                "image/png".into(),
                10,
                "a.png".into(),
                None,
            )
            .unwrap();
        let _b = uc
            .create(
                "t2".into(),
                "b.png".into(),
                "image/png".into(),
                10,
                "b.png".into(),
                None,
            )
            .unwrap();
        // Unfiltered: both rows.
        assert_eq!(uc.list(None).unwrap().len(), 2);
        // Filtered to t1: just a1.
        let only_t1 = uc.list(Some("t1".into())).unwrap();
        assert_eq!(only_t1.len(), 1);
        assert_eq!(only_t1[0].id, a1.id);
        // Filter to non-existent task: empty.
        assert!(uc.list(Some("ghost".into())).unwrap().is_empty());
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

    #[test]
    fn delete_attachment_removes_blob_from_disk() {
        // Stand up a temp blob root mirroring the production layout
        // `<root>/<task_id>/<storage_path>` and assert the file is
        // unlinked alongside the row.
        let pool = fresh_pool_with_task();
        let uc = AttachmentsUseCase::new(&pool);
        let blob_root = tempfile::tempdir().unwrap();
        let storage_name = "abc_screenshot.png".to_owned();
        let task_dir = blob_root.path().join("t1");
        std::fs::create_dir_all(&task_dir).unwrap();
        let blob_path = task_dir.join(&storage_name);
        std::fs::write(&blob_path, b"fake-png-bytes").unwrap();
        assert!(blob_path.exists(), "fixture file should be on disk");

        let a = uc
            .create(
                "t1".into(),
                "screenshot.png".into(),
                "image/png".into(),
                14,
                storage_name,
                None,
            )
            .unwrap();

        uc.delete_with_blob(&a.id, blob_root.path()).unwrap();

        assert!(!blob_path.exists(), "blob should be removed from disk");
        // Row gone, second delete is `NotFound`.
        match uc
            .delete_with_blob(&a.id, blob_root.path())
            .expect_err("nf")
        {
            AppError::NotFound { entity, .. } => assert_eq!(entity, "attachment"),
            other => panic!("got {other:?}"),
        }
    }

    #[test]
    fn delete_attachment_idempotent_when_blob_missing() {
        // Pre-delete the file before calling `delete_with_blob` —
        // the use case must succeed (warn-and-continue path).
        let pool = fresh_pool_with_task();
        let uc = AttachmentsUseCase::new(&pool);
        let blob_root = tempfile::tempdir().unwrap();
        let storage_name = "ghosted.png".to_owned();

        let a = uc
            .create(
                "t1".into(),
                "ghosted.png".into(),
                "image/png".into(),
                0,
                storage_name.clone(),
                None,
            )
            .unwrap();

        // No file ever written — directory does not even exist.
        let blob_path = blob_root.path().join("t1").join(&storage_name);
        assert!(
            !blob_path.exists(),
            "precondition: blob must be missing before the call"
        );

        // Must succeed despite the missing file.
        uc.delete_with_blob(&a.id, blob_root.path())
            .expect("delete should succeed when blob is already gone");

        // Row removed.
        match uc.get(&a.id).expect_err("nf") {
            AppError::NotFound { entity, .. } => assert_eq!(entity, "attachment"),
            other => panic!("got {other:?}"),
        }
    }
}
