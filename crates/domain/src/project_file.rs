//! `ProjectFile` — an agent instruction file living in a project's
//! on-disk folder (catique-2, disk-backed rewrite).
//!
//! The original `space_files` feature stored named markdown documents in
//! SQLite, disconnected from the filesystem and from the connected
//! providers. This replaces it with a **disk-backed** model: a
//! ProjectFile is a real file under `space.project_folder_path`.
//!
//! Connected providers declare which filenames they read as agent
//! instruction files (e.g. Claude Code → `CLAUDE.md`, Codex / OpenCode →
//! `AGENTS.md`). The project settings page auto-lists those names — with
//! their on-disk content when present — plus any other root-level
//! `*.md` file in the project folder. Editing or creating a file writes
//! straight back to disk, so the agents and the owner share one source
//! of truth.

use serde::{Deserialize, Serialize};
use ts_rs::TS;

/// One agent-instruction markdown file under a project's folder.
#[derive(TS, Serialize, Deserialize, Clone, Debug, PartialEq, Eq)]
#[ts(export, export_to = "../../../bindings/", rename_all = "camelCase")]
#[serde(rename_all = "camelCase")]
pub struct ProjectFile {
    /// Filename relative to the project folder root (e.g. `AGENTS.md`).
    /// Always a single path segment — never contains a separator.
    pub name: String,
    /// Current on-disk content. Empty string when the file does not yet
    /// exist — a provider-expected name is still listed so the owner can
    /// create it from the editor.
    pub content: String,
    /// `true` when the file currently exists on disk.
    pub exists: bool,
    /// Connected-provider ids that declare this filename as an agent
    /// instruction file. Empty for user-created / foreign markdown.
    pub expected_by: Vec<String>,
    /// File mtime in epoch milliseconds, or `0` when the file does not
    /// exist.
    pub updated_at: i64,
}
