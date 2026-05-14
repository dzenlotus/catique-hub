//! Search IPC handlers.
//!
//! Three commands expose the FTS5 indexes to the frontend:
//!   * `search_tasks`          — tasks only
//!   * `search_agent_reports`  — agent reports only
//!   * `search_all`            — both, concatenated (tasks first)
//!
//! All handlers are thin: they acquire the use case, forward arguments,
//! and return. No business logic lives here.

use catique_application::{search::SearchUseCase, AppError};
use catique_domain::{SearchResult, TaskMatch};
use tauri::State;

use crate::state::AppState;

/// IPC: full-text search across tasks.
///
/// An empty `query` returns an empty array. `limit` defaults to 50,
/// capped at 200.
///
/// # Errors
///
/// Forwards every error from `SearchUseCase::search_tasks`.
#[tauri::command]
pub async fn search_tasks(
    state: State<'_, AppState>,
    query: String,
    limit: Option<i64>,
) -> Result<Vec<SearchResult>, AppError> {
    SearchUseCase::new(&state.pool).search_tasks(query, limit)
}

/// IPC: full-text search across agent reports.
///
/// An empty `query` returns an empty array. `limit` defaults to 50,
/// capped at 200.
///
/// # Errors
///
/// Forwards every error from `SearchUseCase::search_agent_reports`.
#[tauri::command]
pub async fn search_agent_reports(
    state: State<'_, AppState>,
    query: String,
    limit: Option<i64>,
) -> Result<Vec<SearchResult>, AppError> {
    SearchUseCase::new(&state.pool).search_agent_reports(query, limit)
}

/// IPC: full-text search across all indexed entities.
///
/// Returns tasks followed by agent reports. An empty `query` returns an
/// empty array. `limit_per_kind` caps each slice independently;
/// defaults to 50 each.
///
/// # Errors
///
/// Forwards every error from `SearchUseCase::search_all`.
#[tauri::command]
pub async fn search_all(
    state: State<'_, AppState>,
    query: String,
    limit_per_kind: Option<i64>,
) -> Result<Vec<SearchResult>, AppError> {
    SearchUseCase::new(&state.pool).search_all(query, limit_per_kind)
}

/// IPC: cat-as-Agent Phase 1 search over tasks scoped to one
/// `(space_id, cat_id)` pair. ctq-84.
///
/// **MCP tool description** (kept here next to the handler so the
/// agent prompt stays in sync with the SQL contract): "Full-text
/// search over kanban tasks owned by `cat_id` inside `space_id`.
/// Returns up to 20 top-ranked matches (BM25), each with the task's
/// id, title, optional description, role_id, and an HTML-highlighted
/// snippet. Empty queries return no results. The cat scope is strict —
/// only tasks whose `role_id` is exactly `cat_id` are considered (no
/// column/board fallback)."
///
/// # Errors
///
/// Forwards every error from
/// `SearchUseCase::search_tasks_by_cat_and_space`.
#[tauri::command]
pub async fn search_tasks_by_cat_and_space(
    state: State<'_, AppState>,
    space_id: String,
    cat_id: String,
    query: String,
) -> Result<Vec<TaskMatch>, AppError> {
    SearchUseCase::new(&state.pool).search_tasks_by_cat_and_space(space_id, cat_id, query)
}
