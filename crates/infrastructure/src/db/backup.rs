//! Automatic recovery snapshots.
//!
//! On every launch the shell takes a `VACUUM INTO` snapshot of the DB
//! *before* this run applies any pending migration — a consistent
//! recovery point captured while the file is otherwise quiescent. We
//! keep the newest [`KEEP_BACKUPS`] and prune the rest, so the folder
//! never grows unbounded.
//!
//! Recovery itself reuses the existing import path: the user picks any
//! `catique-*.sqlite` here via Settings → Data → Import and it is
//! swapped in on the next launch (see [`super::import`]).

use std::fs;
use std::path::{Path, PathBuf};
use std::time::{SystemTime, UNIX_EPOCH};

use rusqlite::params;

use super::pool::{acquire, Pool};
use crate::paths;

/// How many launch snapshots to retain.
pub const KEEP_BACKUPS: usize = 7;

const PREFIX: &str = "catique-";
const SUFFIX: &str = ".sqlite";

/// Take a retained launch snapshot of the live DB into the backups dir.
/// Best-effort: returns the snapshot path on success.
///
/// # Errors
///
/// Returns a human-readable string on any filesystem / SQLite failure so
/// the caller can log-and-continue without aborting startup.
pub fn write_launch_backup(pool: &Pool) -> Result<PathBuf, String> {
    let dir = paths::backups_dir()?;
    fs::create_dir_all(&dir).map_err(|e| format!("create backups dir: {e}"))?;

    let stamp = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_millis())
        .unwrap_or(0);
    let dest = dir.join(format!("{PREFIX}{stamp}{SUFFIX}"));

    let conn = acquire(pool).map_err(|e| format!("acquire connection: {e}"))?;
    // `VACUUM INTO` refuses a pre-existing target; the millisecond stamp
    // makes a clash astronomically unlikely, but guard anyway.
    if dest.exists() {
        fs::remove_file(&dest).map_err(|e| format!("clear stale snapshot: {e}"))?;
    }
    conn.execute(
        "VACUUM INTO ?1",
        params![dest.to_string_lossy().to_string()],
    )
    .map_err(|e| format!("vacuum into snapshot: {e}"))?;

    prune(&dir, KEEP_BACKUPS);
    Ok(dest)
}

/// Keep the `keep` newest `catique-*.sqlite` snapshots, delete the rest.
/// Newest-first by the millisecond stamp embedded in the filename.
fn prune(dir: &Path, keep: usize) {
    let Ok(entries) = fs::read_dir(dir) else {
        return;
    };
    let mut snaps: Vec<PathBuf> = entries
        .flatten()
        .map(|e| e.path())
        .filter(|p| {
            p.file_name()
                .and_then(|n| n.to_str())
                .is_some_and(|n| n.starts_with(PREFIX) && n.ends_with(SUFFIX))
        })
        .collect();
    if snaps.len() <= keep {
        return;
    }
    // Lexical sort works because the stamp is fixed-width-ish epoch ms;
    // newest sorts last, so drop everything before the tail `keep`.
    snaps.sort();
    let drop_count = snaps.len() - keep;
    for stale in snaps.into_iter().take(drop_count) {
        let _ = fs::remove_file(stale);
    }
}
