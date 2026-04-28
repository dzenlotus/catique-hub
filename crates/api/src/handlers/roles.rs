//! `roles` domain handlers.
//!
//! Wave-E2.4 (Olga). Five-command CRUD plus six join-table helpers
//! covering `role_prompts`, `role_skills`, `role_mcp_tools`.

use catique_application::{roles::RolesUseCase, AppError};
use catique_domain::Role;
use catique_infrastructure::db::{pool::acquire, repositories::roles as repo};
use serde_json::json;
use tauri::State;

use crate::events;
use crate::state::AppState;

/// E2 will populate per-domain initialisation here.
pub fn register() {}

/// IPC: list every role.
///
/// # Errors
///
/// Forwards every error from `RolesUseCase::list`.
#[tauri::command]
pub async fn list_roles(state: State<'_, AppState>) -> Result<Vec<Role>, AppError> {
    RolesUseCase::new(&state.pool).list()
}

/// IPC: look up a role by id.
///
/// # Errors
///
/// Forwards every error from `RolesUseCase::get`.
#[tauri::command]
pub async fn get_role(state: State<'_, AppState>, id: String) -> Result<Role, AppError> {
    RolesUseCase::new(&state.pool).get(&id)
}

/// IPC: create a role.
///
/// # Errors
///
/// Forwards every error from `RolesUseCase::create`.
#[tauri::command]
pub async fn create_role(
    state: State<'_, AppState>,
    name: String,
    content: String,
    color: Option<String>,
) -> Result<Role, AppError> {
    let role = RolesUseCase::new(&state.pool).create(name, content, color)?;
    events::emit(&state, events::ROLE_CREATED, json!({ "id": role.id }));
    Ok(role)
}

/// IPC: partial-update a role.
///
/// # Errors
///
/// Forwards every error from `RolesUseCase::update`.
#[tauri::command]
pub async fn update_role(
    state: State<'_, AppState>,
    id: String,
    name: Option<String>,
    content: Option<String>,
    color: Option<Option<String>>,
) -> Result<Role, AppError> {
    let role = RolesUseCase::new(&state.pool).update(id, name, content, color)?;
    events::emit(&state, events::ROLE_UPDATED, json!({ "id": role.id }));
    Ok(role)
}

/// IPC: delete a role.
///
/// # Errors
///
/// Forwards every error from `RolesUseCase::delete`.
#[tauri::command]
pub async fn delete_role(state: State<'_, AppState>, id: String) -> Result<(), AppError> {
    RolesUseCase::new(&state.pool).delete(&id)?;
    events::emit(&state, events::ROLE_DELETED, json!({ "id": id }));
    Ok(())
}

// ---------------------------------------------------------------------
// Join-table helpers — role_prompts / role_skills / role_mcp_tools.
// ---------------------------------------------------------------------

/// Attach a prompt to a role.
///
/// # Errors
///
/// `AppError::TransactionRolledBack` on FK violation.
#[tauri::command]
pub async fn add_role_prompt(
    state: State<'_, AppState>,
    role_id: String,
    prompt_id: String,
    position: f64,
) -> Result<(), AppError> {
    let conn = acquire(&state.pool).map_err(map_db)?;
    repo::add_role_prompt(&conn, &role_id, &prompt_id, position).map_err(map_db)
}

/// Detach a prompt from a role.
///
/// # Errors
///
/// `AppError::NotFound` if no row matched.
#[tauri::command]
pub async fn remove_role_prompt(
    state: State<'_, AppState>,
    role_id: String,
    prompt_id: String,
) -> Result<(), AppError> {
    let conn = acquire(&state.pool).map_err(map_db)?;
    let removed = repo::remove_role_prompt(&conn, &role_id, &prompt_id).map_err(map_db)?;
    if removed {
        Ok(())
    } else {
        Err(AppError::NotFound {
            entity: "role_prompt".into(),
            id: format!("{role_id}|{prompt_id}"),
        })
    }
}

/// Attach a skill to a role.
///
/// # Errors
///
/// `AppError::TransactionRolledBack` on FK violation.
#[tauri::command]
pub async fn add_role_skill(
    state: State<'_, AppState>,
    role_id: String,
    skill_id: String,
    position: f64,
) -> Result<(), AppError> {
    let conn = acquire(&state.pool).map_err(map_db)?;
    repo::add_role_skill(&conn, &role_id, &skill_id, position).map_err(map_db)
}

/// Detach a skill from a role.
///
/// # Errors
///
/// `AppError::NotFound` if no row matched.
#[tauri::command]
pub async fn remove_role_skill(
    state: State<'_, AppState>,
    role_id: String,
    skill_id: String,
) -> Result<(), AppError> {
    let conn = acquire(&state.pool).map_err(map_db)?;
    let removed = repo::remove_role_skill(&conn, &role_id, &skill_id).map_err(map_db)?;
    if removed {
        Ok(())
    } else {
        Err(AppError::NotFound {
            entity: "role_skill".into(),
            id: format!("{role_id}|{skill_id}"),
        })
    }
}

/// Attach an MCP tool to a role.
///
/// # Errors
///
/// `AppError::TransactionRolledBack` on FK violation.
#[tauri::command]
pub async fn add_role_mcp_tool(
    state: State<'_, AppState>,
    role_id: String,
    mcp_tool_id: String,
    position: f64,
) -> Result<(), AppError> {
    let conn = acquire(&state.pool).map_err(map_db)?;
    repo::add_role_mcp_tool(&conn, &role_id, &mcp_tool_id, position).map_err(map_db)
}

/// Detach an MCP tool from a role.
///
/// # Errors
///
/// `AppError::NotFound` if no row matched.
#[tauri::command]
pub async fn remove_role_mcp_tool(
    state: State<'_, AppState>,
    role_id: String,
    mcp_tool_id: String,
) -> Result<(), AppError> {
    let conn = acquire(&state.pool).map_err(map_db)?;
    let removed = repo::remove_role_mcp_tool(&conn, &role_id, &mcp_tool_id).map_err(map_db)?;
    if removed {
        Ok(())
    } else {
        Err(AppError::NotFound {
            entity: "role_mcp_tool".into(),
            id: format!("{role_id}|{mcp_tool_id}"),
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
