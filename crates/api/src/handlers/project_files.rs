//! `project_files` domain handlers (catique-2, disk-backed).
//!
//! Tauri IPC for the agent instruction markdown files that live in a
//! project's on-disk folder (`space.project_folder_path`). The Settings →
//! Project "Global files" card drives it.
//!
//! Events emitted: `project_file:changed` (create/overwrite) and
//! `project_file:deleted`. Payload `{ spaceId, name }` so the frontend
//! scopes its react-query invalidation by space.

use catique_application::{project_files::ProjectFilesUseCase, AppError};
use catique_domain::ProjectFile;
use serde_json::json;
use tauri::State;

use crate::events;
use crate::state::AppState;

/// E2-style empty marker; real registration is the
/// `tauri::generate_handler!` list in `src-tauri/src/lib.rs`.
pub fn register() {}

/// IPC: list every agent-instruction file for a space (provider-expected
/// names + on-disk markdown).
///
/// # Errors
///
/// Forwards every error from [`ProjectFilesUseCase::list`].
#[tauri::command]
pub async fn list_project_files(
    state: State<'_, AppState>,
    space_id: String,
) -> Result<Vec<ProjectFile>, AppError> {
    ProjectFilesUseCase::new(&state.pool).list(&space_id)
}

/// IPC: read one file by name.
///
/// # Errors
///
/// Forwards every error from [`ProjectFilesUseCase::read`].
#[tauri::command]
pub async fn read_project_file(
    state: State<'_, AppState>,
    space_id: String,
    name: String,
) -> Result<ProjectFile, AppError> {
    ProjectFilesUseCase::new(&state.pool).read(&space_id, &name)
}

/// IPC: create or overwrite a file on disk (atomic).
///
/// # Errors
///
/// Forwards every error from [`ProjectFilesUseCase::write`].
#[tauri::command]
pub async fn write_project_file(
    state: State<'_, AppState>,
    space_id: String,
    name: String,
    content: String,
) -> Result<ProjectFile, AppError> {
    let file = ProjectFilesUseCase::new(&state.pool).write(&space_id, &name, &content)?;
    events::emit(
        &state,
        events::PROJECT_FILE_CHANGED,
        json!({ "spaceId": space_id, "name": file.name }),
    );
    Ok(file)
}

/// IPC: delete one file by name.
///
/// # Errors
///
/// Forwards every error from [`ProjectFilesUseCase::delete`].
#[tauri::command]
pub async fn delete_project_file(
    state: State<'_, AppState>,
    space_id: String,
    name: String,
) -> Result<(), AppError> {
    ProjectFilesUseCase::new(&state.pool).delete(&space_id, &name)?;
    events::emit(
        &state,
        events::PROJECT_FILE_DELETED,
        json!({ "spaceId": space_id, "name": name }),
    );
    Ok(())
}
