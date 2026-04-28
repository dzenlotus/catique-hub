//! `reports` (agent reports) domain handlers.
//!
//! Wave-E2.4 (Olga). Five-command CRUD. FTS5 search use cases are
//! deferred to E3 — the schema's
//! `agent_reports_fts_*` triggers keep the FTS sibling table in sync
//! automatically.

use catique_application::{reports::ReportsUseCase, AppError};
use catique_domain::AgentReport;
use tauri::State;

use crate::state::AppState;

/// E2 will populate per-domain initialisation here.
pub fn register() {}

/// IPC: list every report (newest first).
///
/// # Errors
///
/// Forwards every error from `ReportsUseCase::list`.
#[tauri::command]
pub async fn list_agent_reports(state: State<'_, AppState>) -> Result<Vec<AgentReport>, AppError> {
    ReportsUseCase::new(&state.pool).list()
}

/// IPC: look up a report by id.
///
/// # Errors
///
/// Forwards every error from `ReportsUseCase::get`.
#[tauri::command]
pub async fn get_agent_report(
    state: State<'_, AppState>,
    id: String,
) -> Result<AgentReport, AppError> {
    ReportsUseCase::new(&state.pool).get(&id)
}

/// IPC: create a report.
///
/// # Errors
///
/// Forwards every error from `ReportsUseCase::create`.
#[tauri::command]
pub async fn create_agent_report(
    state: State<'_, AppState>,
    task_id: String,
    kind: String,
    title: String,
    content: String,
    author: Option<String>,
) -> Result<AgentReport, AppError> {
    ReportsUseCase::new(&state.pool).create(task_id, kind, title, content, author)
}

/// IPC: partial-update a report.
///
/// # Errors
///
/// Forwards every error from `ReportsUseCase::update`.
#[tauri::command]
pub async fn update_agent_report(
    state: State<'_, AppState>,
    id: String,
    kind: Option<String>,
    title: Option<String>,
    content: Option<String>,
    author: Option<Option<String>>,
) -> Result<AgentReport, AppError> {
    ReportsUseCase::new(&state.pool).update(id, kind, title, content, author)
}

/// IPC: delete a report.
///
/// # Errors
///
/// Forwards every error from `ReportsUseCase::delete`.
#[tauri::command]
pub async fn delete_agent_report(
    state: State<'_, AppState>,
    id: String,
) -> Result<(), AppError> {
    ReportsUseCase::new(&state.pool).delete(&id)
}
