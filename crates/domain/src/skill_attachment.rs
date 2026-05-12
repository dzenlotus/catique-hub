//! `SkillAttachment` — per-skill blob or git-URL reference.
//!
//! Mirrors `skill_attachments` (migration `025_skill_attachments.sql`).
//! Two kinds in one table, discriminated by [`SkillAttachmentKind`]:
//!
//! * [`SkillAttachmentKind::File`] — on-disk blob under
//!   `<app_data_dir>/skills/<skill_id>/<storage_path>`. `filename`,
//!   `mime_type`, `size_bytes`, `storage_path` populated; git fields NULL.
//! * [`SkillAttachmentKind::Git`] — repository reference; `git_url`
//!   populated (with optional `git_ref` / `git_path`). File fields NULL.
//!
//! The CHECK constraint in the migration enforces this split at the
//! storage layer; the renderer (a parallel agent's responsibility) reads
//! these rows and emits the appropriate XML for the role file.

use serde::{Deserialize, Serialize};
use ts_rs::TS;

/// Discriminator for the two attachment shapes a skill can carry.
#[derive(TS, Serialize, Deserialize, Clone, Copy, Debug, PartialEq, Eq)]
#[ts(export, export_to = "../../../bindings/", rename_all = "lowercase")]
#[serde(rename_all = "lowercase")]
pub enum SkillAttachmentKind {
    /// On-disk blob: see `<app_data_dir>/skills/<skill_id>/<storage_path>`.
    File,
    /// Git repository reference (metadata only — no clone happens here).
    Git,
}

/// One attachment row for a [`crate::Skill`]. Fields are tagged
/// `Option<_>` because they're only populated for the matching `kind`;
/// callers should branch on `kind` before reading.
#[derive(TS, Serialize, Deserialize, Clone, Debug, PartialEq, Eq)]
#[ts(export, export_to = "../../../bindings/", rename_all = "camelCase")]
#[serde(rename_all = "camelCase")]
pub struct SkillAttachment {
    pub id: String,
    pub skill_id: String,
    pub kind: SkillAttachmentKind,
    pub filename: Option<String>,
    pub mime_type: Option<String>,
    pub size_bytes: Option<i64>,
    pub storage_path: Option<String>,
    pub git_url: Option<String>,
    pub git_ref: Option<String>,
    pub git_path: Option<String>,
    pub created_at: i64,
}
