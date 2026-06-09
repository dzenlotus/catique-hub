//! `TaskTemplate` — a named markdown skeleton for new tasks (catique-1).
//!
//! The user picks a template when creating a task; its `body` pre-fills
//! the new task's description so each kind (feature / bug / research)
//! starts from its own structured set of sections. Schema + built-in
//! seeds live in `043_task_templates.sql`; validation lives in
//! `application::task_templates`.

use serde::{Deserialize, Serialize};
use ts_rs::TS;

/// Template kind. Pinned to the SQL `CHECK` set; `custom` is the escape
/// hatch for user-authored templates.
#[derive(TS, Serialize, Deserialize, Clone, Copy, Debug, PartialEq, Eq)]
#[ts(export, export_to = "../../../bindings/", rename_all = "lowercase")]
#[serde(rename_all = "lowercase")]
pub enum TaskTemplateKind {
    Feature,
    Bug,
    Research,
    Custom,
}

/// One row of `task_templates`.
#[derive(TS, Serialize, Deserialize, Clone, Debug, PartialEq)]
#[ts(export, export_to = "../../../bindings/", rename_all = "camelCase")]
#[serde(rename_all = "camelCase")]
pub struct TaskTemplate {
    pub id: String,
    pub name: String,
    pub kind: TaskTemplateKind,
    /// Short helper shown next to the template in the picker.
    pub description: String,
    /// Markdown skeleton inserted into the new task's description.
    pub body: String,
    pub icon: Option<String>,
    pub color: Option<String>,
    pub position: f64,
    pub created_at: i64,
    pub updated_at: i64,
}
