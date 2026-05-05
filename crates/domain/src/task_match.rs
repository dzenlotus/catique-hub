//! `TaskMatch` — narrow result row for the cat+space scoped FTS5 search
//! introduced by ctq-84.
//!
//! Distinct from [`crate::SearchResult::Task`] because the cat-scoped
//! query carries the `role_id` (a.k.a. `cat_id` after the agent →
//! cat rename) instead of `column_id`, plus a `description` slice the
//! card-preview UI uses without a follow-up `get_task` round-trip.
//! Snippet is populated by SQLite's `snippet()` function over the
//! `tasks_fts` virtual table.

use serde::{Deserialize, Serialize};
use ts_rs::TS;

/// One task hit from `search_tasks_by_cat_and_space`. Ordered by FTS5
/// BM25 rank in the parent query (lower = better).
#[derive(TS, Serialize, Deserialize, Clone, Debug, PartialEq, Eq)]
#[ts(export, export_to = "../../../bindings/", rename_all = "camelCase")]
#[serde(rename_all = "camelCase")]
pub struct TaskMatch {
    /// Stable task id.
    pub id: String,
    /// Title verbatim from `tasks.title`.
    pub title: String,
    /// `tasks.description` — `None` for tasks with NULL description.
    pub description: Option<String>,
    /// Owning cat id (the schema's `tasks.role_id`). `None` when the
    /// task does not have a cat assigned at the task level — the
    /// search-time JOIN does not chase the column/board fallback.
    pub role_id: Option<String>,
    /// FTS5 `snippet()` fragment over the `title` column with HTML
    /// highlighting (`<b>…</b>`).
    pub snippet: String,
}
