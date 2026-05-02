//! `Task` — kanban card. Mirrors `tasks`.

use serde::{Deserialize, Serialize};
use ts_rs::TS;

/// A task / kanban card. Slugged (`<space-prefix>-<NN>`), cascades on
/// board/column delete. `position` is `f64` to allow gap-based reorders
/// without renumbering siblings.
///
/// `step_log` is an append-only, newline-separated buffer of
/// timestamped chain-of-thought lines emitted by the working cat (see
/// `application::tasks::TasksUseCase::log_step`). Its empty default
/// (`""`) means "no steps recorded yet" — Phase 1 of ctq-73 lands the
/// column; Phase 2 wires the UI surface.
#[derive(TS, Serialize, Deserialize, Clone, Debug, PartialEq)]
#[ts(export, export_to = "../../../bindings/", rename_all = "camelCase")]
#[serde(rename_all = "camelCase")]
pub struct Task {
    pub id: String,
    pub board_id: String,
    pub column_id: String,
    pub slug: String,
    pub title: String,
    pub description: Option<String>,
    pub position: f64,
    pub role_id: Option<String>,
    pub created_at: i64,
    pub updated_at: i64,
    /// Append-only newline-separated log of timestamped step summaries
    /// (`[YYYY-MM-DDTHH:MM:SSZ] {summary}\n`). Default `""`.
    pub step_log: String,
}
