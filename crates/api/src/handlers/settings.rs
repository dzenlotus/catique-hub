//! `settings` domain handlers (`get_setting`, `set_setting`, `ping`).
//!
//! ctq-96 (audit F-12): expose the generic key/value store backing
//! shell-level toggles such as `cat_migration_reviewed` and
//! `selected_space`. The use case lives in `catique_application::settings`;
//! the handler does pure mapping.

use catique_application::{settings::SettingsUseCase, AppError};
use tauri::State;

use crate::state::AppState;

/// E2 will populate per-domain initialisation here (e.g. preload the
/// `settings` table cache).
pub fn register() {}

/// IPC smoke-test. Returns a fixed string so the Tauri shell can verify
/// the handler is reachable from JS without any DB / FS dependency.
#[tauri::command]
#[must_use]
pub fn ping() -> &'static str {
    "catique-hub: alive"
}

/// IPC: read a single setting by key. `Ok(None)` for absent keys; the
/// caller decides the default. Empty-string values are returned verbatim.
///
/// # Errors
///
/// Forwards every error from `SettingsUseCase::get_setting`.
#[tauri::command]
pub async fn get_setting(
    state: State<'_, AppState>,
    key: String,
) -> Result<Option<String>, AppError> {
    SettingsUseCase::new(&state.pool).get_setting(&key)
}

/// IPC: write (UPSERT) a single setting. `updated_at` is refreshed on
/// every call.
///
/// # Errors
///
/// Forwards every error from `SettingsUseCase::set_setting`.
#[tauri::command]
pub async fn set_setting(
    state: State<'_, AppState>,
    key: String,
    value: String,
) -> Result<(), AppError> {
    SettingsUseCase::new(&state.pool).set_setting(&key, &value)
}
