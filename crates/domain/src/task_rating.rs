//! `TaskRating` — Cat-as-Agent Phase 1 task quality signal.
//!
//! Memo of record: `docs/catique-migration/cat-as-agent-phase1-memo.md`
//! (Q4). Three states are presented in the UI (good / neutral / bad)
//! and stored as the signed integer `+1 / 0 / -1`. NULL is distinct
//! from `0`: NULL means "not yet rated"; `0` means "explicit-neutral —
//! evaluated and unremarkable." Both states are load-bearing for memory
//! weighting (Phase 2).

use serde::{Deserialize, Serialize};
use ts_rs::TS;

/// One row of `task_ratings` — at most one per task in Phase 1.
///
/// Phase 2 will widen the schema to `(task_id, cat_id)` so multiple
/// cats can each hold an opinion on the same task; the public shape
/// will gain a `cat_id` field at that point.
#[derive(TS, Serialize, Deserialize, Clone, Debug, PartialEq, Eq)]
#[ts(export, export_to = "../../../bindings/", rename_all = "camelCase")]
#[serde(rename_all = "camelCase")]
pub struct TaskRating {
    pub task_id: String,
    /// `Some(-1 | 0 | +1)` for an explicit rating. `None` means
    /// "row exists but rating is cleared" — a state the upsert layer
    /// produces when the user un-rates a task.
    pub rating: Option<i8>,
    /// Wall-clock unix-ms of the most recent set / clear call (UPSERT).
    pub rated_at: i64,
}
