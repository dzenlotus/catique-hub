//! `skills` domain handlers.
//!
//! Wave-E2.x (Round 6 back-fill). Five-command CRUD.

use catique_application::{skills::SkillsUseCase, AppError};
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
