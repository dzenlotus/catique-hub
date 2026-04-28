//! Catique HUB — Tauri 2.x shell entry point.
//!
//! Wave-E2.4 (Olga, 2026-04-28): registers the full 8-entity CRUD
//! pipeline. Per NFR §3.1 ("panic semantics"), startup-phase errors
//! **do not panic**: we log and return cleanly so the dev launcher can
//! show a useful message.

// Lints configured via [lints.clippy] in Cargo.toml.

use catique_api::{handlers, AppState};
use catique_infrastructure::db::{open_pool, run_pending};
use catique_infrastructure::paths::db_path;
use tauri::Manager;

/// Entrypoint invoked by `main.rs` (and on mobile by
/// `tauri::mobile_entry_point`).
#[cfg_attr(mobile, tauri::mobile_entry_point)]
#[allow(clippy::too_many_lines)]
pub fn run() {
    let state = match init_state() {
        Ok(state) => state,
        Err(reason) => {
            // NFR §3.1: don't panic on startup-phase failures. Log and
            // return cleanly — the dev runner / packaged app launcher
            // surfaces a "DB unavailable" badge to the user.
            eprintln!("[catique-hub] startup aborted: {reason}");
            return;
        }
    };

    if let Err(err) = tauri::Builder::default()
        .manage(state)
        .setup(|app| {
            // E2.5 (Katya): publish the AppHandle into AppState so
            // `catique_api::events::emit` can broadcast realtime
            // events from every IPC handler. `OnceCell::set` is
            // idempotent — see `AppState::set_app_handle`.
            let handle = app.handle().clone();
            let state = app.state::<AppState>();
            state.set_app_handle(handle);
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            // ---------------- spaces (E2.4) ----------------
            handlers::spaces::create_space,
            handlers::spaces::delete_space,
            handlers::spaces::get_space,
            handlers::spaces::list_spaces,
            handlers::spaces::update_space,
            // ---------------- boards (E2.1 + E2.4) ----------------
            handlers::boards::create_board,
            handlers::boards::delete_board,
            handlers::boards::get_board,
            handlers::boards::list_boards,
            handlers::boards::update_board,
            // ---------------- columns (E2.4) ----------------
            handlers::columns::create_column,
            handlers::columns::delete_column,
            handlers::columns::get_column,
            handlers::columns::list_columns,
            handlers::columns::update_column,
            // ---------------- tasks (E2.4) ----------------
            handlers::tasks::add_task_prompt,
            handlers::tasks::clear_task_prompt_override,
            handlers::tasks::create_task,
            handlers::tasks::delete_task,
            handlers::tasks::get_task,
            handlers::tasks::list_tasks,
            handlers::tasks::remove_task_prompt,
            handlers::tasks::set_task_prompt_override,
            handlers::tasks::update_task,
            // ---------------- prompts (E2.4) ----------------
            handlers::prompts::add_board_prompt,
            handlers::prompts::add_column_prompt,
            handlers::prompts::create_prompt,
            handlers::prompts::delete_prompt,
            handlers::prompts::get_prompt,
            handlers::prompts::list_prompts,
            handlers::prompts::remove_board_prompt,
            handlers::prompts::remove_column_prompt,
            handlers::prompts::recompute_prompt_token_count,
            handlers::prompts::update_prompt,
            // ---------------- roles (E2.4) ----------------
            handlers::roles::add_role_mcp_tool,
            handlers::roles::add_role_prompt,
            handlers::roles::add_role_skill,
            handlers::roles::create_role,
            handlers::roles::delete_role,
            handlers::roles::get_role,
            handlers::roles::list_roles,
            handlers::roles::remove_role_mcp_tool,
            handlers::roles::remove_role_prompt,
            handlers::roles::remove_role_skill,
            handlers::roles::update_role,
            // ---------------- skills (E2.x) ----------------
            handlers::skills::create_skill,
            handlers::skills::delete_skill,
            handlers::skills::get_skill,
            handlers::skills::list_skills,
            handlers::skills::update_skill,
            // ---------------- mcp tools (E2.x) ----------------
            handlers::mcp_tools::create_mcp_tool,
            handlers::mcp_tools::delete_mcp_tool,
            handlers::mcp_tools::get_mcp_tool,
            handlers::mcp_tools::list_mcp_tools,
            handlers::mcp_tools::update_mcp_tool,
            // ---------------- tags (E2.4) ----------------
            handlers::tags::add_prompt_tag,
            handlers::tags::create_tag,
            handlers::tags::delete_tag,
            handlers::tags::get_tag,
            handlers::tags::list_tags,
            handlers::tags::remove_prompt_tag,
            handlers::tags::update_tag,
            // ---------------- agent reports (E2.4) ----------------
            handlers::reports::create_agent_report,
            handlers::reports::delete_agent_report,
            handlers::reports::get_agent_report,
            handlers::reports::list_agent_reports,
            handlers::reports::update_agent_report,
            // ---------------- attachments (E2.4) ----------------
            handlers::attachments::create_attachment,
            handlers::attachments::delete_attachment,
            handlers::attachments::get_attachment,
            handlers::attachments::list_attachments,
            handlers::attachments::update_attachment,
            // ---------------- import (E2.7) ----------------
            handlers::import::detect_promptery_db,
            handlers::import::import_from_promptery,
            // ---------------- prompt groups (E2.x) ----------------
            handlers::prompt_groups::add_prompt_group_member,
            handlers::prompt_groups::create_prompt_group,
            handlers::prompt_groups::delete_prompt_group,
            handlers::prompt_groups::get_prompt_group,
            handlers::prompt_groups::list_prompt_group_members,
            handlers::prompt_groups::list_prompt_groups,
            handlers::prompt_groups::remove_prompt_group_member,
            handlers::prompt_groups::set_prompt_group_members,
            handlers::prompt_groups::update_prompt_group,
            // ---------------- settings ----------------
            handlers::settings::ping,
            // ---------------- search (E4.1) ----------------
            handlers::search::search_tasks,
            handlers::search::search_agent_reports,
            handlers::search::search_all,
        ])
        .run(tauri::generate_context!())
    {
        eprintln!("[catique-hub] tauri runtime exited: {err}");
    }
}

/// Side-effect-bearing init: resolve path → open pool → run migrations.
/// Folded into a small helper so `run()` stays linear and testable
/// at the call-site level (via integration tests in E2.7).
fn init_state() -> Result<AppState, String> {
    let path = db_path().map_err(|e| format!("resolve db path: {e}"))?;
    let pool =
        open_pool(&path).map_err(|e| format!("open sqlite pool at {}: {e}", path.display()))?;

    let mut conn = pool
        .get()
        .map_err(|e| format!("acquire migration connection: {e}"))?;
    let applied = run_pending(&mut conn).map_err(|e| format!("run migrations: {e}"))?;
    drop(conn);

    if !applied.is_empty() {
        let names: Vec<&str> = applied.iter().map(|m| m.name.as_str()).collect();
        eprintln!("[catique-hub] applied migrations: {names:?}");
    }
    Ok(AppState::new(pool))
}
