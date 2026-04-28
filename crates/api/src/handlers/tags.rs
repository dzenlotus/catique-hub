//! `tags` domain handlers.
//!
//! Wave-E2.4 (Olga). Five-command CRUD plus the `prompt_tags`
//! join-table helpers (`add_prompt_tag` / `remove_prompt_tag`).

use catique_application::{tags::TagsUseCase, AppError};
use catique_domain::Tag;
use catique_infrastructure::db::{pool::acquire, repositories::tags as repo};
use serde_json::json;
use tauri::State;

use crate::events;
use crate::state::AppState;

/// E2 will populate per-domain initialisation here.
pub fn register() {}

/// IPC: list every tag.
///
/// # Errors
///
/// Forwards every error from `TagsUseCase::list`.
#[tauri::command]
pub async fn list_tags(state: State<'_, AppState>) -> Result<Vec<Tag>, AppError> {
    TagsUseCase::new(&state.pool).list()
}

/// IPC: look up a tag by id.
///
/// # Errors
///
/// Forwards every error from `TagsUseCase::get`.
#[tauri::command]
pub async fn get_tag(state: State<'_, AppState>, id: String) -> Result<Tag, AppError> {
    TagsUseCase::new(&state.pool).get(&id)
}

/// IPC: create a tag.
///
/// # Errors
///
/// Forwards every error from `TagsUseCase::create`.
#[tauri::command]
pub async fn create_tag(
    state: State<'_, AppState>,
    name: String,
    color: Option<String>,
) -> Result<Tag, AppError> {
    let tag = TagsUseCase::new(&state.pool).create(name, color)?;
    events::emit(&state, events::TAG_CREATED, json!({ "id": tag.id }));
    Ok(tag)
}

/// IPC: partial-update a tag.
///
/// # Errors
///
/// Forwards every error from `TagsUseCase::update`.
#[tauri::command]
pub async fn update_tag(
    state: State<'_, AppState>,
    id: String,
    name: Option<String>,
    color: Option<Option<String>>,
) -> Result<Tag, AppError> {
    let tag = TagsUseCase::new(&state.pool).update(id, name, color)?;
    events::emit(&state, events::TAG_UPDATED, json!({ "id": tag.id }));
    Ok(tag)
}

/// IPC: delete a tag.
///
/// # Errors
///
/// Forwards every error from `TagsUseCase::delete`.
#[tauri::command]
pub async fn delete_tag(state: State<'_, AppState>, id: String) -> Result<(), AppError> {
    TagsUseCase::new(&state.pool).delete(&id)?;
    events::emit(&state, events::TAG_DELETED, json!({ "id": id }));
    Ok(())
}

// ---------------------------------------------------------------------
// Join-table helpers — prompt_tags.
// ---------------------------------------------------------------------

/// Attach a tag to a prompt.
///
/// # Errors
///
/// `AppError::TransactionRolledBack` on FK violation.
#[tauri::command]
pub async fn add_prompt_tag(
    state: State<'_, AppState>,
    prompt_id: String,
    tag_id: String,
) -> Result<(), AppError> {
    let conn = acquire(&state.pool).map_err(map_db)?;
    repo::add_prompt_tag(&conn, &prompt_id, &tag_id).map_err(map_db)
}

/// Detach a tag from a prompt.
///
/// # Errors
///
/// `AppError::NotFound` if no row matched.
#[tauri::command]
pub async fn remove_prompt_tag(
    state: State<'_, AppState>,
    prompt_id: String,
    tag_id: String,
) -> Result<(), AppError> {
    let conn = acquire(&state.pool).map_err(map_db)?;
    let removed = repo::remove_prompt_tag(&conn, &prompt_id, &tag_id).map_err(map_db)?;
    if removed {
        Ok(())
    } else {
        Err(AppError::NotFound {
            entity: "prompt_tag".into(),
            id: format!("{prompt_id}|{tag_id}"),
        })
    }
}

fn map_db(err: catique_infrastructure::db::pool::DbError) -> AppError {
    use catique_infrastructure::db::pool::DbError;
    match err {
        DbError::PoolTimeout(_) | DbError::Pool(_) => AppError::DbBusy,
        DbError::Sqlite(e) => AppError::TransactionRolledBack {
            reason: e.to_string(),
        },
        DbError::Io(e) => AppError::TransactionRolledBack {
            reason: e.to_string(),
        },
    }
}
