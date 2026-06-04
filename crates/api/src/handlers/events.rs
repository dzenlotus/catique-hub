//! Activity-log IPC handlers — Project Map v3.
//!
//! Reads from the `change_events` table extended in refactor-v3 D-D
//! (migration 035) to become a durable per-scope activity log. The
//! handler list:
//!
//!   * [`list_recent_events`] — global feed (debug / "All activity").
//!   * [`list_recent_events_by_scope`] — per-space / per-board /
//!     per-task / per-role / per-prompt / per-skill feed. Drives the
//!     SpaceDetailPage activity log section in v3.

use catique_application::AppError;
use catique_infrastructure::db::event_log;
use catique_infrastructure::db::pool::acquire;
use serde::Serialize;
use tauri::State;
use ts_rs::TS;

use crate::state::AppState;

/// Hard ceiling applied to the `limit` argument on every read handler.
/// 100 is generous against the UI's 20-row default; defends against an
/// accidental `limit = 1_000_000` from a typo'd caller.
const MAX_LIMIT: usize = 100;

/// One activity-log row surfaced to the UI.
///
/// `scopeKind` / `scopeId` / `count` come from the D-D extension
/// (migration 035). Pre-D-D rows backfill as `scope_kind = "global"`,
/// `scope_id = NULL`, `count = 1` via the migration defaults — every
/// field is always populated on read.
#[derive(Debug, Serialize, TS)]
#[ts(export, export_to = "../../../bindings/", rename_all = "camelCase")]
#[serde(rename_all = "camelCase")]
pub struct ActivityEvent {
    /// Monotonic sequence id assigned by SQLite. Stable across the
    /// lifetime of the row; not reused after purge.
    pub seq: i64,
    /// `<domain>:<verb>` event name as emitted by the application
    /// layer (e.g. `"task:created"`).
    pub name: String,
    /// JSON-serialised payload — the same shape the realtime emit
    /// broadcasted on the Tauri channel.
    pub payload_json: String,
    /// D-D scope discriminator. One of:
    /// `"global" | "space" | "board" | "column" | "task" | "role" |
    /// "prompt" | "skill" | "mcp_server" | "tag" | "prompt_group"`.
    pub scope_kind: String,
    /// Entity id matching `scope_kind`. `null` for `scope_kind == "global"`.
    pub scope_id: Option<String>,
    /// Tier-3 compaction counter. `1` for non-compacted rows; higher
    /// values mean the row absorbed N back-to-back same-scope edits
    /// inside the 5-minute window (D-D §Compaction).
    pub count: i64,
}

impl From<event_log::ChangeEvent> for ActivityEvent {
    fn from(row: event_log::ChangeEvent) -> Self {
        Self {
            seq: row.seq,
            name: row.name,
            payload_json: row.payload.to_string(),
            scope_kind: row.scope_kind,
            scope_id: row.scope_id,
            count: row.count,
        }
    }
}

/// IPC: return the most recent `limit` activity events globally,
/// newest first.
///
/// Caps `limit` at [`MAX_LIMIT`]. Empty results are normal — the table
/// is bounded per D-D's 90-day retention; a fresh install will have
/// nothing on disk.
///
/// # Errors
///
/// Returns `AppError::TransactionRolledBack` mapped from rusqlite errors.
#[tauri::command]
pub async fn list_recent_events(
    state: State<'_, AppState>,
    limit: Option<usize>,
) -> Result<Vec<ActivityEvent>, AppError> {
    let conn = acquire(&state.pool).map_err(map_db)?;
    let cap = limit.unwrap_or(20).min(MAX_LIMIT);
    let rows =
        event_log::recent_events(&conn, cap).map_err(|err| AppError::TransactionRolledBack {
            reason: err.to_string(),
        })?;
    Ok(rows.into_iter().map(ActivityEvent::from).collect())
}

/// IPC: return the most recent `limit` activity events restricted to
/// `(scope_kind, scope_id)`, newest first.
///
/// `scope_id` is optional because `scope_kind = "global"` rows carry a
/// NULL id by design — `None` filters to those; `Some(...)` filters to
/// that exact entity. See
/// [`event_log::recent_events_by_scope`] for the SQL contract.
///
/// # Errors
///
/// Returns `AppError::TransactionRolledBack` mapped from rusqlite errors.
#[tauri::command]
pub async fn list_recent_events_by_scope(
    state: State<'_, AppState>,
    scope_kind: String,
    scope_id: Option<String>,
    limit: Option<usize>,
) -> Result<Vec<ActivityEvent>, AppError> {
    let conn = acquire(&state.pool).map_err(map_db)?;
    let cap = limit.unwrap_or(20).min(MAX_LIMIT);
    let rows = event_log::recent_events_by_scope(&conn, &scope_kind, scope_id.as_deref(), cap)
        .map_err(|err| AppError::TransactionRolledBack {
            reason: err.to_string(),
        })?;
    Ok(rows.into_iter().map(ActivityEvent::from).collect())
}

fn map_db(err: catique_infrastructure::db::pool::DbError) -> AppError {
    use catique_infrastructure::db::pool::DbError;
    match err {
        DbError::PoolTimeout(_) | DbError::Pool(_) => AppError::DbBusy,
        DbError::Sqlite(e) => AppError::TransactionRolledBack {
            reason: e.to_string(),
        },
        DbError::Io(e) => AppError::TransactionRolledBack {
            reason: e.to_string(),
        },
    }
}
