//! Data export / import IPC (Settings → Data).
//!
//! Thin mappers over [`catique_application::data::DataUseCase`]. The
//! frontend supplies an absolute path chosen via the native file dialog;
//! export writes a `VACUUM INTO` snapshot there, import validates + stages
//! the file for a swap on the next launch.

use catique_application::data::DataUseCase;
use catique_application::AppError;
use tauri::State;

use crate::state::AppState;

/// IPC: export the whole database to `dest_path` as a standalone
/// SQLite snapshot (`VACUUM INTO`).
///
/// # Errors
///
/// Forwards every error from `DataUseCase::export_database`.
#[tauri::command]
pub async fn export_database(
    state: State<'_, AppState>,
    dest_path: String,
) -> Result<(), AppError> {
    DataUseCase::new(&state.pool).export_database(&dest_path)
}

/// IPC: validate `src_path` and stage it for import. The swap is applied
/// at the next launch (the caller should prompt the user to restart).
///
/// # Errors
///
/// Forwards every error from `DataUseCase::stage_import`.
#[tauri::command]
pub async fn import_database(state: State<'_, AppState>, src_path: String) -> Result<(), AppError> {
    DataUseCase::new(&state.pool).stage_import(&src_path)
}
