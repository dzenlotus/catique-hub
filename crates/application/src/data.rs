//! Data export / import use case.
//!
//! * **Export** — `VACUUM INTO` produces a consistent, standalone copy
//!   of the live database without stopping the connection pool (the
//!   same idiom the release runbook uses for backups). The result is a
//!   plain `.sqlite` file the user can stash anywhere.
//!
//! * **Import** — replacing a live SQLite file under an open WAL pool is
//!   unsafe, so import is a two-phase operation: this use case validates
//!   the candidate file and *stages* it next to the DB. The actual swap
//!   happens at the next launch, before the pool opens, via
//!   [`catique_infrastructure::db::apply_pending_import`]. The current
//!   DB is backed up first so the swap is reversible.

use std::path::PathBuf;

use catique_infrastructure::db::pool::{acquire, Pool};
use catique_infrastructure::paths;
use rusqlite::OptionalExtension;

use crate::error::AppError;
use crate::error_map::map_db_err;

/// Data export / import use case.
pub struct DataUseCase<'a> {
    pool: &'a Pool,
}

impl<'a> DataUseCase<'a> {
    #[must_use]
    pub fn new(pool: &'a Pool) -> Self {
        Self { pool }
    }

    /// Export the whole database to `dest` as a standalone SQLite file
    /// via `VACUUM INTO`. Overwrites `dest` if it already exists
    /// (`VACUUM INTO` itself refuses a pre-existing target).
    ///
    /// # Errors
    ///
    /// * `AppError::Validation` when `dest` can't be written.
    /// * Storage-layer errors from the `VACUUM INTO` statement.
    pub fn export_database(&self, dest: &str) -> Result<(), AppError> {
        let dest_path = PathBuf::from(dest);
        if dest_path.exists() {
            std::fs::remove_file(&dest_path).map_err(|e| AppError::Validation {
                field: "dest".into(),
                reason: format!("cannot overwrite existing file: {e}"),
            })?;
        }
        let conn = acquire(self.pool).map_err(map_db_err)?;
        // `VACUUM INTO` takes a path literal/bind; rusqlite binds it as a
        // parameter cleanly. No user SQL is interpolated.
        conn.execute(
            "VACUUM INTO ?1",
            rusqlite::params![dest_path.to_string_lossy().to_string()],
        )
        .map_err(|e| map_db_err(e.into()))?;
        Ok(())
    }

    /// Validate `src` as a Catique database and stage it for import on
    /// the next launch. Does **not** touch the live DB — the swap (with
    /// a pre-import backup) is performed by
    /// [`catique_infrastructure::db::apply_pending_import`] at startup.
    ///
    /// # Errors
    ///
    /// * `AppError::Validation` when `src` is missing, unreadable, or not
    ///   a Catique database (no `_migrations` table).
    /// * `AppError::Validation` when the staging copy fails.
    pub fn stage_import(&self, src: &str) -> Result<(), AppError> {
        let src_path = PathBuf::from(src);

        // Validate: openable, read-only, and carries our migration ledger
        // so we don't clobber the live DB with an arbitrary SQLite file.
        {
            let conn = rusqlite::Connection::open_with_flags(
                &src_path,
                rusqlite::OpenFlags::SQLITE_OPEN_READ_ONLY,
            )
            .map_err(|e| AppError::Validation {
                field: "src".into(),
                reason: format!("not a readable SQLite database: {e}"),
            })?;
            let has_ledger: Option<i64> = conn
                .query_row(
                    "SELECT 1 FROM sqlite_master \
                     WHERE type = 'table' AND name = '_migrations'",
                    [],
                    |row| row.get(0),
                )
                .optional()
                .map_err(|e| map_db_err(e.into()))?;
            if has_ledger.is_none() {
                return Err(AppError::Validation {
                    field: "src".into(),
                    reason: "file is not a Catique database (no migration ledger)".into(),
                });
            }
        }

        let pending = paths::pending_import_path().map_err(|e| AppError::Validation {
            field: "src".into(),
            reason: format!("cannot resolve data dir: {e}"),
        })?;
        std::fs::copy(&src_path, &pending).map_err(|e| AppError::Validation {
            field: "src".into(),
            reason: format!("cannot stage import file: {e}"),
        })?;
        Ok(())
    }
}
