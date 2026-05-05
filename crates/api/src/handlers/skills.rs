//! `skills` domain handlers.
//!
//! Wave-E2.x (Round 6 back-fill). Five-command CRUD plus, since
//! ctq-117 / ctq-127, four join-table helpers covering the role and
//! task scopes.

use catique_application::{skills::SkillsUseCase, tasks::TasksUseCase, AppError};
use catique_domain::Skill;
use serde_json::json;
use tauri::State;

use crate::events;
use crate::state::AppState;

/// IPC: list every skill.
///
/// # Errors
///
/// Forwards every error from `SkillsUseCase::list`.
#[tauri::command]
pub async fn list_skills(state: State<'_, AppState>) -> Result<Vec<Skill>, AppError> {
    SkillsUseCase::new(&state.pool).list()
}

/// IPC: look up a skill by id.
///
/// # Errors
///
/// Forwards every error from `SkillsUseCase::get`.
#[tauri::command]
pub async fn get_skill(state: State<'_, AppState>, id: String) -> Result<Skill, AppError> {
    SkillsUseCase::new(&state.pool).get(&id)
}

/// IPC: create a skill.
///
/// # Errors
///
/// Forwards every error from `SkillsUseCase::create`.
#[tauri::command]
pub async fn create_skill(
    state: State<'_, AppState>,
    name: String,
    description: Option<String>,
    color: Option<String>,
    position: f64,
) -> Result<Skill, AppError> {
    let skill = SkillsUseCase::new(&state.pool).create(name, description, color, position)?;
    events::emit(&state, events::SKILL_CREATED, json!({ "id": skill.id }));
    Ok(skill)
}

/// IPC: partial-update a skill.
///
/// # Errors
///
/// Forwards every error from `SkillsUseCase::update`.
#[tauri::command]
pub async fn update_skill(
    state: State<'_, AppState>,
    id: String,
    name: Option<String>,
    description: Option<Option<String>>,
    color: Option<Option<String>>,
    position: Option<f64>,
) -> Result<Skill, AppError> {
    let skill = SkillsUseCase::new(&state.pool).update(id, name, description, color, position)?;
    events::emit(&state, events::SKILL_UPDATED, json!({ "id": skill.id }));
    Ok(skill)
}

/// IPC: delete a skill.
///
/// # Errors
///
/// Forwards every error from `SkillsUseCase::delete`.
#[tauri::command]
pub async fn delete_skill(state: State<'_, AppState>, id: String) -> Result<(), AppError> {
    SkillsUseCase::new(&state.pool).delete(&id)?;
    events::emit(&state, events::SKILL_DELETED, json!({ "id": id }));
    Ok(())
}

/// IPC: list every skill attached to a role (cat). ctq-117.
///
/// Returns the ordered list of `Skill` values joined through
/// `role_skills`. Empty `Vec` for roles with no skills.
///
/// # Errors
///
/// Forwards every error from `SkillsUseCase::list_for_role`.
#[tauri::command]
pub async fn list_role_skills(
    state: State<'_, AppState>,
    role_id: String,
) -> Result<Vec<Skill>, AppError> {
    SkillsUseCase::new(&state.pool).list_for_role(&role_id)
}

/// IPC: list every skill attached to a task. ctq-117.
///
/// Returns direct + inherited rows ordered by `task_skills.position`.
///
/// # Errors
///
/// Forwards every error from `SkillsUseCase::list_for_task`.
#[tauri::command]
pub async fn list_task_skills(
    state: State<'_, AppState>,
    task_id: String,
) -> Result<Vec<Skill>, AppError> {
    SkillsUseCase::new(&state.pool).list_for_task(&task_id)
}

/// IPC: attach a skill directly to a task. Idempotent — re-adding the
/// same skill is a no-op (same INSERT OR IGNORE pattern as the prompt
/// cascade). Emits `task:updated` so the kanban view refreshes the
/// affected card without needing a separate `task:skills_changed`
/// channel — the bundle resolver already incorporates skills.
///
/// ctq-127.
///
/// # Errors
///
/// Forwards every error from `SkillsUseCase::add_to_task` plus
/// `AppError::NotFound` from the post-attach `TasksUseCase::get` used
/// to populate the event payload.
#[tauri::command]
pub async fn add_task_skill(
    state: State<'_, AppState>,
    task_id: String,
    skill_id: String,
    position: f64,
) -> Result<(), AppError> {
    SkillsUseCase::new(&state.pool).add_to_task(&task_id, &skill_id, position)?;
    emit_task_updated(&state, &task_id);
    Ok(())
}

/// IPC: detach a direct skill from a task. Idempotent — removing a
/// skill that is not attached succeeds silently (mirrors the use-case
/// contract). Emits `task:updated`.
///
/// ctq-127.
///
/// # Errors
///
/// Forwards every error from `SkillsUseCase::remove_from_task`.
#[tauri::command]
pub async fn remove_task_skill(
    state: State<'_, AppState>,
    task_id: String,
    skill_id: String,
) -> Result<(), AppError> {
    SkillsUseCase::new(&state.pool).remove_from_task(&task_id, &skill_id)?;
    emit_task_updated(&state, &task_id);
    Ok(())
}

/// Emit `task:updated` for `task_id` after a join-table mutation.
/// Best-effort: a missing task (e.g. concurrent delete) is logged via
/// the events module's silent emitter and does not bubble up to the
/// caller — the join-table change has already committed by this point.
fn emit_task_updated(state: &AppState, task_id: &str) {
    if let Ok(task) = TasksUseCase::new(&state.pool).get(task_id) {
        events::emit(
            state,
            events::TASK_UPDATED,
            json!({
                "id": task.id,
                "column_id": task.column_id,
                "board_id": task.board_id,
            }),
        );
    }
}
