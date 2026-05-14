//! `RoleNote` — per-role retrospective memory entry (ctq-137).
//!
//! A role owns a personal store of self-authored notes. Each note carries
//! agent-invented tags (loaded by `recall_role_notes` via tag overlap),
//! an optional `source_task_id` linking back to the task that produced
//! the retrospective, and a small priority + pinned bias the agent /
//! user can use to influence recall ranking.
//!
//! Separation from [`crate::AgentReport`]: reports are per-task typed
//! artefacts the user reads (investigations, plans, summaries); notes
//! are per-role memory the agent consults across tasks. Different
//! surface, different lifetime — see migration `026_role_notes.sql` for
//! the schema-side argument.

use serde::{Deserialize, Serialize};
use ts_rs::TS;

/// Who wrote a note. The CHECK constraint on
/// `role_notes.authored_by` pins this to the exact `('agent','user')`
/// pair (`026_role_notes.sql`).
///
/// External MCP tools always insert with `Agent` (the agent surface is
/// agent-only); Tauri IPC accepts either because the user can also
/// curate notes from the Settings UI.
#[derive(TS, Serialize, Deserialize, Clone, Copy, Debug, PartialEq, Eq)]
#[ts(export, export_to = "../../../bindings/", rename_all = "lowercase")]
#[serde(rename_all = "lowercase")]
pub enum RoleNoteAuthor {
    Agent,
    User,
}

/// One row of the `role_notes` table joined with its tag list.
///
/// `tags` is the deduplicated set of normalised agent-invented tags
/// attached to the note via `role_note_tags`. The application layer
/// guarantees every tag value matches the kebab-case `[a-z0-9-]{1,32}`
/// regex — see `application::role_notes::normalise_tag`.
#[derive(TS, Serialize, Deserialize, Clone, Debug, PartialEq, Eq)]
#[ts(export, export_to = "../../../bindings/", rename_all = "camelCase")]
#[serde(rename_all = "camelCase")]
pub struct RoleNote {
    pub id: String,
    pub role_id: String,
    pub source_task_id: Option<String>,
    pub body: String,
    pub tags: Vec<String>,
    pub priority: i64,
    pub pinned: bool,
    pub authored_by: RoleNoteAuthor,
    pub created_at: i64,
    pub updated_at: i64,
}
