//! `roles` domain handlers.
//!
//! Wave-E2.4 (Olga). Five-command CRUD plus six join-table helpers
//! covering `role_prompts`, `role_skills`, `role_mcp_tools`.

use catique_application::{
    connected_providers::SyncTrigger,
    roles::{RoleContentVersion, RolesUseCase},
    AppError,
};
use catique_domain::{Prompt, Role};
use catique_infrastructure::db::{
    pool::acquire,
    repositories::inheritance::{
        cascade_mcp_tool_attachment, cascade_mcp_tool_detachment, cascade_skill_attachment,
        cascade_skill_detachment,
    },
    repositories::roles as repo,
    repositories::tasks::{cascade_prompt_attachment, cascade_prompt_detachment, AttachScope},
};
use serde::Serialize;
use serde_json::json;
use tauri::State;
use ts_rs::TS;

use crate::events;
use crate::state::AppState;

/// D-C: wire-shape for one `role_content_versions` row sent to the UI.
/// `content` is included on both list + get; the UI shows a preview in
/// the list and the full body in the diff/revert view, so paying for
/// the full text up front saves a second roundtrip per row.
#[derive(Debug, Clone, Serialize, TS)]
#[ts(export, export_to = "../../../bindings/", rename_all = "camelCase")]
#[serde(rename_all = "camelCase")]
pub struct RoleContentVersionView {
    pub id: String,
    pub role_id: String,
    pub content: String,
    pub created_at: i64,
    pub author_note: Option<String>,
}

impl From<RoleContentVersion> for RoleContentVersionView {
    fn from(v: RoleContentVersion) -> Self {
        Self {
            id: v.id,
            role_id: v.role_id,
            content: v.content,
            created_at: v.created_at,
            author_note: v.author_note,
        }
    }
}

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
    icon: Option<String>,
) -> Result<Role, AppError> {
    let role = RolesUseCase::new(&state.pool).create(name, content, color, icon)?;
    events::emit(&state, events::ROLE_CREATED, json!({ "id": role.id }));
    // Reconcile agent files: the orchestrator rebuilds the bundle and
    // each provider's `sync` writes the new role's `catique-<slug>` file
    // (and prunes any whose role no longer exists). Without this a
    // created/renamed/deleted role never reaches `~/.claude/agents/` &c.
    if let Some(orch) = state.orchestrator.get() {
        orch.trigger(SyncTrigger::RoleMutation);
    }
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
    icon: Option<Option<String>>,
) -> Result<Role, AppError> {
    let role = RolesUseCase::new(&state.pool).update(id, name, content, color, icon)?;
    events::emit(&state, events::ROLE_UPDATED, json!({ "id": role.id }));
    if let Some(orch) = state.orchestrator.get() {
        orch.trigger(SyncTrigger::RoleMutation);
    }
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
    // Reconcile agent files so the deleted role's `catique-<slug>` file
    // is pruned from every provider's agents dir (e.g. ~/.claude/agents/).
    if let Some(orch) = state.orchestrator.get() {
        orch.trigger(SyncTrigger::RoleMutation);
    }
    Ok(())
}

// ---------------------------------------------------------------------
// Join-table helpers — role_prompts / role_skills / role_mcp_tools.
// ---------------------------------------------------------------------

/// Attach a prompt to a role.
///
/// ADR-0006 (write-time materialisation): the join-table insert is
/// followed immediately by [`cascade_prompt_attachment`], which writes
/// one `task_prompts` row tagged `origin = 'role:<role_id>'` for every
/// task whose `role_id = role_id`. The pair runs in a single immediate
/// transaction so the resolver never observes a half-attached state.
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
    let mut conn = acquire(&state.pool).map_err(map_db)?;
    let tx = conn
        .transaction_with_behavior(rusqlite::TransactionBehavior::Immediate)
        .map_err(|e| map_db(e.into()))?;
    repo::add_role_prompt(&tx, &role_id, &prompt_id, position).map_err(map_db)?;
    cascade_prompt_attachment(
        &tx,
        &AttachScope::Role(role_id.clone()),
        &prompt_id,
        position,
    )
    .map_err(map_db)?;
    tx.commit().map_err(|e| map_db(e.into()))?;
    Ok(())
}

/// IPC: atomically replace the full ordered prompt list for a role.
/// ctq-108 / audit F-08 — bulk setter for MCP agents that prefer to
/// publish the desired-state list rather than diffing add/remove pairs.
///
/// MCP description: "Replace every prompt currently attached to
/// `role_id` with `prompt_ids` (in order). Pass an empty list to clear
/// the attachment set. Atomic — partial failures roll back."
///
/// # Errors
///
/// Forwards every error from `RolesUseCase::set_role_prompts`.
#[tauri::command]
pub async fn set_role_prompts(
    state: State<'_, AppState>,
    role_id: String,
    prompt_ids: Vec<String>,
) -> Result<(), AppError> {
    RolesUseCase::new(&state.pool).set_role_prompts(role_id.clone(), prompt_ids)?;
    events::emit(&state, events::ROLE_UPDATED, json!({ "id": role_id }));
    Ok(())
}

/// IPC: list the prompts directly attached to a role, ordered by
/// position. Read counterpart to [`set_role_prompts`]; backs the role
/// editor's "Prompts" attachment section.
///
/// # Errors
///
/// Forwards every error from `RolesUseCase::list_role_prompts`.
#[tauri::command]
pub async fn list_role_prompts(
    state: State<'_, AppState>,
    role_id: String,
) -> Result<Vec<Prompt>, AppError> {
    RolesUseCase::new(&state.pool).list_role_prompts(&role_id)
}

/// Detach a prompt from a role.
///
/// Symmetric to [`add_role_prompt`]: removes the join row plus every
/// materialised `task_prompts` row tagged `origin = 'role:<role_id>'`.
/// Direct attachments (`origin = 'direct'`) for the same prompt survive.
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
    let mut conn = acquire(&state.pool).map_err(map_db)?;
    let tx = conn
        .transaction_with_behavior(rusqlite::TransactionBehavior::Immediate)
        .map_err(|e| map_db(e.into()))?;
    let removed = repo::remove_role_prompt(&tx, &role_id, &prompt_id).map_err(map_db)?;
    if removed {
        cascade_prompt_detachment(&tx, &AttachScope::Role(role_id.clone()), &prompt_id)
            .map_err(map_db)?;
        tx.commit().map_err(|e| map_db(e.into()))?;
        Ok(())
    } else {
        // Nothing changed; rollback is implicit when tx drops.
        Err(AppError::NotFound {
            entity: "role_prompt".into(),
            id: format!("{role_id}|{prompt_id}"),
        })
    }
}

/// Attach a skill to a role.
///
/// ctq-121: mirrors [`add_role_prompt`] — the join-table insert is
/// followed in the same immediate transaction by
/// [`cascade_skill_attachment`], which materialises one `task_skills`
/// row tagged `origin = 'role:<role_id>'` for every task whose
/// `role_id = role_id`. The pair is atomic so the resolver never sees
/// a half-attached state.
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
    let mut conn = acquire(&state.pool).map_err(map_db)?;
    let tx = conn
        .transaction_with_behavior(rusqlite::TransactionBehavior::Immediate)
        .map_err(|e| map_db(e.into()))?;
    repo::add_role_skill(&tx, &role_id, &skill_id, position).map_err(map_db)?;
    cascade_skill_attachment(
        &tx,
        &AttachScope::Role(role_id.clone()),
        &skill_id,
        position,
    )
    .map_err(map_db)?;
    tx.commit().map_err(|e| map_db(e.into()))?;
    Ok(())
}

/// Detach a skill from a role.
///
/// ctq-121: symmetric inverse of [`add_role_skill`] — strips both the
/// join row AND every materialised `task_skills` row tagged
/// `origin = 'role:<role_id>'`. Direct attachments survive.
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
    let mut conn = acquire(&state.pool).map_err(map_db)?;
    let tx = conn
        .transaction_with_behavior(rusqlite::TransactionBehavior::Immediate)
        .map_err(|e| map_db(e.into()))?;
    let removed = repo::remove_role_skill(&tx, &role_id, &skill_id).map_err(map_db)?;
    if removed {
        cascade_skill_detachment(&tx, &AttachScope::Role(role_id.clone()), &skill_id)
            .map_err(map_db)?;
        tx.commit().map_err(|e| map_db(e.into()))?;
        Ok(())
    } else {
        Err(AppError::NotFound {
            entity: "role_skill".into(),
            id: format!("{role_id}|{skill_id}"),
        })
    }
}

/// Attach an MCP tool to a role. ctq-121 cascade variant — see
/// [`add_role_skill`] for the contract.
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
    let mut conn = acquire(&state.pool).map_err(map_db)?;
    let tx = conn
        .transaction_with_behavior(rusqlite::TransactionBehavior::Immediate)
        .map_err(|e| map_db(e.into()))?;
    repo::add_role_mcp_tool(&tx, &role_id, &mcp_tool_id, position).map_err(map_db)?;
    cascade_mcp_tool_attachment(
        &tx,
        &AttachScope::Role(role_id.clone()),
        &mcp_tool_id,
        position,
    )
    .map_err(map_db)?;
    tx.commit().map_err(|e| map_db(e.into()))?;
    Ok(())
}

/// Detach an MCP tool from a role. ctq-121 cascade variant — see
/// [`remove_role_skill`] for the contract.
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
    let mut conn = acquire(&state.pool).map_err(map_db)?;
    let tx = conn
        .transaction_with_behavior(rusqlite::TransactionBehavior::Immediate)
        .map_err(|e| map_db(e.into()))?;
    let removed = repo::remove_role_mcp_tool(&tx, &role_id, &mcp_tool_id).map_err(map_db)?;
    if removed {
        cascade_mcp_tool_detachment(&tx, &AttachScope::Role(role_id.clone()), &mcp_tool_id)
            .map_err(map_db)?;
        tx.commit().map_err(|e| map_db(e.into()))?;
        Ok(())
    } else {
        Err(AppError::NotFound {
            entity: "role_mcp_tool".into(),
            id: format!("{role_id}|{mcp_tool_id}"),
        })
    }
}

// ---------------------------------------------------------------------
// D-C content-version IPCs (refactor-v3, Project Map issue #5).
// ---------------------------------------------------------------------

/// IPC: list the last 50 versions of `role.content`, newest first.
///
/// # Errors
///
/// Forwards every error from `RolesUseCase::list_role_versions`.
#[tauri::command]
pub async fn list_role_versions(
    state: State<'_, AppState>,
    role_id: String,
) -> Result<Vec<RoleContentVersionView>, AppError> {
    let rows = RolesUseCase::new(&state.pool).list_role_versions(&role_id)?;
    Ok(rows.into_iter().map(Into::into).collect())
}

/// IPC: fetch the full content of one role content-version.
///
/// # Errors
///
/// `AppError::NotFound` if `version_id` is unknown.
#[tauri::command]
pub async fn get_role_version(
    state: State<'_, AppState>,
    version_id: String,
) -> Result<RoleContentVersionView, AppError> {
    let row = RolesUseCase::new(&state.pool).get_role_version(&version_id)?;
    Ok(row.into())
}

/// IPC: revert a role's content to the value in `version_id`.
/// The pre-revert content is automatically snapshotted (subject to
/// the 5-min debounce window — see [`RolesUseCase::update`]).
///
/// # Errors
///
/// `AppError::NotFound` if `version_id` is unknown.
#[tauri::command]
pub async fn revert_role_to_version(
    state: State<'_, AppState>,
    version_id: String,
) -> Result<Role, AppError> {
    let role = RolesUseCase::new(&state.pool).revert_role_to_version(&version_id)?;
    events::emit(&state, events::ROLE_UPDATED, json!({ "id": role.id }));
    Ok(role)
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
