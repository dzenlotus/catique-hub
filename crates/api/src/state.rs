//! Application state shared with every Tauri command.
//!
//! Tauri injects `tauri::State<'_, AppState>` into each
//! `#[tauri::command]` that requests it; the underlying value is
//! created once in the shell (`src-tauri/src/lib.rs`) and stored via
//! `tauri::Builder::manage`.
//!
//! Wave-E2 (Olga). Only the SQLite pool lives here so far. Future
//! waves add: secret-store handle, MCP-sidecar client, FTS reindex
//! channel.

use catique_infrastructure::db::pool::Pool;

/// Shared, send+sync state. r2d2's [`Pool`] is `Clone` (Arc-internal),
/// so cloning the wrapper is the cheap way to hand a pool reference to
/// a use-case constructor inside a handler.
#[derive(Clone)]
pub struct AppState {
    pub pool: Pool,
}

impl AppState {
    /// Construct from a pre-built pool. The shell layer is responsible
    /// for running migrations *before* wrapping it; this type makes no
    /// schema guarantees.
    #[must_use]
    pub fn new(pool: Pool) -> Self {
        Self { pool }
    }
}
