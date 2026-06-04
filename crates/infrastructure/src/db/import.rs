//! Startup-phase database import swap.
//!
//! Settings → Data → "Import" stages a candidate database at
//! [`crate::paths::pending_import_path`] (validated by the application
//! layer). Swapping it in while the r2d2 pool holds the live DB open
//! under WAL is unsafe, so the swap is deferred to the next launch and
//! performed here, *before* [`crate::db::open_pool`] runs.
//!
//! The swap is reversible: the outgoing DB is moved to
//! [`crate::paths::pre_import_backup_path`] before the staged file takes
//! its place. Stale `-wal` / `-shm` sidecars are removed so SQLite never
//! tries to replay the old write-ahead log against the new file.

use std::fs;
use std::path::Path;

use crate::paths;

/// Apply a staged import if one is present. Returns `Ok(true)` when a
/// swap happened, `Ok(false)` when there was nothing to do.
///
/// Must run before any connection to the primary DB is opened.
///
/// # Errors
///
/// Surfaces filesystem errors (rename / remove / resolve-path).
pub fn apply_pending_import() -> Result<bool, String> {
    let pending = paths::pending_import_path()?;
    if !pending.exists() {
        return Ok(false);
    }
    let db = paths::db_path()?;
    let backup = paths::pre_import_backup_path()?;

    // Move the current DB aside as the reversible backup (overwrite any
    // previous backup) and drop its WAL sidecars so the new file isn't
    // paired with a stale log.
    if db.exists() {
        if backup.exists() {
            fs::remove_file(&backup).map_err(|e| format!("remove old backup: {e}"))?;
        }
        fs::rename(&db, &backup).map_err(|e| format!("back up current db: {e}"))?;
    }
    remove_if_present(&with_suffix(&db, "-wal"))?;
    remove_if_present(&with_suffix(&db, "-shm"))?;

    fs::rename(&pending, &db).map_err(|e| format!("swap in imported db: {e}"))?;
    Ok(true)
}

fn with_suffix(path: &Path, suffix: &str) -> std::path::PathBuf {
    let mut s = path.as_os_str().to_owned();
    s.push(suffix);
    std::path::PathBuf::from(s)
}

fn remove_if_present(path: &Path) -> Result<(), String> {
    if path.exists() {
        fs::remove_file(path).map_err(|e| format!("remove {}: {e}", path.display()))?;
    }
    Ok(())
}
