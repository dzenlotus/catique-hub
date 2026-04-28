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
use catique_domain::SearchResult;
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
