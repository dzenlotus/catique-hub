//! Platform-conventional paths for Catique HUB on-disk state.
//!
//! Per D-018 (filesystem-layout decision) all user-mutable state lives
//! under a single root: `$APPLOCALDATA/catique/`. On macOS that resolves
//! to `~/Library/Application Support/catique/`; on Windows to
//! `%LOCALAPPDATA%\catique\`; on Linux to `$XDG_DATA_HOME/catique/`
//! (typically `~/.local/share/catique/`).
//!
//! Layout under that root (Wave-E1 placeholder; final layout in E2):
//!
//! ```text
//! catique/
//! ├── catique.db          # SQLite primary store
//! ├── catique.db-wal      # WAL sidecar
//! ├── catique.db-shm
//! ├── attachments/
//! │   └── <task_id>/<storage_path>
//! └── logs/
//!     └── catique-<date>.log
//! ```

use std::path::PathBuf;

/// Returns the root data directory for Catique HUB.
///
/// # Errors
///
/// Returns `Err` with a human-readable reason if the platform's
/// `data_local_dir` cannot be resolved (e.g. `$HOME` unset on Linux,
/// `%LOCALAPPDATA%` missing on Windows). The caller decides whether to
/// fall back to a temp directory or surface the error to the UI.
pub fn app_data_dir() -> Result<PathBuf, &'static str> {
    let base = dirs::data_local_dir()
        .ok_or("platform data-local dir is unavailable; check $HOME / %LOCALAPPDATA%")?;
    Ok(base.join("catique"))
}
