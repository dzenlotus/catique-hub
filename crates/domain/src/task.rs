//! `Task` — kanban card. Mirrors `tasks`.

use serde::{Deserialize, Serialize};
use ts_rs::TS;

/// Task classification (catique). Pinned to the SQL
/// `CHECK (kind IN ('blank','feature','bug','research'))` set so a bad
/// value can never reach the DB and a tampered row can never deserialise
/// into an out-of-range variant. `Blank` is the default for an untyped
/// card.
#[derive(TS, Serialize, Deserialize, Clone, Copy, Debug, PartialEq, Eq, Default)]
#[ts(export, export_to = "../../../bindings/", rename_all = "lowercase")]
#[serde(rename_all = "lowercase")]
pub enum TaskKind {
    /// Untyped card (default).
    #[default]
    Blank,
    Feature,
    Bug,
    Research,
}

impl TaskKind {
    /// Lowercase wire/storage string (matches the SQL `CHECK` set).
    #[must_use]
    pub fn as_str(self) -> &'static str {
        match self {
            TaskKind::Blank => "blank",
            TaskKind::Feature => "feature",
            TaskKind::Bug => "bug",
            TaskKind::Research => "research",
        }
    }

    /// Parse a stored string, falling back to [`TaskKind::Blank`] for any
    /// unknown / legacy value so a tampered or pre-migration row never
    /// fails to load.
    #[must_use]
    pub fn parse(s: &str) -> Self {
        match s {
            "feature" => TaskKind::Feature,
            "bug" => TaskKind::Bug,
            "research" => TaskKind::Research,
            _ => TaskKind::Blank,
        }
    }
}

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
    /// Classification of the card. Defaults to [`TaskKind::Blank`] for
    /// rows that predate the `kind` column (migration `044`).
    #[serde(default)]
    pub kind: TaskKind,
    pub position: f64,
    pub role_id: Option<String>,
    pub created_at: i64,
    pub updated_at: i64,
    /// Append-only newline-separated log of timestamped step summaries
    /// (`[YYYY-MM-DDTHH:MM:SSZ] {summary}\n`). Default `""`.
    pub step_log: String,
    /// Denormalised effective-context counters (refactor-v3 D-B). The
    /// kanban card surface reads these directly so a 50-card board open
    /// stays one SELECT instead of `N × resolve_task_bundle`. Maintained
    /// by application-layer hooks at every mutation that touches
    /// `task_prompts` / `task_skills` / `task_mcp_tools` or any
    /// `task_*_overrides_v2` row.
    ///
    /// Formula per kind: `COUNT(task_<kind>) - COUNT(suppress-only
    /// overrides for <kind>)`. Replace-overrides preserve cardinality
    /// (one row in, one row out) so they do not enter the formula. See
    /// `docs/refactor-v3/decisions/D-B-effective-counter-denormalization.md`.
    ///
    /// `#[serde(default)]` keeps the wire shape forward-compatible: a
    /// persisted JSON payload predating D-B can still deserialise into
    /// the new struct (missing fields fall through to `0`).
    #[serde(default)]
    pub effective_prompt_count: i64,
    #[serde(default)]
    pub effective_skill_count: i64,
    #[serde(default)]
    pub effective_tool_count: i64,
}
