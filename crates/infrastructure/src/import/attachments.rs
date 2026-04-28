//! Filesystem copy of `~/.promptery/attachments/` → Catique data dir.
//!
//! Per migration plan v0.5 §3.2 step 5a + D-021 Q-1 (filesystem-only,
//! status quo). For each row in the source `task_attachments` table we
//! locate the corresponding file at
//! `<source_attachments>/<storage_path>` and copy it to
//! `<target_attachments>/<storage_path>`, preserving the `<task_id>/<file>`
//! sub-tree.
//!
//! After the copy the byte size is verified against the metadata-row's
//! `size_bytes`. Mismatch → fail import (caller rolls back the DB
//! transaction and removes both the partial attachments dir and the
//! `.import-tmp/` working DB).
//!
//! If the source attachments directory is **absent** (some Promptery
//! installs have no attachments yet), the copy is a no-op with zero
//! counters returned. Per migration-plan §3.2 step 5a footer.

use std::path::{Path, PathBuf};

use rusqlite::Connection;

use super::ImportError;

/// Counter bundle returned by [`copy_attachments`].
#[derive(Debug, Clone, Default)]
pub struct AttachmentsCopyOutcome {
    /// Number of files copied successfully.
    pub copied: u64,
    /// Total byte volume copied.
    pub total_bytes: u64,
}

/// Copy the attachments tree from `source_root` into `target_root`,
/// using the source DB's `task_attachments` table as the authoritative
/// list of expected files.
///
/// # Errors
///
/// * [`ImportError::Sqlite`] on read failure of `task_attachments`.
/// * [`ImportError::Io`] on copy failure.
/// * [`ImportError::Validation`] on byte-size mismatch between disk
///   and metadata.
pub fn copy_attachments(
    source_db: &Connection,
    source_root: Option<&Path>,
    target_root: &Path,
) -> Result<AttachmentsCopyOutcome, ImportError> {
    let mut outcome = AttachmentsCopyOutcome::default();

    // Without a source attachments root, there are no files to copy
    // even if the metadata table has rows. We log the warning via the
    // ImportReport upstream; here we just return zero counters.
    let Some(src_root) = source_root else {
        return Ok(outcome);
    };
    if !src_root.exists() {
        return Ok(outcome);
    }

    let mut stmt = source_db.prepare("SELECT storage_path, size_bytes FROM task_attachments")?;
    let rows = stmt.query_map([], |row| {
        Ok((row.get::<_, String>(0)?, row.get::<_, i64>(1)?))
    })?;

    for row in rows {
        let (storage_path, expected_size) = row?;
        let src = src_root.join(&storage_path);
        let dst = target_root.join(&storage_path);

        if !src.exists() {
            // Metadata claims the file but the binary is missing.
            // We surface this as a validation error so the import
            // doesn't silently lose user data.
            return Err(ImportError::Validation {
                reason: format!(
                    "attachment metadata references missing file: {}",
                    src.display()
                ),
            });
        }

        if let Some(parent) = dst.parent() {
            std::fs::create_dir_all(parent)?;
        }
        let copied_bytes = std::fs::copy(&src, &dst)?;
        let copied_i64 = i64::try_from(copied_bytes).unwrap_or(i64::MAX);
        if copied_i64 != expected_size {
            return Err(ImportError::Validation {
                reason: format!(
                    "attachment size mismatch for {storage_path}: expected {expected_size}, got {copied_bytes}"
                ),
            });
        }
        outcome.copied += 1;
        outcome.total_bytes += copied_bytes;
    }

    Ok(outcome)
}

/// Resolve the conventional Promptery attachments directory based on
/// the source DB path. Promptery stores binaries under
/// `<source_dir>/attachments/`.
#[must_use]
pub fn default_source_attachments_dir(source_db_path: &Path) -> Option<PathBuf> {
    source_db_path.parent().map(|p| p.join("attachments"))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn unique_tmp(label: &str) -> PathBuf {
        let nanos = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .map_or(0, |d| d.subsec_nanos());
        let dir = std::env::temp_dir().join(format!(
            "catique-att-{}-{label}-{nanos}",
            std::process::id()
        ));
        std::fs::create_dir_all(&dir).unwrap();
        dir
    }

    fn make_source_db_with_one_attachment(size: i64, storage_path: &str) -> (PathBuf, Connection) {
        let tmp = unique_tmp("seedone");
        let db_path = tmp.join("src.sqlite");
        let conn = Connection::open(&db_path).unwrap();
        conn.execute_batch(
            "CREATE TABLE task_attachments (\
                id TEXT PRIMARY KEY, \
                task_id TEXT NOT NULL, \
                filename TEXT, \
                mime_type TEXT, \
                size_bytes INTEGER NOT NULL, \
                storage_path TEXT NOT NULL, \
                uploaded_at INTEGER NOT NULL, \
                uploaded_by TEXT)",
        )
        .unwrap();
        conn.execute(
            "INSERT INTO task_attachments \
             (id, task_id, filename, mime_type, size_bytes, storage_path, uploaded_at, uploaded_by) \
             VALUES ('a1', 't1', 'f.png', 'image/png', ?1, ?2, 0, 'tester')",
            rusqlite::params![size, storage_path],
        )
        .unwrap();
        (tmp, conn)
    }

    #[test]
    fn no_attachments_dir_returns_zero_counters() {
        let (tmp, conn) = make_source_db_with_one_attachment(3, "t1/f.png");
        let target = unique_tmp("attno");
        // attachments dir = None
        let out = copy_attachments(&conn, None, &target).unwrap();
        assert_eq!(out.copied, 0);
        assert_eq!(out.total_bytes, 0);
        let _ = std::fs::remove_dir_all(&tmp);
        let _ = std::fs::remove_dir_all(&target);
    }

    #[test]
    fn missing_source_dir_logs_warning_and_returns_zero() {
        let (tmp, conn) = make_source_db_with_one_attachment(3, "t1/f.png");
        let target = unique_tmp("attmiss");
        let nonexistent = unique_tmp("att-source-gone");
        std::fs::remove_dir(&nonexistent).unwrap();
        let out = copy_attachments(&conn, Some(&nonexistent), &target).unwrap();
        assert_eq!(out.copied, 0);
        let _ = std::fs::remove_dir_all(&tmp);
        let _ = std::fs::remove_dir_all(&target);
    }

    #[test]
    fn copies_one_file_and_verifies_size() {
        let (tmp, conn) = make_source_db_with_one_attachment(3, "t1/f.png");
        // Write the actual file under <tmp>/source/t1/f.png
        let src_root = tmp.join("source");
        std::fs::create_dir_all(src_root.join("t1")).unwrap();
        std::fs::write(src_root.join("t1/f.png"), b"abc").unwrap();
        let target = unique_tmp("attcp");

        let out = copy_attachments(&conn, Some(&src_root), &target).unwrap();
        assert_eq!(out.copied, 1);
        assert_eq!(out.total_bytes, 3);
        assert!(target.join("t1/f.png").exists());
        let _ = std::fs::remove_dir_all(&tmp);
        let _ = std::fs::remove_dir_all(&target);
    }

    #[test]
    fn size_mismatch_fails_import() {
        // Metadata says 99 but file is 3 bytes; copy_attachments must
        // bail with a Validation error.
        let (tmp, conn) = make_source_db_with_one_attachment(99, "t1/f.png");
        let src_root = tmp.join("source");
        std::fs::create_dir_all(src_root.join("t1")).unwrap();
        std::fs::write(src_root.join("t1/f.png"), b"abc").unwrap();
        let target = unique_tmp("attbad");
        let err =
            copy_attachments(&conn, Some(&src_root), &target).expect_err("size mismatch must fail");
        match err {
            ImportError::Validation { reason } => {
                assert!(reason.contains("size mismatch"));
            }
            other => panic!("expected Validation, got {other:?}"),
        }
        let _ = std::fs::remove_dir_all(&tmp);
        let _ = std::fs::remove_dir_all(&target);
    }

    #[test]
    fn copies_multiple_tasks() {
        let tmp = unique_tmp("attmany");
        let db_path = tmp.join("src.sqlite");
        let conn = Connection::open(&db_path).unwrap();
        conn.execute_batch(
            "CREATE TABLE task_attachments (\
                id TEXT PRIMARY KEY, task_id TEXT, filename TEXT, mime_type TEXT, \
                size_bytes INTEGER NOT NULL, storage_path TEXT NOT NULL, \
                uploaded_at INTEGER, uploaded_by TEXT)",
        )
        .unwrap();
        let src_root = tmp.join("src");
        for (id, task, name, body) in [
            ("a1", "t1", "f.png", &b"abc"[..]),
            ("a2", "t1", "g.png", &b"defg"[..]),
            ("a3", "t2", "h.txt", &b"hi"[..]),
        ] {
            std::fs::create_dir_all(src_root.join(task)).unwrap();
            std::fs::write(src_root.join(format!("{task}/{name}")), body).unwrap();
            let size = i64::try_from(body.len()).unwrap();
            conn.execute(
                "INSERT INTO task_attachments VALUES (?1,?2,?3,'application/octet-stream',?4,?5,0,'t')",
                rusqlite::params![id, task, name, size, format!("{task}/{name}")],
            )
            .unwrap();
        }
        let target = unique_tmp("attmany-tgt");
        let out = copy_attachments(&conn, Some(&src_root), &target).unwrap();
        assert_eq!(out.copied, 3);
        assert_eq!(out.total_bytes, 9);
        let _ = std::fs::remove_dir_all(&tmp);
        let _ = std::fs::remove_dir_all(&target);
    }
}
