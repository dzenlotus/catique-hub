//! `Attachment` — task-scoped file metadata. Mirrors `task_attachments`.

use serde::{Deserialize, Serialize};
use ts_rs::TS;

/// File metadata for an attachment on a [`crate::Task`]. The blob lives
/// at `<app_data_dir>/attachments/<task_id>/<storage_path>` (see
/// `catique-infrastructure::paths`); this struct holds metadata only.
#[derive(TS, Serialize, Deserialize, Clone, Debug, PartialEq, Eq)]
#[ts(export, export_to = "../../../bindings/", rename_all = "camelCase")]
#[serde(rename_all = "camelCase")]
pub struct Attachment {
    pub id: String,
    pub task_id: String,
    pub filename: String,
    pub mime_type: String,
    pub size_bytes: i64,
    pub storage_path: String,
    pub uploaded_at: i64,
    pub uploaded_by: Option<String>,
}
