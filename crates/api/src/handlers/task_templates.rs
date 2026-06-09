//! `task_templates` domain handlers (catique-1).
//!
//! Tauri IPC for the task-template list (markdown skeletons picked when
//! creating a task). Standard CRUD.
//!
//! Events emitted: `task_template:created` / `task_template:updated` /
//! `task_template:deleted`. Payload `{ id }`.

use catique_application::{task_templates::TaskTemplatesUseCase, AppError};
use catique_domain::{TaskTemplate, TaskTemplateKind};
use serde_json::json;
use tauri::State;

use crate::events;
use crate::state::AppState;

/// E2-style empty marker; real registration is the
/// `tauri::generate_handler!` list in `src-tauri/src/lib.rs`.
pub fn register() {}

/// IPC: list every template.
///
/// # Errors
///
/// Forwards every error from [`TaskTemplatesUseCase::list`].
#[tauri::command]
pub async fn list_task_templates(
    state: State<'_, AppState>,
) -> Result<Vec<TaskTemplate>, AppError> {
    TaskTemplatesUseCase::new(&state.pool).list()
}

/// IPC: lookup by id.
///
/// # Errors
///
/// `AppError::NotFound` if id is unknown.
#[tauri::command]
pub async fn get_task_template(
    state: State<'_, AppState>,
    id: String,
) -> Result<TaskTemplate, AppError> {
    TaskTemplatesUseCase::new(&state.pool).get(&id)
}

/// IPC: create one template.
///
/// # Errors
///
/// Forwards every error from [`TaskTemplatesUseCase::create`].
#[tauri::command]
pub async fn create_task_template(
    state: State<'_, AppState>,
    name: String,
    kind: TaskTemplateKind,
    description: String,
    body: String,
    icon: Option<String>,
    color: Option<String>,
) -> Result<TaskTemplate, AppError> {
    let tmpl = TaskTemplatesUseCase::new(&state.pool).create(
        name,
        kind,
        description,
        body,
        icon,
        color,
    )?;
    events::emit(
        &state,
        events::TASK_TEMPLATE_CREATED,
        json!({ "id": tmpl.id }),
    );
    Ok(tmpl)
}

/// IPC: partial update.
///
/// # Errors
///
/// Forwards every error from [`TaskTemplatesUseCase::update`].
#[tauri::command]
#[allow(clippy::too_many_arguments)]
pub async fn update_task_template(
    state: State<'_, AppState>,
    id: String,
    name: Option<String>,
    kind: Option<TaskTemplateKind>,
    description: Option<String>,
    body: Option<String>,
    icon: Option<String>,
    color: Option<String>,
    position: Option<f64>,
) -> Result<TaskTemplate, AppError> {
    let tmpl = TaskTemplatesUseCase::new(&state.pool).update(
        &id,
        name,
        kind,
        description,
        body,
        icon,
        color,
        position,
    )?;
    events::emit(
        &state,
        events::TASK_TEMPLATE_UPDATED,
        json!({ "id": tmpl.id }),
    );
    Ok(tmpl)
}

/// IPC: delete one template.
///
/// # Errors
///
/// Forwards every error from [`TaskTemplatesUseCase::delete`].
#[tauri::command]
pub async fn delete_task_template(state: State<'_, AppState>, id: String) -> Result<(), AppError> {
    TaskTemplatesUseCase::new(&state.pool).delete(&id)?;
    events::emit(&state, events::TASK_TEMPLATE_DELETED, json!({ "id": id }));
    Ok(())
}
