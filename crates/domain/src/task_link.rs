//! `TaskLink` — minimal task↔task relationship (catique-4).
//!
//! The product ask was deliberately small: "let me pick a relation
//! between tasks, the model should be very simple". So the vocabulary is
//! a fixed three-kind set rather than a user-extensible relation type
//! table:
//!
//!   * `related` — symmetric in intent, stored asymmetric. The UI is
//!     free to render both directions identically.
//!   * `blocks`  — directional: `src` blocks `dst`.
//!   * `parent`  — directional: `src` is the parent of `dst`
//!     (i.e. `dst` is a sub-task of `src`).
//!
//! Schema + cardinality live in `029_task_links.sql`; the application
//! layer (`application::task_links`) owns validation and the kind
//! string ↔ enum mapping.

use serde::{Deserialize, Serialize};
use ts_rs::TS;

/// The relationship discriminator. Pinned to the exact set the SQL
/// `CHECK (kind IN ('related','blocks','parent'))` allows — keeping the
/// enum and the constraint in lock-step means a bad `kind` can never
/// reach the database (the use case rejects it first) *and* a tampered
/// row can never deserialise into an out-of-range variant.
#[derive(TS, Serialize, Deserialize, Clone, Copy, Debug, PartialEq, Eq)]
#[ts(export, export_to = "../../../bindings/", rename_all = "lowercase")]
#[serde(rename_all = "lowercase")]
pub enum TaskLinkKind {
    /// Symmetric "these two are related" link.
    Related,
    /// `src` blocks `dst`.
    Blocks,
    /// `src` is the parent of `dst` (`dst` is a sub-task of `src`).
    Parent,
}

/// One row of `task_links`. Direction is encoded by `(src, dst)`; the
/// caller decided it at link time. For `related` the direction is
/// cosmetic; for `blocks` / `parent` it is meaningful.
#[derive(TS, Serialize, Deserialize, Clone, Debug, PartialEq, Eq)]
#[ts(export, export_to = "../../../bindings/", rename_all = "camelCase")]
#[serde(rename_all = "camelCase")]
pub struct TaskLink {
    pub src_task_id: String,
    pub dst_task_id: String,
    pub kind: TaskLinkKind,
    pub created_at: i64,
}
