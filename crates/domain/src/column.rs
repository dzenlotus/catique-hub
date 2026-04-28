//! `Column` — vertical lane on a [`crate::Board`]. Mirrors `columns`.

use serde::{Deserialize, Serialize};
use ts_rs::TS;

/// A column on a board. Holds tasks via FK on `tasks.column_id`.
/// Position is integer (per Promptery v0.4 — columns reorder less often
/// than tasks, so a dense integer ordering suffices).
#[derive(TS, Serialize, Deserialize, Clone, Debug, PartialEq, Eq)]
#[ts(export, export_to = "../../../bindings/", rename_all = "camelCase")]
#[serde(rename_all = "camelCase")]
pub struct Column {
    pub id: String,
    pub board_id: String,
    pub name: String,
    pub position: i64,
    pub role_id: Option<String>,
    pub created_at: i64,
}
