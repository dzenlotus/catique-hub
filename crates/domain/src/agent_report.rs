//! `AgentReport` — typed, FTS-indexed artefact attached to a [`crate::Task`].

use serde::{Deserialize, Serialize};
use ts_rs::TS;

/// An agent's investigation / plan / summary / review. Lives in
/// `agent_reports` + mirrored into `agent_reports_fts` (FTS5) for
/// cross-task search. `kind` is a free-form discriminator — UI groups
/// by it (`investigation`, `plan`, `summary`, `review`, ...).
#[derive(TS, Serialize, Deserialize, Clone, Debug, PartialEq, Eq)]
#[ts(export, export_to = "../../../bindings/", rename_all = "camelCase")]
#[serde(rename_all = "camelCase")]
pub struct AgentReport {
    pub id: String,
    pub task_id: String,
    pub kind: String,
    pub title: String,
    pub content: String,
    pub author: Option<String>,
    pub created_at: i64,
    pub updated_at: i64,
}
