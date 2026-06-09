//! `AgentReport` — typed, FTS-indexed artefact attached to a [`crate::Task`].

use serde::{Deserialize, Serialize};
use ts_rs::TS;

/// Report classification. Replaces the previous free-form `kind` string
/// with a fixed set the UI groups + filters by. `Review` and `Approval`
/// are the human-in-the-loop flavours: an `Approval` report is one the
/// agent wants a person to sign off on via the `approved` checkbox.
///
/// Validated at the application layer (the `agent_reports.kind` column
/// stays free-form TEXT for backward-compat); unknown legacy strings map
/// to [`AgentReportKind::Summary`] when loaded so old rows keep working.
#[derive(TS, Serialize, Deserialize, Clone, Copy, Debug, PartialEq, Eq, Default)]
#[ts(export, export_to = "../../../bindings/", rename_all = "lowercase")]
#[serde(rename_all = "lowercase")]
pub enum AgentReportKind {
    Investigation,
    Plan,
    #[default]
    Summary,
    Review,
    /// Needs a human to review and tick `approved`, or leave a
    /// `review_comment` requesting corrections.
    Approval,
}

impl AgentReportKind {
    /// Lowercase wire/storage string (matches the SQL `CHECK` set).
    #[must_use]
    pub fn as_str(self) -> &'static str {
        match self {
            AgentReportKind::Investigation => "investigation",
            AgentReportKind::Plan => "plan",
            AgentReportKind::Summary => "summary",
            AgentReportKind::Review => "review",
            AgentReportKind::Approval => "approval",
        }
    }

    /// Parse a stored string, falling back to [`AgentReportKind::Summary`]
    /// for unknown / legacy values so old free-form rows keep loading.
    #[must_use]
    pub fn parse(s: &str) -> Self {
        match s {
            "investigation" => AgentReportKind::Investigation,
            "plan" => AgentReportKind::Plan,
            "review" => AgentReportKind::Review,
            "approval" => AgentReportKind::Approval,
            _ => AgentReportKind::Summary,
        }
    }
}

/// An agent's investigation / plan / summary / review / approval. Lives
/// in `agent_reports` + mirrored into `agent_reports_fts` (FTS5) for
/// cross-task search.
#[derive(TS, Serialize, Deserialize, Clone, Debug, PartialEq, Eq)]
#[ts(export, export_to = "../../../bindings/", rename_all = "camelCase")]
#[serde(rename_all = "camelCase")]
pub struct AgentReport {
    pub id: String,
    pub task_id: String,
    pub kind: AgentReportKind,
    pub title: String,
    pub content: String,
    pub author: Option<String>,
    /// Human sign-off checkbox: `true` once a person reviewed and
    /// approved the report. Default `false` (migration `045`).
    #[serde(default)]
    pub approved: bool,
    /// Optional reviewer note — corrections to make, or context for the
    /// approval. `None` when no comment was left.
    #[serde(default)]
    pub review_comment: Option<String>,
    pub created_at: i64,
    pub updated_at: i64,
}
