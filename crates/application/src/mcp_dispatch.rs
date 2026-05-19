//! MCP tool dispatch — shared between the Tauri MCP bridge and the
//! standalone `catique-hub-mcp` binary (W1, 2026-05-14).
//!
//! Originally lived in `catique_api::mcp_bridge` as a single 3.4 k-LOC
//! file pinned to the Tauri shell. The Node sidecar rewrite (W1)
//! extracted the dispatch surface here so the new Rust binary
//! (`crates/mcp-server-bin/`) can call into the same arms without
//! linking against Tauri / WebKit. The Tauri bridge in
//! `crates/api/src/mcp_bridge/mod.rs` now delegates here for every
//! Catique-native arm and keeps only the two arms that need the live
//! `SidecarManager` wire — `proxy_tool_call` and `refresh_mcp_server`.
//!
//! ## Adding a new tool
//!
//! Two changes are required:
//!
//!   1. Add the entry to `sidecar/tool-manifest.json`.
//!   2. Add a match arm to [`dispatch`] decoding `params` into the use
//!      case and re-serializing the result via `serde_json`.
//!
//! ## Naming convention for decoders
//!
//!   * `decode_*` — required field; error on missing.
//!   * `decode_optional_*` — `Option<T>`; missing OR null → `None`.
//!   * `decode_tri_state_*` — `Option<Option<T>>`; missing → `None`,
//!     null → `Some(None)`, value → `Some(Some(_))`.

use std::path::{Path, PathBuf};

use base64::{engine::general_purpose::STANDARD as BASE64, Engine as _};
use catique_domain::{RoleNoteAuthor, Transport};
use catique_infrastructure::{
    db::{
        pool::{acquire, Pool},
        repositories::{
            inheritance::{
                cascade_mcp_tool_attachment, cascade_mcp_tool_detachment, cascade_skill_attachment,
                cascade_skill_detachment,
            },
            mcp_servers as servers_repo, prompts as prompts_repo, roles as roles_repo,
            tags as tags_repo,
            tasks::{cascade_prompt_attachment, cascade_prompt_detachment, AttachScope},
        },
    },
    paths::app_data_dir,
    secrets,
};
use serde_json::{json, Value};

use crate::{
    attachments::AttachmentsUseCase,
    boards::BoardsUseCase,
    clients::ConnectedProvidersUseCase,
    columns::ColumnsUseCase,
    connected_providers::{build_bundle_for_test, OrchestratorHandle, SyncTrigger},
    mcp_servers::McpServersUseCase,
    mcp_tools::McpToolsUseCase,
    prompt_groups::PromptGroupsUseCase,
    prompts::PromptsUseCase,
    reports::ReportsUseCase,
    role_notes::RoleNotesUseCase,
    roles::RolesUseCase,
    search::SearchUseCase,
    settings::SettingsUseCase,
    skill_import::{ImportTarget, SkillImportUseCase},
    skill_steps::SkillStepsUseCase,
    skills::SkillsUseCase,
    spaces::{CreateSpaceArgs, SpacesUseCase, UpdateSpaceArgs},
    tags::TagsUseCase,
    tasks::TasksUseCase,
    AppError,
};

/// Maximum attachment blob accepted by `upload_attachment_blob` (10 MiB).
/// Mirrors `AttachmentsUseCase::create`'s NFR §3.4 budget so we reject
/// over-size payloads before allocating the decoded buffer.
const MAX_BLOB_SIZE_BYTES: usize = 10 * 1024 * 1024;

// =====================================================================
// Public sync dispatch
// =====================================================================

/// Look up `method` in the dispatch table, decode `params`, run the use
/// case, and return the JSON-encoded result. Errors collapse into a
/// single `String` (the MCP transport surfaces it as `isError: true`
/// text content).
///
/// Async-only arms (`proxy_tool_call`, `refresh_mcp_server`,
/// `add_provider`, `remove_provider`, `import_skill_from_url`) MUST be
/// handled in the caller's pre-dispatch path — see
/// [`add_provider_arm`], [`remove_provider_arm`],
/// [`import_skill_from_url_arm`]. The proxy + refresh arms additionally
/// require the live `SidecarManager` wire and stay in
/// `catique_api::mcp_bridge` next to their adapter.
///
/// Keep the match arms ordered alphabetically — easier scan once the
/// list grows past five entries.
///
/// # Errors
///
/// Returns the stringified `AppError` (envelope shape: `{"kind":
/// "AppError", "error": ..., "message": ...}`) on use-case failures,
/// or a free-form validation message for malformed params.
#[allow(clippy::too_many_lines, clippy::needless_pass_by_value)]
pub fn dispatch(pool: &Pool, method: &str, params: Value) -> Result<Value, String> {
    match method {
        // -------- prompts (join-table helpers) --------
        "add_board_prompt" => add_board_prompt_arm(pool, &params),
        "add_column_prompt" => add_column_prompt_arm(pool, &params),
        "add_prompt_group_member" => {
            let group_id = decode_string(&params, "group_id")?;
            let prompt_id = decode_string(&params, "prompt_id")?;
            let position = decode_i64(&params, "position")?;
            PromptGroupsUseCase::new(pool)
                .add_member(group_id, prompt_id, position)
                .map_err(stringify_app)?;
            Ok(json!({ "ok": true }))
        }
        "add_prompt_tag" => add_prompt_tag_arm(pool, &params),
        "add_role_mcp_tool" => add_role_mcp_tool_arm(pool, &params),
        "add_role_note" => add_role_note_arm(pool, &params),
        "add_role_prompt" => add_role_prompt_arm(pool, &params),
        "add_role_skill" => add_role_skill_arm(pool, &params),
        "add_skill_file_attachment" => add_skill_file_attachment_arm(pool, &params),
        "add_skill_git_attachment" => add_skill_git_attachment_arm(pool, &params),
        "add_skill_step" => add_skill_step_arm(pool, &params),
        "add_space_prompt" => {
            let space_id = decode_string(&params, "space_id")?;
            let prompt_id = decode_string(&params, "prompt_id")?;
            let position = decode_optional_f64(&params, "position");
            SpacesUseCase::new(pool)
                .add_space_prompt(&space_id, &prompt_id, position)
                .map_err(stringify_app)?;
            Ok(json!({ "ok": true }))
        }
        "add_task_mcp_tool" => {
            let task_id = decode_string(&params, "task_id")?;
            let mcp_tool_id = decode_string(&params, "mcp_tool_id")?;
            let position = decode_f64(&params, "position")?;
            McpToolsUseCase::new(pool)
                .add_to_task(&task_id, &mcp_tool_id, position)
                .map_err(stringify_app)?;
            Ok(json!({ "ok": true }))
        }
        "add_task_prompt" => add_task_prompt_arm(pool, &params),
        "add_task_skill" => {
            let task_id = decode_string(&params, "task_id")?;
            let skill_id = decode_string(&params, "skill_id")?;
            let position = decode_f64(&params, "position")?;
            SkillsUseCase::new(pool)
                .add_to_task(&task_id, &skill_id, position)
                .map_err(stringify_app)?;
            Ok(json!({ "ok": true }))
        }
        "clear_task_prompt_override" => clear_task_prompt_override_arm(pool, &params),
        // -------- agent reports --------
        "create_agent_report" => {
            let task_id = decode_string(&params, "task_id")?;
            let kind = decode_string(&params, "kind")?;
            let title = decode_string(&params, "title")?;
            let content = decode_string(&params, "content")?;
            let author = decode_optional_string(&params, "author");
            let report = ReportsUseCase::new(pool)
                .create(task_id, kind, title, content, author)
                .map_err(stringify_app)?;
            json_or_err(&report)
        }
        // -------- attachments --------
        "create_attachment" => create_attachment_arm(pool, &params),
        // -------- tasks / boards / columns CRUD --------
        "create_column" => {
            let board_id = decode_string(&params, "board_id")?;
            let name = decode_string(&params, "name")?;
            let position = decode_i64(&params, "position")?;
            let column = ColumnsUseCase::new(pool)
                .create(board_id, name, position)
                .map_err(stringify_app)?;
            json_or_err(&column)
        }
        // -------- mcp servers / tools CRUD --------
        "create_mcp_server" => create_mcp_server_arm(pool, &params),
        "create_mcp_tool" => {
            let name = decode_string(&params, "name")?;
            let description = decode_optional_string(&params, "description");
            let schema_json = decode_string(&params, "schema_json")?;
            let color = decode_optional_string(&params, "color");
            let position = decode_f64(&params, "position")?;
            let tool = McpToolsUseCase::new(pool)
                .create(name, description, schema_json, color, position)
                .map_err(stringify_app)?;
            json_or_err(&tool)
        }
        // -------- prompts CRUD --------
        "create_prompt" => {
            let name = decode_string(&params, "name")?;
            let content = decode_string(&params, "content")?;
            let color = decode_optional_string(&params, "color");
            let short_description = decode_optional_string(&params, "short_description");
            let icon = decode_optional_string(&params, "icon");
            let examples = decode_optional_string_array(&params, "examples").unwrap_or_default();
            let prompt = PromptsUseCase::new(pool)
                .create(name, content, color, short_description, icon, examples)
                .map_err(stringify_app)?;
            json_or_err(&prompt)
        }
        "create_prompt_group" => {
            let name = decode_string(&params, "name")?;
            let color = decode_optional_string(&params, "color");
            let icon = decode_optional_string(&params, "icon");
            let position = params.get("position").and_then(Value::as_i64);
            let group = PromptGroupsUseCase::new(pool)
                .create(name, color, icon, position)
                .map_err(stringify_app)?;
            json_or_err(&group)
        }
        // -------- roles / skills CRUD --------
        "create_role" => {
            let name = decode_string(&params, "name")?;
            let content = decode_string(&params, "content")?;
            let color = decode_optional_string(&params, "color");
            let icon = decode_optional_string(&params, "icon");
            let role = RolesUseCase::new(pool)
                .create(name, content, color, icon)
                .map_err(stringify_app)?;
            json_or_err(&role)
        }
        "create_skill" => {
            let name = decode_string(&params, "name")?;
            let description = decode_optional_string(&params, "description");
            let color = decode_optional_string(&params, "color");
            let position = decode_f64(&params, "position")?;
            let skill = SkillsUseCase::new(pool)
                .create(name, description, color, position)
                .map_err(stringify_app)?;
            json_or_err(&skill)
        }
        "create_space" => {
            let args = CreateSpaceArgs {
                name: decode_string(&params, "name")?,
                prefix: decode_string(&params, "prefix")?,
                description: decode_optional_string(&params, "description"),
                color: decode_optional_string(&params, "color"),
                icon: decode_optional_string(&params, "icon"),
                is_default: params
                    .get("is_default")
                    .and_then(Value::as_bool)
                    .unwrap_or(false),
                project_folder_path: decode_optional_string(&params, "project_folder_path"),
            };
            let space = SpacesUseCase::new(pool)
                .create(args)
                .map_err(stringify_app)?;
            json_or_err(&space)
        }
        "create_tag" => {
            let name = decode_string(&params, "name")?;
            let color = decode_optional_string(&params, "color");
            let tag = TagsUseCase::new(pool)
                .create(name, color)
                .map_err(stringify_app)?;
            json_or_err(&tag)
        }
        "create_task" => {
            let board_id = decode_string(&params, "board_id")?;
            let column_id = decode_string(&params, "column_id")?;
            let title = decode_string(&params, "title")?;
            let description = decode_optional_string(&params, "description");
            let position = decode_f64(&params, "position")?;
            let role_id = decode_optional_string(&params, "role_id");
            let task = TasksUseCase::new(pool)
                .create(board_id, column_id, title, description, position, role_id)
                .map_err(stringify_app)?;
            json_or_err(&task)
        }
        "delete_agent_report" => {
            let id = decode_string(&params, "id")?;
            ReportsUseCase::new(pool)
                .delete(&id)
                .map_err(stringify_app)?;
            Ok(json!({ "ok": true }))
        }
        "delete_attachment" => delete_attachment_arm(pool, &params),
        "delete_board" => {
            let id = decode_string(&params, "id")?;
            BoardsUseCase::new(pool)
                .delete(&id)
                .map_err(stringify_app)?;
            Ok(json!({ "ok": true }))
        }
        "delete_column" => {
            let id = decode_string(&params, "id")?;
            ColumnsUseCase::new(pool)
                .delete(&id)
                .map_err(stringify_app)?;
            Ok(json!({ "ok": true }))
        }
        "delete_mcp_server" => {
            let id = decode_string(&params, "id")?;
            McpServersUseCase::new(pool)
                .delete(&id)
                .map_err(stringify_app)?;
            Ok(json!({ "ok": true }))
        }
        "delete_mcp_tool" => {
            let id = decode_string(&params, "id")?;
            McpToolsUseCase::new(pool)
                .delete(&id)
                .map_err(stringify_app)?;
            Ok(json!({ "ok": true }))
        }
        "delete_prompt" => {
            let id = decode_string(&params, "id")?;
            PromptsUseCase::new(pool)
                .delete(&id)
                .map_err(stringify_app)?;
            Ok(json!({ "ok": true }))
        }
        "delete_prompt_group" => {
            let id = decode_string(&params, "id")?;
            PromptGroupsUseCase::new(pool)
                .delete(&id)
                .map_err(stringify_app)?;
            Ok(json!({ "ok": true }))
        }
        "delete_role" => {
            let id = decode_string(&params, "id")?;
            RolesUseCase::new(pool).delete(&id).map_err(stringify_app)?;
            Ok(json!({ "ok": true }))
        }
        "delete_skill" => delete_skill_arm(pool, &params),
        "delete_skill_step" => delete_skill_step_arm(pool, &params),
        "delete_space" => {
            let id = decode_string(&params, "id")?;
            SpacesUseCase::new(pool)
                .delete(&id)
                .map_err(stringify_app)?;
            Ok(json!({ "ok": true }))
        }
        "delete_tag" => {
            let id = decode_string(&params, "id")?;
            TagsUseCase::new(pool).delete(&id).map_err(stringify_app)?;
            Ok(json!({ "ok": true }))
        }
        "delete_task" => delete_task_arm(pool, &params),
        "get_task_urgency" => {
            let id = decode_string(&params, "id")?;
            let urgency = TasksUseCase::new(pool)
                .get_urgency(&id)
                .map_err(stringify_app)?;
            Ok(json!({ "id": id, "urgency": urgency }))
        }
        "set_task_urgency" => {
            let id = decode_string(&params, "id")?;
            let urgency = decode_string(&params, "urgency")?;
            let stored = TasksUseCase::new(pool)
                .set_urgency(&id, &urgency)
                .map_err(stringify_app)?;
            Ok(json!({ "id": id, "urgency": stored }))
        }
        "get_agent_report" => {
            let id = decode_string(&params, "id")?;
            let report = ReportsUseCase::new(pool).get(&id).map_err(stringify_app)?;
            json_or_err(&report)
        }
        // -------- attachments / boards / columns read --------
        "get_attachment" => {
            let id = decode_string(&params, "id")?;
            let attachment = AttachmentsUseCase::new(pool)
                .get(&id)
                .map_err(stringify_app)?;
            json_or_err(&attachment)
        }
        "get_board" => {
            let id = decode_string(&params, "id")?;
            let board = BoardsUseCase::new(pool).get(&id).map_err(stringify_app)?;
            json_or_err(&board)
        }
        "get_column" => {
            let id = decode_string(&params, "id")?;
            let column = ColumnsUseCase::new(pool).get(&id).map_err(stringify_app)?;
            json_or_err(&column)
        }
        "get_mcp_server" => {
            let id = decode_string(&params, "id")?;
            let server = McpServersUseCase::new(pool)
                .get(&id)
                .map_err(stringify_app)?;
            json_or_err(&server)
        }
        "get_mcp_server_status" => {
            let id = decode_string(&params, "id")?;
            let status = McpServersUseCase::new(pool)
                .status(&id)
                .map_err(stringify_app)?;
            json_or_err(&status)
        }
        "get_mcp_tool" => {
            let id = decode_string(&params, "id")?;
            let tool = McpToolsUseCase::new(pool).get(&id).map_err(stringify_app)?;
            json_or_err(&tool)
        }
        // -------- prompts read --------
        "get_prompt" => {
            let id = decode_string(&params, "id")?;
            let prompt = PromptsUseCase::new(pool).get(&id).map_err(stringify_app)?;
            json_or_err(&prompt)
        }
        "get_prompt_group" => {
            let id = decode_string(&params, "id")?;
            let group = PromptGroupsUseCase::new(pool)
                .get(&id)
                .map_err(stringify_app)?;
            json_or_err(&group)
        }
        "get_role" => {
            let id = decode_string(&params, "id")?;
            let role = RolesUseCase::new(pool).get(&id).map_err(stringify_app)?;
            json_or_err(&role)
        }
        "get_setting" => {
            let key = decode_string(&params, "key")?;
            let value = SettingsUseCase::new(pool)
                .get_setting(&key)
                .map_err(stringify_app)?;
            json_or_err(&value)
        }
        "get_skill" => {
            let id = decode_string(&params, "id")?;
            let skill = SkillsUseCase::new(pool).get(&id).map_err(stringify_app)?;
            json_or_err(&skill)
        }
        "get_space" => {
            let id = decode_string(&params, "id")?;
            let space = SpacesUseCase::new(pool).get(&id).map_err(stringify_app)?;
            json_or_err(&space)
        }
        "get_step_log" => get_step_log_arm(pool, &params),
        "get_sync_status" => {
            // Without an orchestrator handle we cannot read live status;
            // return the default `Idle` snapshot — same contract as the
            // Tauri IPC.
            let status = catique_domain::SyncStatus::default();
            json_or_err(&status)
        }
        "get_tag" => {
            let id = decode_string(&params, "id")?;
            let tag = TagsUseCase::new(pool).get(&id).map_err(stringify_app)?;
            json_or_err(&tag)
        }
        "get_task" => {
            let id = decode_string(&params, "id")?;
            let task = TasksUseCase::new(pool).get(&id).map_err(stringify_app)?;
            json_or_err(&task)
        }
        "get_task_bundle" => {
            let task_id = decode_string(&params, "task_id")?;
            let bundle = TasksUseCase::new(pool)
                .resolve_task_bundle(&task_id)
                .map_err(stringify_app)?;
            json_or_err(&bundle)
        }
        "get_task_rating" => {
            let task_id = decode_string(&params, "task_id")?;
            let rating = TasksUseCase::new(pool)
                .get_task_rating(&task_id)
                .map_err(stringify_app)?;
            json_or_err(&rating)
        }
        "get_workflow_graph" => {
            let space_id = decode_string(&params, "space_id")?;
            let payload = SpacesUseCase::new(pool)
                .get_workflow_graph(&space_id)
                .map_err(stringify_app)?;
            json_or_err(&payload)
        }
        // -------- list reads --------
        "list_agent_reports" => {
            let task_id = decode_optional_string(&params, "task_id");
            let reports = ReportsUseCase::new(pool)
                .list(task_id)
                .map_err(stringify_app)?;
            json_or_err(&reports)
        }
        "list_attachments" => {
            let task_id = decode_optional_string(&params, "task_id");
            let attachments = AttachmentsUseCase::new(pool)
                .list(task_id)
                .map_err(stringify_app)?;
            json_or_err(&attachments)
        }
        "list_boards" => {
            let boards = BoardsUseCase::new(pool).list().map_err(stringify_app)?;
            json_or_err(&boards)
        }
        "list_columns" => {
            let columns = ColumnsUseCase::new(pool).list().map_err(stringify_app)?;
            json_or_err(&columns)
        }
        "list_connected_providers" => {
            let rows = ConnectedProvidersUseCase::new(pool)
                .list_providers()
                .map_err(stringify_app)?;
            json_or_err(&rows)
        }
        "list_mcp_servers" => {
            let servers = McpServersUseCase::new(pool).list().map_err(stringify_app)?;
            json_or_err(&servers)
        }
        "list_mcp_tools" => {
            let tools = McpToolsUseCase::new(pool).list().map_err(stringify_app)?;
            json_or_err(&tools)
        }
        "list_mcp_tools_by_server" => {
            let server_id = decode_string(&params, "server_id")?;
            let tools = McpServersUseCase::new(pool)
                .list_tools_by_server(&server_id)
                .map_err(stringify_app)?;
            json_or_err(&tools)
        }
        "list_prompt_group_members" => {
            let group_id = decode_string(&params, "group_id")?;
            let members = PromptGroupsUseCase::new(pool)
                .list_members(&group_id)
                .map_err(stringify_app)?;
            json_or_err(&members)
        }
        "list_prompt_groups" => {
            let groups = PromptGroupsUseCase::new(pool)
                .list()
                .map_err(stringify_app)?;
            json_or_err(&groups)
        }
        "list_prompt_tags_map" => {
            let entries = TagsUseCase::new(pool)
                .list_tag_map()
                .map_err(stringify_app)?;
            json_or_err(&entries)
        }
        "list_prompts" => {
            let prompts = PromptsUseCase::new(pool).list().map_err(stringify_app)?;
            json_or_err(&prompts)
        }
        "list_proxied_tools" => list_proxied_tools_arm(pool),
        "list_role_mcp_tools" => {
            let role_id = decode_string(&params, "role_id")?;
            let tools = McpToolsUseCase::new(pool)
                .list_for_role(&role_id)
                .map_err(stringify_app)?;
            json_or_err(&tools)
        }
        "list_role_skills" => {
            let role_id = decode_string(&params, "role_id")?;
            let skills = SkillsUseCase::new(pool)
                .list_for_role(&role_id)
                .map_err(stringify_app)?;
            json_or_err(&skills)
        }
        "list_role_tags" => list_role_tags_arm(pool, &params),
        "list_roles" => {
            let roles = RolesUseCase::new(pool).list().map_err(stringify_app)?;
            json_or_err(&roles)
        }
        "list_skill_attachments" => {
            let skill_id = decode_string(&params, "skill_id")?;
            let attachments = SkillsUseCase::new(pool)
                .list_attachments(&skill_id)
                .map_err(stringify_app)?;
            json_or_err(&attachments)
        }
        "list_skill_steps" => {
            let skill_id = decode_string(&params, "skill_id")?;
            let steps = SkillStepsUseCase::new(pool)
                .list_steps(&skill_id)
                .map_err(stringify_app)?;
            json_or_err(&steps)
        }
        "list_skills" => {
            let skills = SkillsUseCase::new(pool).list().map_err(stringify_app)?;
            json_or_err(&skills)
        }
        "list_space_prompts" => {
            let space_id = decode_string(&params, "space_id")?;
            let prompts = SpacesUseCase::new(pool)
                .list_space_prompts(&space_id)
                .map_err(stringify_app)?;
            json_or_err(&prompts)
        }
        "list_spaces" => {
            let spaces = SpacesUseCase::new(pool).list().map_err(stringify_app)?;
            json_or_err(&spaces)
        }
        "list_supported_providers" => {
            let providers = ConnectedProvidersUseCase::new(pool).list_supported();
            json_or_err(&providers)
        }
        "list_tags" => {
            let tags = TagsUseCase::new(pool).list().map_err(stringify_app)?;
            json_or_err(&tags)
        }
        "list_task_mcp_tools" => {
            let task_id = decode_string(&params, "task_id")?;
            let tools = McpToolsUseCase::new(pool)
                .list_for_task(&task_id)
                .map_err(stringify_app)?;
            json_or_err(&tools)
        }
        "list_task_prompts" => {
            let task_id = decode_string(&params, "task_id")?;
            let prompts = TasksUseCase::new(pool)
                .list_task_prompts(&task_id)
                .map_err(stringify_app)?;
            json_or_err(&prompts)
        }
        "list_task_skills" => {
            let task_id = decode_string(&params, "task_id")?;
            let skills = SkillsUseCase::new(pool)
                .list_for_task(&task_id)
                .map_err(stringify_app)?;
            json_or_err(&skills)
        }
        "list_tasks" => {
            let tasks = TasksUseCase::new(pool).list().map_err(stringify_app)?;
            json_or_err(&tasks)
        }
        "log_step" => {
            let task_id = decode_string(&params, "task_id")?;
            let summary = decode_string(&params, "summary")?;
            TasksUseCase::new(pool)
                .log_step(task_id, summary)
                .map_err(stringify_app)?;
            Ok(json!({ "ok": true }))
        }
        "move_task" => move_task_arm(pool, &params),
        "rate_task" => rate_task_arm(pool, &params),
        "recall_role_notes" => recall_role_notes_arm(pool, &params),
        "recompute_prompt_token_count" => {
            let id = decode_string(&params, "id")?;
            let prompt = PromptsUseCase::new(pool)
                .recompute_token_count(id)
                .map_err(stringify_app)?;
            json_or_err(&prompt)
        }
        // -------- prompts remove / detach --------
        "remove_board_prompt" => remove_board_prompt_arm(pool, &params),
        "remove_column_prompt" => remove_column_prompt_arm(pool, &params),
        "remove_prompt_group_member" => {
            let group_id = decode_string(&params, "group_id")?;
            let prompt_id = decode_string(&params, "prompt_id")?;
            PromptGroupsUseCase::new(pool)
                .remove_member(group_id, prompt_id)
                .map_err(stringify_app)?;
            Ok(json!({ "ok": true }))
        }
        "remove_prompt_tag" => remove_prompt_tag_arm(pool, &params),
        "remove_role_mcp_tool" => remove_role_mcp_tool_arm(pool, &params),
        "remove_role_prompt" => remove_role_prompt_arm(pool, &params),
        "remove_role_skill" => remove_role_skill_arm(pool, &params),
        "remove_skill_attachment" => remove_skill_attachment_arm(pool, &params),
        "remove_space_prompt" => {
            let space_id = decode_string(&params, "space_id")?;
            let prompt_id = decode_string(&params, "prompt_id")?;
            SpacesUseCase::new(pool)
                .remove_space_prompt(&space_id, &prompt_id)
                .map_err(stringify_app)?;
            Ok(json!({ "ok": true }))
        }
        "remove_task_mcp_tool" => {
            let task_id = decode_string(&params, "task_id")?;
            let mcp_tool_id = decode_string(&params, "mcp_tool_id")?;
            McpToolsUseCase::new(pool)
                .remove_from_task(&task_id, &mcp_tool_id)
                .map_err(stringify_app)?;
            Ok(json!({ "ok": true }))
        }
        "remove_task_prompt" => remove_task_prompt_arm(pool, &params),
        "remove_task_skill" => {
            let task_id = decode_string(&params, "task_id")?;
            let skill_id = decode_string(&params, "skill_id")?;
            SkillsUseCase::new(pool)
                .remove_from_task(&task_id, &skill_id)
                .map_err(stringify_app)?;
            Ok(json!({ "ok": true }))
        }
        "reorder_skill_steps" => reorder_skill_steps_arm(pool, &params),
        "resolve_keychain" => resolve_keychain_arm(pool, &params),
        "route_task_to_board" => {
            let task_id = decode_string(&params, "task_id")?;
            let target_board_id = decode_string(&params, "target_board_id")?;
            let task = TasksUseCase::new(pool)
                .route_task_to_board(task_id, target_board_id)
                .map_err(stringify_app)?;
            json_or_err(&task)
        }
        // -------- search --------
        "search_agent_reports" => {
            let query = decode_string(&params, "query")?;
            let limit = decode_optional_i64(&params, "limit");
            let results = SearchUseCase::new(pool)
                .search_agent_reports(query, limit)
                .map_err(stringify_app)?;
            json_or_err(&results)
        }
        "search_all" => {
            let query = decode_string(&params, "query")?;
            let limit_per_kind = decode_optional_i64(&params, "limit_per_kind");
            let results = SearchUseCase::new(pool)
                .search_all(query, limit_per_kind)
                .map_err(stringify_app)?;
            json_or_err(&results)
        }
        "search_tasks" => {
            let query = decode_string(&params, "query")?;
            let limit = decode_optional_i64(&params, "limit");
            let results = SearchUseCase::new(pool)
                .search_tasks(query, limit)
                .map_err(stringify_app)?;
            json_or_err(&results)
        }
        "search_tasks_by_cat_and_space" => {
            let space_id = decode_string(&params, "space_id")?;
            let cat_id = decode_string(&params, "cat_id")?;
            let query = decode_string(&params, "query")?;
            let matches = SearchUseCase::new(pool)
                .search_tasks_by_cat_and_space(space_id, cat_id, query)
                .map_err(stringify_app)?;
            json_or_err(&matches)
        }
        // -------- boards / columns bulk set --------
        "set_board_mcp_tools" => {
            let board_id = decode_string(&params, "board_id")?;
            let mcp_tool_ids = decode_string_array(&params, "mcp_tool_ids")?;
            BoardsUseCase::new(pool)
                .set_mcp_tools(&board_id, &mcp_tool_ids)
                .map_err(stringify_app)?;
            Ok(json!({ "ok": true }))
        }
        // -------- prompts bulk set --------
        "set_board_owner" => {
            let board_id = decode_string(&params, "board_id")?;
            let role_id = decode_string(&params, "role_id")?;
            let board = BoardsUseCase::new(pool)
                .set_board_owner(&board_id, &role_id)
                .map_err(stringify_app)?;
            json_or_err(&board)
        }
        "set_board_prompts" => {
            let board_id = decode_string(&params, "board_id")?;
            let prompt_ids = decode_string_array(&params, "prompt_ids")?;
            BoardsUseCase::new(pool)
                .set_board_prompts(board_id, prompt_ids)
                .map_err(stringify_app)?;
            Ok(json!({ "ok": true }))
        }
        "set_board_skills" => {
            let board_id = decode_string(&params, "board_id")?;
            let skill_ids = decode_string_array(&params, "skill_ids")?;
            BoardsUseCase::new(pool)
                .set_skills(&board_id, &skill_ids)
                .map_err(stringify_app)?;
            Ok(json!({ "ok": true }))
        }
        "set_column_mcp_tools" => {
            let column_id = decode_string(&params, "column_id")?;
            let mcp_tool_ids = decode_string_array(&params, "mcp_tool_ids")?;
            ColumnsUseCase::new(pool)
                .set_mcp_tools(&column_id, &mcp_tool_ids)
                .map_err(stringify_app)?;
            Ok(json!({ "ok": true }))
        }
        "set_column_prompts" => {
            let column_id = decode_string(&params, "column_id")?;
            let prompt_ids = decode_string_array(&params, "prompt_ids")?;
            ColumnsUseCase::new(pool)
                .set_column_prompts(column_id, prompt_ids)
                .map_err(stringify_app)?;
            Ok(json!({ "ok": true }))
        }
        "set_column_skills" => {
            let column_id = decode_string(&params, "column_id")?;
            let skill_ids = decode_string_array(&params, "skill_ids")?;
            ColumnsUseCase::new(pool)
                .set_skills(&column_id, &skill_ids)
                .map_err(stringify_app)?;
            Ok(json!({ "ok": true }))
        }
        "set_prompt_group_members" => {
            let group_id = decode_string(&params, "group_id")?;
            let ordered_prompt_ids = decode_string_array(&params, "ordered_prompt_ids")?;
            PromptGroupsUseCase::new(pool)
                .set_members(group_id, ordered_prompt_ids)
                .map_err(stringify_app)?;
            Ok(json!({ "ok": true }))
        }
        "set_role_prompts" => {
            let role_id = decode_string(&params, "role_id")?;
            let prompt_ids = decode_string_array(&params, "prompt_ids")?;
            RolesUseCase::new(pool)
                .set_role_prompts(role_id, prompt_ids)
                .map_err(stringify_app)?;
            Ok(json!({ "ok": true }))
        }
        "set_setting" => {
            let key = decode_string(&params, "key")?;
            let value = decode_string(&params, "value")?;
            SettingsUseCase::new(pool)
                .set_setting(&key, &value)
                .map_err(stringify_app)?;
            Ok(json!({ "ok": true }))
        }
        "set_space_mcp_tools" => {
            let space_id = decode_string(&params, "space_id")?;
            let mcp_tool_ids = decode_string_array(&params, "mcp_tool_ids")?;
            SpacesUseCase::new(pool)
                .set_mcp_tools(&space_id, &mcp_tool_ids)
                .map_err(stringify_app)?;
            Ok(json!({ "ok": true }))
        }
        "set_space_prompts" => {
            let space_id = decode_string(&params, "space_id")?;
            let prompt_ids = decode_string_array(&params, "prompt_ids")?;
            SpacesUseCase::new(pool)
                .set_space_prompts(space_id, prompt_ids)
                .map_err(stringify_app)?;
            Ok(json!({ "ok": true }))
        }
        "set_space_skills" => {
            let space_id = decode_string(&params, "space_id")?;
            let skill_ids = decode_string_array(&params, "skill_ids")?;
            SpacesUseCase::new(pool)
                .set_skills(&space_id, &skill_ids)
                .map_err(stringify_app)?;
            Ok(json!({ "ok": true }))
        }
        "set_tag_prompts" => {
            let tag_id = decode_string(&params, "tag_id")?;
            let prompt_ids = decode_string_array(&params, "prompt_ids")?;
            TagsUseCase::new(pool)
                .set_tag_prompts(tag_id, prompt_ids)
                .map_err(stringify_app)?;
            Ok(json!({ "ok": true }))
        }
        "set_task_prompt_override" => set_task_prompt_override_arm(pool, &params),
        "set_workflow_graph" => {
            let space_id = decode_string(&params, "space_id")?;
            let json_payload = decode_string(&params, "json")?;
            SpacesUseCase::new(pool)
                .set_workflow_graph(space_id, json_payload)
                .map_err(stringify_app)?;
            Ok(json!({ "ok": true }))
        }
        "sync_owner_to_agent_file" => {
            let space_id = decode_string(&params, "space_id")?;
            let path = SpacesUseCase::new(pool)
                .sync_owner_to_agent_file(&space_id)
                .map_err(stringify_app)?;
            Ok(json!({ "space_id": space_id, "path": path.to_string_lossy() }))
        }
        "sync_workflow_to_agent_file" => {
            let space_id = decode_string(&params, "space_id")?;
            let path = SpacesUseCase::new(pool)
                .sync_workflow_to_agent_file(&space_id)
                .map_err(stringify_app)?;
            Ok(json!({ "space_id": space_id, "path": path.to_string_lossy() }))
        }
        // -------- updates --------
        "update_agent_report" => {
            let id = decode_string(&params, "id")?;
            let kind = decode_optional_string(&params, "kind");
            let title = decode_optional_string(&params, "title");
            let content = decode_optional_string(&params, "content");
            let author = decode_tri_state_string(&params, "author");
            let report = ReportsUseCase::new(pool)
                .update(id, kind, title, content, author)
                .map_err(stringify_app)?;
            json_or_err(&report)
        }
        "update_attachment" => {
            let id = decode_string(&params, "id")?;
            let filename = decode_optional_string(&params, "filename");
            let uploaded_by = decode_tri_state_string(&params, "uploaded_by");
            let attachment = AttachmentsUseCase::new(pool)
                .update(id, filename, uploaded_by)
                .map_err(stringify_app)?;
            json_or_err(&attachment)
        }
        "update_column" => {
            let id = decode_string(&params, "id")?;
            let name = decode_optional_string(&params, "name");
            let position = decode_optional_i64(&params, "position");
            let role_id = decode_tri_state_string(&params, "role_id");
            let column = ColumnsUseCase::new(pool)
                .update(id, name, position, role_id)
                .map_err(stringify_app)?;
            json_or_err(&column)
        }
        "update_mcp_server" => update_mcp_server_arm(pool, &params),
        "update_mcp_tool" => {
            let id = decode_string(&params, "id")?;
            let name = decode_optional_string(&params, "name");
            let description = decode_tri_state_string(&params, "description");
            let schema_json = decode_optional_string(&params, "schema_json");
            let color = decode_tri_state_string(&params, "color");
            let position = decode_optional_f64(&params, "position");
            let tool = McpToolsUseCase::new(pool)
                .update(id, name, description, schema_json, color, position)
                .map_err(stringify_app)?;
            json_or_err(&tool)
        }
        "update_prompt" => {
            let id = decode_string(&params, "id")?;
            let name = decode_optional_string(&params, "name");
            let content = decode_optional_string(&params, "content");
            let color = decode_tri_state_string(&params, "color");
            let short_description = decode_tri_state_string(&params, "short_description");
            let icon = decode_tri_state_string(&params, "icon");
            let examples = decode_optional_string_array(&params, "examples");
            let prompt = PromptsUseCase::new(pool)
                .update(id, name, content, color, short_description, icon, examples)
                .map_err(stringify_app)?;
            json_or_err(&prompt)
        }
        "update_prompt_group" => {
            let id = decode_string(&params, "id")?;
            let name = decode_optional_string(&params, "name");
            let color = decode_tri_state_string(&params, "color");
            let icon = decode_tri_state_string(&params, "icon");
            let position = params.get("position").and_then(Value::as_i64);
            let group = PromptGroupsUseCase::new(pool)
                .update(id, name, color, icon, position)
                .map_err(stringify_app)?;
            json_or_err(&group)
        }
        "update_role" => {
            let id = decode_string(&params, "id")?;
            let name = decode_optional_string(&params, "name");
            let content = decode_optional_string(&params, "content");
            let color = decode_tri_state_string(&params, "color");
            let icon = decode_tri_state_string(&params, "icon");
            let role = RolesUseCase::new(pool)
                .update(id, name, content, color, icon)
                .map_err(stringify_app)?;
            json_or_err(&role)
        }
        "update_skill" => {
            let id = decode_string(&params, "id")?;
            let name = decode_optional_string(&params, "name");
            let description = decode_tri_state_string(&params, "description");
            let color = decode_tri_state_string(&params, "color");
            let position = decode_optional_f64(&params, "position");
            let skill = SkillsUseCase::new(pool)
                .update(id, name, description, color, position)
                .map_err(stringify_app)?;
            json_or_err(&skill)
        }
        "update_skill_step" => update_skill_step_arm(pool, &params),
        "update_space" => {
            let args = UpdateSpaceArgs {
                id: decode_string(&params, "id")?,
                name: decode_optional_string(&params, "name"),
                description: decode_tri_state_string(&params, "description"),
                color: decode_tri_state_string(&params, "color"),
                icon: decode_tri_state_string(&params, "icon"),
                is_default: params.get("is_default").and_then(Value::as_bool),
                position: params.get("position").and_then(Value::as_f64),
                project_folder_path: decode_tri_state_string(&params, "project_folder_path"),
            };
            let space = SpacesUseCase::new(pool)
                .update(args)
                .map_err(stringify_app)?;
            json_or_err(&space)
        }
        "update_tag" => {
            let id = decode_string(&params, "id")?;
            let name = decode_optional_string(&params, "name");
            let color = decode_tri_state_string(&params, "color");
            let tag = TagsUseCase::new(pool)
                .update(id, name, color)
                .map_err(stringify_app)?;
            json_or_err(&tag)
        }
        "update_task" => {
            let id = decode_string(&params, "id")?;
            let title = decode_optional_string(&params, "title");
            let description = decode_tri_state_string(&params, "description");
            let column_id = decode_optional_string(&params, "column_id");
            let position = decode_optional_f64(&params, "position");
            let role_id = decode_tri_state_string(&params, "role_id");
            let task = TasksUseCase::new(pool)
                .update(id, title, description, column_id, position, role_id)
                .map_err(stringify_app)?;
            json_or_err(&task)
        }
        "upload_attachment" => upload_attachment_arm(pool, &params),
        "upload_attachment_blob" => upload_attachment_blob_arm(pool, &params),
        other => Err(format!("Unknown ipc_call method: {other}")),
    }
}

// =====================================================================
// Async arms — runtime + IO required (not part of `dispatch`).
// =====================================================================

/// Async dispatch for `add_provider`. Mirrors
/// `handlers::clients::add_provider` minus the Tauri event emit.
/// Fires `SyncTrigger::ProviderAdded` on success when `orch` is wired.
///
/// # Errors
///
/// Forwards every `AppError` from `ConnectedProvidersUseCase::add_provider`.
pub async fn add_provider_arm(
    pool: &Pool,
    orch: Option<&OrchestratorHandle>,
    params: Value,
) -> Result<Value, String> {
    let id = decode_string(&params, "id")?;
    let bundle = build_bundle_for_test(pool).map_err(stringify_app)?;
    let row = ConnectedProvidersUseCase::new(pool)
        .add_provider(&id, &bundle)
        .await
        .map_err(stringify_app)?;
    if let Some(handle) = orch {
        handle.trigger(SyncTrigger::ProviderAdded);
    }
    json_or_err(&row)
}

/// Async dispatch for `remove_provider`. Idempotent on the DB side.
/// Fires `SyncTrigger::ProviderAdded` (the only trigger that resolves
/// to a full sync round today) so a stale provider that re-detects is
/// picked up automatically.
///
/// # Errors
///
/// Forwards every `AppError` from `ConnectedProvidersUseCase::remove_provider`.
pub async fn remove_provider_arm(
    pool: &Pool,
    orch: Option<&OrchestratorHandle>,
    params: Value,
) -> Result<Value, String> {
    let id = decode_string(&params, "id")?;
    ConnectedProvidersUseCase::new(pool)
        .remove_provider(&id)
        .await
        .map_err(stringify_app)?;
    if let Some(handle) = orch {
        handle.trigger(SyncTrigger::ProviderAdded);
    }
    Ok(json!({ "ok": true }))
}

/// SKILL-V2-A async arm: performs an HTTP fetch against the allowlisted
/// hosts, parses the markdown body on H2 splits, and persists the skill
/// + steps + git-reference attachment in one tx.
///
/// # Errors
///
/// Forwards every `AppError` from `SkillImportUseCase::import_from_url`.
pub async fn import_skill_from_url_arm(pool: &Pool, params: Value) -> Result<Value, String> {
    let url = decode_string(&params, "url")?;
    let target_skill_id = decode_optional_string(&params, "target_skill_id");
    let replace_steps = params
        .get("replace_steps")
        .and_then(Value::as_bool)
        .unwrap_or(true);
    let target = if let Some(skill_id) = target_skill_id {
        ImportTarget::ApplyToExisting {
            skill_id,
            replace_steps,
        }
    } else {
        let name = decode_optional_string(&params, "name").ok_or_else(|| {
            stringify_app(AppError::Validation {
                field: "name".into(),
                reason: "name is required when target_skill_id is omitted".into(),
            })
        })?;
        ImportTarget::CreateNew { name }
    };
    let report = SkillImportUseCase::new(pool)
        .import_from_url(&url, target)
        .await
        .map_err(stringify_app)?;
    json_or_err(&report)
}

// =====================================================================
// Per-arm helpers (kept out of `dispatch` to keep the match readable).
// =====================================================================

/// Mirrors `handlers::prompts::add_board_prompt`. The Tauri handler
/// wraps the write in an immediate transaction so the join-row insert
/// and the resolver cascade commit atomically — we replicate that
/// shape here.
fn add_board_prompt_arm(pool: &Pool, params: &Value) -> Result<Value, String> {
    let board_id = decode_string(params, "board_id")?;
    let prompt_id = decode_string(params, "prompt_id")?;
    let position = decode_i64(params, "position")?;
    let mut conn = acquire(pool).map_err(|e| format!("db acquire: {e}"))?;
    let tx = conn
        .transaction_with_behavior(rusqlite::TransactionBehavior::Immediate)
        .map_err(|e| format!("db tx: {e}"))?;
    prompts_repo::add_board_prompt(&tx, &board_id, &prompt_id, position)
        .map_err(|e| format!("db: {e}"))?;
    #[allow(clippy::cast_precision_loss)]
    let pos_f = position as f64;
    cascade_prompt_attachment(&tx, &AttachScope::Board(board_id), &prompt_id, pos_f)
        .map_err(|e| format!("db: {e}"))?;
    tx.commit().map_err(|e| format!("db commit: {e}"))?;
    Ok(json!({ "ok": true }))
}

fn add_column_prompt_arm(pool: &Pool, params: &Value) -> Result<Value, String> {
    let column_id = decode_string(params, "column_id")?;
    let prompt_id = decode_string(params, "prompt_id")?;
    let position = decode_i64(params, "position")?;
    let mut conn = acquire(pool).map_err(|e| format!("db acquire: {e}"))?;
    let tx = conn
        .transaction_with_behavior(rusqlite::TransactionBehavior::Immediate)
        .map_err(|e| format!("db tx: {e}"))?;
    prompts_repo::add_column_prompt(&tx, &column_id, &prompt_id, position)
        .map_err(|e| format!("db: {e}"))?;
    #[allow(clippy::cast_precision_loss)]
    let pos_f = position as f64;
    cascade_prompt_attachment(&tx, &AttachScope::Column(column_id), &prompt_id, pos_f)
        .map_err(|e| format!("db: {e}"))?;
    tx.commit().map_err(|e| format!("db commit: {e}"))?;
    Ok(json!({ "ok": true }))
}

fn remove_board_prompt_arm(pool: &Pool, params: &Value) -> Result<Value, String> {
    let board_id = decode_string(params, "board_id")?;
    let prompt_id = decode_string(params, "prompt_id")?;
    let mut conn = acquire(pool).map_err(|e| format!("db acquire: {e}"))?;
    let tx = conn
        .transaction_with_behavior(rusqlite::TransactionBehavior::Immediate)
        .map_err(|e| format!("db tx: {e}"))?;
    let removed = prompts_repo::remove_board_prompt(&tx, &board_id, &prompt_id)
        .map_err(|e| format!("db: {e}"))?;
    if !removed {
        return Err(stringify_app(AppError::NotFound {
            entity: "board_prompt".into(),
            id: format!("{board_id}|{prompt_id}"),
        }));
    }
    cascade_prompt_detachment(&tx, &AttachScope::Board(board_id), &prompt_id)
        .map_err(|e| format!("db: {e}"))?;
    tx.commit().map_err(|e| format!("db commit: {e}"))?;
    Ok(json!({ "ok": true }))
}

fn remove_column_prompt_arm(pool: &Pool, params: &Value) -> Result<Value, String> {
    let column_id = decode_string(params, "column_id")?;
    let prompt_id = decode_string(params, "prompt_id")?;
    let mut conn = acquire(pool).map_err(|e| format!("db acquire: {e}"))?;
    let tx = conn
        .transaction_with_behavior(rusqlite::TransactionBehavior::Immediate)
        .map_err(|e| format!("db tx: {e}"))?;
    let removed = prompts_repo::remove_column_prompt(&tx, &column_id, &prompt_id)
        .map_err(|e| format!("db: {e}"))?;
    if !removed {
        return Err(stringify_app(AppError::NotFound {
            entity: "column_prompt".into(),
            id: format!("{column_id}|{prompt_id}"),
        }));
    }
    cascade_prompt_detachment(&tx, &AttachScope::Column(column_id), &prompt_id)
        .map_err(|e| format!("db: {e}"))?;
    tx.commit().map_err(|e| format!("db commit: {e}"))?;
    Ok(json!({ "ok": true }))
}

fn add_task_prompt_arm(pool: &Pool, params: &Value) -> Result<Value, String> {
    let task_id = decode_string(params, "task_id")?;
    let prompt_id = decode_string(params, "prompt_id")?;
    let position = decode_f64(params, "position")?;
    let conn = acquire(pool).map_err(|e| format!("db acquire: {e}"))?;
    catique_infrastructure::db::repositories::tasks::add_task_prompt(
        &conn, &task_id, &prompt_id, position,
    )
    .map_err(|e| format!("db: {e}"))?;
    Ok(json!({ "ok": true }))
}

fn remove_task_prompt_arm(pool: &Pool, params: &Value) -> Result<Value, String> {
    let task_id = decode_string(params, "task_id")?;
    let prompt_id = decode_string(params, "prompt_id")?;
    let conn = acquire(pool).map_err(|e| format!("db acquire: {e}"))?;
    let removed = catique_infrastructure::db::repositories::tasks::remove_task_prompt(
        &conn, &task_id, &prompt_id,
    )
    .map_err(|e| format!("db: {e}"))?;
    if !removed {
        return Err(stringify_app(AppError::NotFound {
            entity: "task_prompt".into(),
            id: format!("{task_id}|{prompt_id}"),
        }));
    }
    Ok(json!({ "ok": true }))
}

fn set_task_prompt_override_arm(pool: &Pool, params: &Value) -> Result<Value, String> {
    let task_id = decode_string(params, "task_id")?;
    let prompt_id = decode_string(params, "prompt_id")?;
    let enabled = decode_bool(params, "enabled")?;
    let conn = acquire(pool).map_err(|e| format!("db acquire: {e}"))?;
    catique_infrastructure::db::repositories::tasks::set_task_prompt_override(
        &conn, &task_id, &prompt_id, enabled,
    )
    .map_err(|e| format!("db: {e}"))?;
    Ok(json!({ "ok": true }))
}

fn clear_task_prompt_override_arm(pool: &Pool, params: &Value) -> Result<Value, String> {
    let task_id = decode_string(params, "task_id")?;
    let prompt_id = decode_string(params, "prompt_id")?;
    let conn = acquire(pool).map_err(|e| format!("db acquire: {e}"))?;
    let cleared = catique_infrastructure::db::repositories::tasks::clear_task_prompt_override(
        &conn, &task_id, &prompt_id,
    )
    .map_err(|e| format!("db: {e}"))?;
    if !cleared {
        return Err(stringify_app(AppError::NotFound {
            entity: "task_prompt_override".into(),
            id: format!("{task_id}|{prompt_id}"),
        }));
    }
    Ok(json!({ "ok": true }))
}

fn recall_role_notes_arm(pool: &Pool, params: &Value) -> Result<Value, String> {
    let role_id = decode_string(params, "role_id")?;
    let tags: Vec<String> = params
        .get("tags")
        .and_then(Value::as_array)
        .map(|arr| {
            arr.iter()
                .filter_map(|v| v.as_str().map(str::to_owned))
                .collect()
        })
        .unwrap_or_default();
    let query = params
        .get("query")
        .and_then(Value::as_str)
        .map(str::to_owned);
    let limit: usize = params.get("limit").and_then(Value::as_i64).map_or(20, |n| {
        if n <= 0 {
            0
        } else {
            usize::try_from(n).unwrap_or(50)
        }
    });
    let out = RoleNotesUseCase::new(pool)
        .recall(&role_id, &tags, query.as_deref(), limit)
        .map_err(stringify_app)?;
    json_or_err(&out)
}

fn add_role_note_arm(pool: &Pool, params: &Value) -> Result<Value, String> {
    let role_id = decode_string(params, "role_id")?;
    let body = decode_string(params, "body")?;
    let tags: Vec<String> = params
        .get("tags")
        .and_then(Value::as_array)
        .map(|arr| {
            arr.iter()
                .filter_map(|v| v.as_str().map(str::to_owned))
                .collect()
        })
        .unwrap_or_default();
    let source_task_id = params
        .get("source_task_id")
        .and_then(Value::as_str)
        .map(str::to_owned);
    let out = RoleNotesUseCase::new(pool)
        .add(&role_id, body, tags, source_task_id, RoleNoteAuthor::Agent)
        .map_err(stringify_app)?;
    json_or_err(&out)
}

fn list_role_tags_arm(pool: &Pool, params: &Value) -> Result<Value, String> {
    let role_id = decode_string(params, "role_id")?;
    let out = RoleNotesUseCase::new(pool)
        .list_tags(&role_id)
        .map_err(stringify_app)?;
    json_or_err(&out)
}

fn list_proxied_tools_arm(pool: &Pool) -> Result<Value, String> {
    let tools = McpServersUseCase::new(pool)
        .list_proxied_tools()
        .map_err(stringify_app)?;
    json_or_err(&tools)
}

fn resolve_keychain_arm(pool: &Pool, params: &Value) -> Result<Value, String> {
    let server_id = decode_string(params, "server_id")?;
    let conn = acquire(pool).map_err(|e| format!("db acquire: {e}"))?;
    let server = servers_repo::get_by_id(&conn, &server_id)
        .map_err(|e| format!("db: {e}"))?
        .ok_or_else(|| format!("not_found: mcp_server `{server_id}`"))?;
    let auth_ref = secrets::AuthRef::parse(server.auth_json.as_deref())
        .map_err(|e| format!("malformed_ref: {e}"))?
        .ok_or_else(|| "no_auth_configured".to_owned())?;
    let secret = secrets::resolve(&auth_ref).map_err(|e| match e {
        secrets::SecretError::NotFound => "keychain_missing".to_owned(),
        secrets::SecretError::Backend(code) => format!("keychain_backend: {code}"),
        secrets::SecretError::NotImplemented(_) => "not_implemented".to_owned(),
        secrets::SecretError::MalformedRef(m) => format!("malformed_ref: {m}"),
    })?;
    Ok(json!({ "secret": secret }))
}

fn move_task_arm(pool: &Pool, params: &Value) -> Result<Value, String> {
    let task_id = decode_string(params, "task_id")?;
    let column_id = decode_optional_string(params, "column_id");
    let board_id = decode_optional_string(params, "board_id");
    let position = decode_optional_f64(params, "position");
    let uc = TasksUseCase::new(pool);
    let task = match (column_id, board_id) {
        (Some(c), _) => uc.move_task(task_id, c, position).map_err(stringify_app)?,
        (None, Some(target_board)) => uc
            .route_task_to_board(task_id, target_board)
            .map_err(stringify_app)?,
        (None, None) => {
            return Err(stringify_app(AppError::Validation {
                field: "column_id".into(),
                reason: "either columnId or boardId must be supplied".into(),
            }));
        }
    };
    json_or_err(&task)
}

fn rate_task_arm(pool: &Pool, params: &Value) -> Result<Value, String> {
    let task_id = decode_string(params, "task_id")?;
    let rating_raw =
        match params.get("rating") {
            None | Some(Value::Null) => None,
            Some(v) => Some(v.as_i64().ok_or_else(|| {
                "validation failed on `rating`: must be integer or null".to_owned()
            })?),
        };
    let narrowed = match rating_raw {
        None => None,
        Some(v) => {
            let trimmed = i32::try_from(v).map_err(|_| {
                stringify_app(AppError::Validation {
                    field: "rating".into(),
                    reason: "must be one of -1, 0, +1, or null".into(),
                })
            })?;
            Some(i8::try_from(trimmed).map_err(|_| {
                stringify_app(AppError::Validation {
                    field: "rating".into(),
                    reason: "must be one of -1, 0, +1, or null".into(),
                })
            })?)
        }
    };
    TasksUseCase::new(pool)
        .rate_task(task_id, narrowed)
        .map_err(stringify_app)?;
    Ok(json!({ "ok": true }))
}

fn get_step_log_arm(pool: &Pool, params: &Value) -> Result<Value, String> {
    let task_id = decode_string(params, "task_id")?;
    let conn = acquire(pool).map_err(|e| format!("db acquire: {e}"))?;
    match catique_infrastructure::db::repositories::tasks::get_step_log(&conn, &task_id)
        .map_err(|e| format!("db: {e}"))?
    {
        Some(text) => Ok(json!(text)),
        None => Err(stringify_app(AppError::NotFound {
            entity: "task".into(),
            id: task_id,
        })),
    }
}

fn delete_task_arm(pool: &Pool, params: &Value) -> Result<Value, String> {
    let id = decode_string(params, "id")?;
    let data_root = app_data_dir().map_err(|reason| {
        stringify_app(AppError::Validation {
            field: "target_data_dir".into(),
            reason: reason.to_owned(),
        })
    })?;
    let attachments_root = data_root.join("attachments");
    TasksUseCase::new(pool)
        .delete_with_attachments(&id, &attachments_root)
        .map_err(stringify_app)?;
    Ok(json!({ "ok": true }))
}

fn create_attachment_arm(pool: &Pool, params: &Value) -> Result<Value, String> {
    let task_id = decode_string(params, "task_id")?;
    let filename = decode_string(params, "filename")?;
    let mime_type = decode_string(params, "mime_type")?;
    let size_bytes = decode_i64(params, "size_bytes")?;
    let storage_path = decode_string(params, "storage_path")?;
    let uploaded_by = decode_optional_string(params, "uploaded_by");
    let attachment = AttachmentsUseCase::new(pool)
        .create(
            task_id,
            filename,
            mime_type,
            size_bytes,
            storage_path,
            uploaded_by,
        )
        .map_err(stringify_app)?;
    json_or_err(&attachment)
}

fn delete_attachment_arm(pool: &Pool, params: &Value) -> Result<Value, String> {
    let id = decode_string(params, "id")?;
    let data_root = app_data_dir().map_err(|reason| {
        stringify_app(AppError::Validation {
            field: "target_data_dir".into(),
            reason: reason.to_owned(),
        })
    })?;
    let blob_root = data_root.join("attachments");
    AttachmentsUseCase::new(pool)
        .delete_with_blob(&id, &blob_root)
        .map_err(stringify_app)?;
    Ok(json!({ "ok": true }))
}

fn upload_attachment_arm(pool: &Pool, params: &Value) -> Result<Value, String> {
    let task_id = decode_string(params, "task_id")?;
    let source_path = decode_string(params, "source_path")?;
    let original_filename = decode_string(params, "original_filename")?;
    let mime_type = decode_optional_string(params, "mime_type");
    let src = PathBuf::from(&source_path);
    if !src.exists() {
        return Err(stringify_app(AppError::Validation {
            field: "source_path".into(),
            reason: format!("file does not exist: {source_path}"),
        }));
    }
    if !src.is_file() {
        return Err(stringify_app(AppError::Validation {
            field: "source_path".into(),
            reason: format!("path is not a regular file: {source_path}"),
        }));
    }
    let data_root = app_data_dir().map_err(|reason| {
        stringify_app(AppError::Validation {
            field: "target_data_dir".into(),
            reason: reason.to_owned(),
        })
    })?;
    let target_dir = data_root.join("attachments").join(&task_id);
    std::fs::create_dir_all(&target_dir).map_err(|e| {
        stringify_app(AppError::Validation {
            field: "target_data_dir".into(),
            reason: format!("failed to create attachment directory: {e}"),
        })
    })?;
    let attachment_id = nanoid::nanoid!();
    let sanitized: String = sanitize_filename(&original_filename);
    let storage_name = format!("{attachment_id}_{sanitized}");
    let dest = target_dir.join(&storage_name);
    std::fs::copy(&src, &dest).map_err(|e| {
        let _ = std::fs::remove_file(&dest);
        stringify_app(AppError::Validation {
            field: "source_path".into(),
            reason: format!("file copy failed: {e}"),
        })
    })?;
    let size_bytes = std::fs::metadata(&dest)
        .map(|m| i64::try_from(m.len()).unwrap_or(i64::MAX))
        .unwrap_or(0);
    let resolved_mime = mime_type
        .filter(|m| !m.is_empty())
        .unwrap_or_else(|| mime_from_ext(&src).to_owned());
    let attachment = AttachmentsUseCase::new(pool)
        .create(
            task_id,
            original_filename,
            resolved_mime,
            size_bytes,
            storage_name,
            None,
        )
        .inspect_err(|_| {
            let _ = std::fs::remove_file(&dest);
        })
        .map_err(stringify_app)?;
    json_or_err(&attachment)
}

fn upload_attachment_blob_arm(pool: &Pool, params: &Value) -> Result<Value, String> {
    let task_id = decode_string(params, "task_id")?;
    let filename = decode_string(params, "filename")?;
    let content_b64 = decode_string(params, "content_b64")?;
    let mime = decode_string(params, "mime")?;
    let data_root = app_data_dir().map_err(|reason| {
        stringify_app(AppError::Validation {
            field: "target_data_dir".into(),
            reason: reason.to_owned(),
        })
    })?;
    let attachment =
        upload_attachment_blob_inner(pool, &data_root, task_id, filename, &content_b64, mime)
            .map_err(stringify_app)?;
    json_or_err(&attachment)
}

/// Core implementation of `upload_attachment_blob`. Extracted so both
/// the Tauri IPC handler and the MCP dispatcher reuse one
/// atomic-write-and-cleanup path. Public so callers in `catique-api`
/// or the standalone MCP binary can call into the same body without
/// duplicating the size cap or MIME fallback logic.
///
/// # Errors
///
/// Returns `AppError::BadRequest` for malformed base64 or oversize
/// payloads, `AppError::Validation` for filesystem errors, and any
/// other `AppError` propagated from the underlying use case.
pub fn upload_attachment_blob_inner(
    pool: &Pool,
    data_root: &Path,
    task_id: String,
    filename: String,
    content_b64: &str,
    mime: String,
) -> Result<catique_domain::Attachment, AppError> {
    // 1. Decode base64.
    let bytes = BASE64.decode(content_b64.as_bytes()).map_err(|e| {
        // Avoid echoing the (possibly megabyte-long) base64 back into
        // the error message — `DecodeError::Display` already names the
        // offending position.
        AppError::BadRequest {
            reason: format!("content_b64: invalid base64 ({e})"),
        }
    })?;

    // 2. Size cap.
    if bytes.len() > MAX_BLOB_SIZE_BYTES {
        return Err(AppError::BadRequest {
            reason: format!(
                "attachment exceeds {MAX_BLOB_SIZE_BYTES} bytes (got {})",
                bytes.len()
            ),
        });
    }

    // 3. Resolve target directory.
    let target_dir = data_root.join("attachments").join(&task_id);
    std::fs::create_dir_all(&target_dir).map_err(|e| AppError::Validation {
        field: "target_data_dir".into(),
        reason: format!("failed to create attachment directory: {e}"),
    })?;

    // 4. Collision-safe filename.
    let attachment_id = nanoid::nanoid!();
    let sanitized = sanitize_filename(&filename);
    let storage_name = format!("{attachment_id}_{sanitized}");
    let dest = target_dir.join(&storage_name);
    let tmp = target_dir.join(format!("{storage_name}.tmp"));

    // 5. Atomic write: tmp + rename.
    if let Err(e) = std::fs::write(&tmp, &bytes) {
        let _ = std::fs::remove_file(&tmp);
        return Err(AppError::Validation {
            field: "content_b64".into(),
            reason: format!("blob write failed: {e}"),
        });
    }
    if let Err(e) = std::fs::rename(&tmp, &dest) {
        let _ = std::fs::remove_file(&tmp);
        return Err(AppError::Validation {
            field: "content_b64".into(),
            reason: format!("blob rename failed: {e}"),
        });
    }

    // 6. Insert metadata row.
    let size_bytes = i64::try_from(bytes.len()).unwrap_or(i64::MAX);
    let mime_resolved = if mime.trim().is_empty() {
        mime_from_ext(Path::new(&filename)).to_owned()
    } else {
        mime
    };
    let attachment = AttachmentsUseCase::new(pool)
        .create(
            task_id,
            filename,
            mime_resolved,
            size_bytes,
            storage_name,
            None,
        )
        .inspect_err(|_| {
            if let Err(rm) = std::fs::remove_file(&dest) {
                eprintln!(
                    "[catique-hub] upload_attachment_blob: insert failed and \
                     blob cleanup at {} also failed: {rm}",
                    dest.display(),
                );
            }
        })?;
    Ok(attachment)
}

/// Infer a MIME type from a file extension. Falls back to
/// `application/octet-stream` for unrecognised extensions.
fn mime_from_ext(path: &Path) -> &'static str {
    let ext = path
        .extension()
        .and_then(|e| e.to_str())
        .unwrap_or("")
        .to_ascii_lowercase();
    match ext.as_str() {
        "png" => "image/png",
        "jpg" | "jpeg" => "image/jpeg",
        "gif" => "image/gif",
        "webp" => "image/webp",
        "svg" => "image/svg+xml",
        "pdf" => "application/pdf",
        "txt" => "text/plain",
        "md" => "text/markdown",
        "json" => "application/json",
        "csv" => "text/csv",
        "zip" => "application/zip",
        _ => "application/octet-stream",
    }
}

/// Sanitize a filename for use as an on-disk segment. Replaces the
/// characters forbidden by common filesystems with `_`.
fn sanitize_filename(name: &str) -> String {
    name.chars()
        .map(|c| match c {
            '/' | '\\' | ':' | '*' | '?' | '"' | '<' | '>' | '|' => '_',
            other => other,
        })
        .collect()
}

fn add_prompt_tag_arm(pool: &Pool, params: &Value) -> Result<Value, String> {
    let prompt_id = decode_string(params, "prompt_id")?;
    let tag_id = decode_string(params, "tag_id")?;
    let conn = acquire(pool).map_err(|e| format!("db acquire: {e}"))?;
    tags_repo::add_prompt_tag(&conn, &prompt_id, &tag_id).map_err(|e| format!("db: {e}"))?;
    Ok(json!({ "ok": true }))
}

fn remove_prompt_tag_arm(pool: &Pool, params: &Value) -> Result<Value, String> {
    let prompt_id = decode_string(params, "prompt_id")?;
    let tag_id = decode_string(params, "tag_id")?;
    let conn = acquire(pool).map_err(|e| format!("db acquire: {e}"))?;
    let removed =
        tags_repo::remove_prompt_tag(&conn, &prompt_id, &tag_id).map_err(|e| format!("db: {e}"))?;
    if !removed {
        return Err(stringify_app(AppError::NotFound {
            entity: "prompt_tag".into(),
            id: format!("{prompt_id}|{tag_id}"),
        }));
    }
    Ok(json!({ "ok": true }))
}

fn add_role_prompt_arm(pool: &Pool, params: &Value) -> Result<Value, String> {
    let role_id = decode_string(params, "role_id")?;
    let prompt_id = decode_string(params, "prompt_id")?;
    let position = decode_f64(params, "position")?;
    let mut conn = acquire(pool).map_err(|e| format!("db acquire: {e}"))?;
    let tx = conn
        .transaction_with_behavior(rusqlite::TransactionBehavior::Immediate)
        .map_err(|e| format!("db tx: {e}"))?;
    roles_repo::add_role_prompt(&tx, &role_id, &prompt_id, position)
        .map_err(|e| format!("db: {e}"))?;
    cascade_prompt_attachment(
        &tx,
        &AttachScope::Role(role_id.clone()),
        &prompt_id,
        position,
    )
    .map_err(|e| format!("db: {e}"))?;
    tx.commit().map_err(|e| format!("db commit: {e}"))?;
    Ok(json!({ "ok": true }))
}

fn remove_role_prompt_arm(pool: &Pool, params: &Value) -> Result<Value, String> {
    let role_id = decode_string(params, "role_id")?;
    let prompt_id = decode_string(params, "prompt_id")?;
    let mut conn = acquire(pool).map_err(|e| format!("db acquire: {e}"))?;
    let tx = conn
        .transaction_with_behavior(rusqlite::TransactionBehavior::Immediate)
        .map_err(|e| format!("db tx: {e}"))?;
    let removed = roles_repo::remove_role_prompt(&tx, &role_id, &prompt_id)
        .map_err(|e| format!("db: {e}"))?;
    if !removed {
        return Err(stringify_app(AppError::NotFound {
            entity: "role_prompt".into(),
            id: format!("{role_id}|{prompt_id}"),
        }));
    }
    cascade_prompt_detachment(&tx, &AttachScope::Role(role_id.clone()), &prompt_id)
        .map_err(|e| format!("db: {e}"))?;
    tx.commit().map_err(|e| format!("db commit: {e}"))?;
    Ok(json!({ "ok": true }))
}

fn add_role_skill_arm(pool: &Pool, params: &Value) -> Result<Value, String> {
    let role_id = decode_string(params, "role_id")?;
    let skill_id = decode_string(params, "skill_id")?;
    let position = decode_f64(params, "position")?;
    let mut conn = acquire(pool).map_err(|e| format!("db acquire: {e}"))?;
    let tx = conn
        .transaction_with_behavior(rusqlite::TransactionBehavior::Immediate)
        .map_err(|e| format!("db tx: {e}"))?;
    roles_repo::add_role_skill(&tx, &role_id, &skill_id, position)
        .map_err(|e| format!("db: {e}"))?;
    cascade_skill_attachment(
        &tx,
        &AttachScope::Role(role_id.clone()),
        &skill_id,
        position,
    )
    .map_err(|e| format!("db: {e}"))?;
    tx.commit().map_err(|e| format!("db commit: {e}"))?;
    Ok(json!({ "ok": true }))
}

fn remove_role_skill_arm(pool: &Pool, params: &Value) -> Result<Value, String> {
    let role_id = decode_string(params, "role_id")?;
    let skill_id = decode_string(params, "skill_id")?;
    let mut conn = acquire(pool).map_err(|e| format!("db acquire: {e}"))?;
    let tx = conn
        .transaction_with_behavior(rusqlite::TransactionBehavior::Immediate)
        .map_err(|e| format!("db tx: {e}"))?;
    let removed =
        roles_repo::remove_role_skill(&tx, &role_id, &skill_id).map_err(|e| format!("db: {e}"))?;
    if !removed {
        return Err(stringify_app(AppError::NotFound {
            entity: "role_skill".into(),
            id: format!("{role_id}|{skill_id}"),
        }));
    }
    cascade_skill_detachment(&tx, &AttachScope::Role(role_id.clone()), &skill_id)
        .map_err(|e| format!("db: {e}"))?;
    tx.commit().map_err(|e| format!("db commit: {e}"))?;
    Ok(json!({ "ok": true }))
}

fn add_role_mcp_tool_arm(pool: &Pool, params: &Value) -> Result<Value, String> {
    let role_id = decode_string(params, "role_id")?;
    let mcp_tool_id = decode_string(params, "mcp_tool_id")?;
    let position = decode_f64(params, "position")?;
    let mut conn = acquire(pool).map_err(|e| format!("db acquire: {e}"))?;
    let tx = conn
        .transaction_with_behavior(rusqlite::TransactionBehavior::Immediate)
        .map_err(|e| format!("db tx: {e}"))?;
    roles_repo::add_role_mcp_tool(&tx, &role_id, &mcp_tool_id, position)
        .map_err(|e| format!("db: {e}"))?;
    cascade_mcp_tool_attachment(
        &tx,
        &AttachScope::Role(role_id.clone()),
        &mcp_tool_id,
        position,
    )
    .map_err(|e| format!("db: {e}"))?;
    tx.commit().map_err(|e| format!("db commit: {e}"))?;
    Ok(json!({ "ok": true }))
}

fn remove_role_mcp_tool_arm(pool: &Pool, params: &Value) -> Result<Value, String> {
    let role_id = decode_string(params, "role_id")?;
    let mcp_tool_id = decode_string(params, "mcp_tool_id")?;
    let mut conn = acquire(pool).map_err(|e| format!("db acquire: {e}"))?;
    let tx = conn
        .transaction_with_behavior(rusqlite::TransactionBehavior::Immediate)
        .map_err(|e| format!("db tx: {e}"))?;
    let removed = roles_repo::remove_role_mcp_tool(&tx, &role_id, &mcp_tool_id)
        .map_err(|e| format!("db: {e}"))?;
    if !removed {
        return Err(stringify_app(AppError::NotFound {
            entity: "role_mcp_tool".into(),
            id: format!("{role_id}|{mcp_tool_id}"),
        }));
    }
    cascade_mcp_tool_detachment(&tx, &AttachScope::Role(role_id.clone()), &mcp_tool_id)
        .map_err(|e| format!("db: {e}"))?;
    tx.commit().map_err(|e| format!("db commit: {e}"))?;
    Ok(json!({ "ok": true }))
}

fn delete_skill_arm(pool: &Pool, params: &Value) -> Result<Value, String> {
    let id = decode_string(params, "id")?;
    let data_root = app_data_dir().map_err(|reason| {
        stringify_app(AppError::Validation {
            field: "target_data_dir".into(),
            reason: reason.to_owned(),
        })
    })?;
    SkillsUseCase::new(pool)
        .delete_with_blobs(&id, &data_root)
        .map_err(stringify_app)?;
    Ok(json!({ "ok": true }))
}

fn add_skill_file_attachment_arm(pool: &Pool, params: &Value) -> Result<Value, String> {
    let skill_id = decode_string(params, "skill_id")?;
    let filename = decode_string(params, "filename")?;
    let mime_type = decode_string(params, "mime_type")?;
    let base64_bytes = decode_string(params, "base64_bytes")?;
    let bytes = BASE64.decode(base64_bytes.as_bytes()).map_err(|e| {
        stringify_app(AppError::Validation {
            field: "base64_bytes".into(),
            reason: format!("not valid base64: {e}"),
        })
    })?;
    let data_root = app_data_dir().map_err(|reason| {
        stringify_app(AppError::Validation {
            field: "target_data_dir".into(),
            reason: reason.to_owned(),
        })
    })?;
    let att = SkillsUseCase::new(pool)
        .add_file_attachment(&skill_id, filename, mime_type, bytes, &data_root)
        .map_err(stringify_app)?;
    json_or_err(&att)
}

fn add_skill_git_attachment_arm(pool: &Pool, params: &Value) -> Result<Value, String> {
    let skill_id = decode_string(params, "skill_id")?;
    let git_url = decode_string(params, "git_url")?;
    let git_ref = decode_optional_string(params, "git_ref");
    let git_path = decode_optional_string(params, "git_path");
    let att = SkillsUseCase::new(pool)
        .add_git_attachment(&skill_id, git_url, git_ref, git_path)
        .map_err(stringify_app)?;
    json_or_err(&att)
}

fn add_skill_step_arm(pool: &Pool, params: &Value) -> Result<Value, String> {
    let skill_id = decode_string(params, "skill_id")?;
    let title = decode_string(params, "title")?;
    let body = decode_optional_string(params, "body").unwrap_or_default();
    let expected_outcome = decode_optional_string(params, "expected_outcome");
    let position = decode_optional_f64(params, "position");
    let step = SkillStepsUseCase::new(pool)
        .add_step(&skill_id, title, body, expected_outcome, position)
        .map_err(stringify_app)?;
    json_or_err(&step)
}

fn update_skill_step_arm(pool: &Pool, params: &Value) -> Result<Value, String> {
    let id = decode_string(params, "id")?;
    let title = decode_optional_string(params, "title");
    let body = decode_optional_string(params, "body");
    let expected_outcome = decode_tri_state_string(params, "expected_outcome");
    let position = decode_optional_f64(params, "position");
    let step = SkillStepsUseCase::new(pool)
        .update_step(&id, title, body, expected_outcome, position)
        .map_err(stringify_app)?;
    json_or_err(&step)
}

fn delete_skill_step_arm(pool: &Pool, params: &Value) -> Result<Value, String> {
    let id = decode_string(params, "id")?;
    SkillStepsUseCase::new(pool)
        .delete_step(&id)
        .map_err(stringify_app)?;
    Ok(json!({ "ok": true }))
}

fn reorder_skill_steps_arm(pool: &Pool, params: &Value) -> Result<Value, String> {
    let skill_id = decode_string(params, "skill_id")?;
    let step_ids = decode_string_array(params, "step_ids")?;
    SkillStepsUseCase::new(pool)
        .reorder_steps(&skill_id, &step_ids)
        .map_err(stringify_app)?;
    Ok(json!({ "ok": true }))
}

fn remove_skill_attachment_arm(pool: &Pool, params: &Value) -> Result<Value, String> {
    let attachment_id = decode_string(params, "attachment_id")?;
    let data_root = app_data_dir().map_err(|reason| {
        stringify_app(AppError::Validation {
            field: "target_data_dir".into(),
            reason: reason.to_owned(),
        })
    })?;
    SkillsUseCase::new(pool)
        .remove_attachment(&attachment_id, &data_root)
        .map_err(stringify_app)?;
    Ok(json!({ "ok": true }))
}

fn create_mcp_server_arm(pool: &Pool, params: &Value) -> Result<Value, String> {
    let name = decode_string(params, "name")?;
    let transport = decode_transport(params, "transport")?;
    let url = decode_optional_string(params, "url");
    let command = decode_optional_string(params, "command");
    let auth_json = decode_optional_string(params, "auth_json");
    let enabled = params
        .get("enabled")
        .and_then(Value::as_bool)
        .unwrap_or(true);
    let server = McpServersUseCase::new(pool)
        .create(name, transport, url, command, auth_json, enabled)
        .map_err(stringify_app)?;
    json_or_err(&server)
}

fn update_mcp_server_arm(pool: &Pool, params: &Value) -> Result<Value, String> {
    let id = decode_string(params, "id")?;
    let name = decode_optional_string(params, "name");
    let transport = decode_optional_transport(params, "transport")?;
    let url = decode_tri_state_string(params, "url");
    let command = decode_tri_state_string(params, "command");
    let auth_json = decode_tri_state_string(params, "auth_json");
    let enabled = params.get("enabled").and_then(Value::as_bool);
    let server = McpServersUseCase::new(pool)
        .update(id, name, transport, url, command, auth_json, enabled)
        .map_err(stringify_app)?;
    json_or_err(&server)
}

fn decode_transport(params: &Value, field: &str) -> Result<Transport, String> {
    let raw = decode_string(params, field)?;
    parse_transport(&raw, field)
}

fn decode_optional_transport(params: &Value, field: &str) -> Result<Option<Transport>, String> {
    match params.get(field) {
        None | Some(Value::Null) => Ok(None),
        Some(Value::String(s)) => parse_transport(s, field).map(Some),
        Some(_) => Err(format!(
            "validation failed on `{field}`: must be one of \"stdio\", \"http\", \"sse\""
        )),
    }
}

fn parse_transport(raw: &str, field: &str) -> Result<Transport, String> {
    match raw {
        "stdio" => Ok(Transport::Stdio),
        "http" => Ok(Transport::Http),
        "sse" => Ok(Transport::Sse),
        other => Err(format!(
            "validation failed on `{field}`: unknown transport `{other}` (allowed: \"stdio\", \"http\", \"sse\")"
        )),
    }
}

// =====================================================================
// Param-decoding helpers.
// =====================================================================

/// Decode a required string field from the inbound `params` object.
///
/// Returns a stable error message that the MCP client surfaces; the
/// shape mirrors `AppError::Validation { field, reason }` so callers
/// can grep the same way.
///
/// # Errors
///
/// Returns an error string when the field is missing or not a JSON
/// string.
pub fn decode_string(params: &Value, field: &str) -> Result<String, String> {
    params
        .get(field)
        .and_then(Value::as_str)
        .map(str::to_owned)
        .ok_or_else(|| format!("validation failed on `{field}`: missing or non-string"))
}

/// Decode a required `i64` field.
///
/// # Errors
///
/// Returns an error string when the field is missing or non-integer.
pub fn decode_i64(params: &Value, field: &str) -> Result<i64, String> {
    params
        .get(field)
        .and_then(Value::as_i64)
        .ok_or_else(|| format!("validation failed on `{field}`: missing or non-integer"))
}

/// Decode a required `f64` field. Integer JSON numbers are accepted.
///
/// # Errors
///
/// Returns an error string when the field is missing or non-number.
pub fn decode_f64(params: &Value, field: &str) -> Result<f64, String> {
    params
        .get(field)
        .and_then(Value::as_f64)
        .ok_or_else(|| format!("validation failed on `{field}`: missing or non-number"))
}

/// Decode a required `bool` field.
///
/// # Errors
///
/// Returns an error string when the field is missing or non-bool.
pub fn decode_bool(params: &Value, field: &str) -> Result<bool, String> {
    params
        .get(field)
        .and_then(Value::as_bool)
        .ok_or_else(|| format!("validation failed on `{field}`: missing or non-bool"))
}

/// Decode a required `Vec<String>`. Empty arrays accepted.
///
/// # Errors
///
/// Returns an error string when the field is missing, non-array, or
/// contains a non-string element.
pub fn decode_string_array(params: &Value, field: &str) -> Result<Vec<String>, String> {
    let arr = params
        .get(field)
        .and_then(Value::as_array)
        .ok_or_else(|| format!("validation failed on `{field}`: missing or non-array"))?;
    let mut out = Vec::with_capacity(arr.len());
    for entry in arr {
        let s = entry.as_str().ok_or_else(|| {
            format!("validation failed on `{field}`: array element is non-string")
        })?;
        out.push(s.to_owned());
    }
    Ok(out)
}

/// Decode an optional `Vec<String>`. Missing key OR JSON `null` → `None`;
/// `[]` is `Some(vec![])`.
#[must_use]
pub fn decode_optional_string_array(params: &Value, field: &str) -> Option<Vec<String>> {
    let arr = params.get(field).and_then(Value::as_array)?;
    let mut out = Vec::with_capacity(arr.len());
    for entry in arr {
        if let Some(s) = entry.as_str() {
            out.push(s.to_owned());
        }
    }
    Some(out)
}

/// Decode an `Option<String>`. Missing key OR JSON `null` → `None`.
#[must_use]
pub fn decode_optional_string(params: &Value, field: &str) -> Option<String> {
    params.get(field).and_then(Value::as_str).map(str::to_owned)
}

/// Decode an `Option<f64>`. Missing key OR `null` → `None`.
#[must_use]
pub fn decode_optional_f64(params: &Value, field: &str) -> Option<f64> {
    params.get(field).and_then(Value::as_f64)
}

/// Decode an `Option<i64>`. Missing key OR `null` → `None`.
#[must_use]
pub fn decode_optional_i64(params: &Value, field: &str) -> Option<i64> {
    params.get(field).and_then(Value::as_i64)
}

/// Decode an `Option<Option<String>>` clearable field. Missing → `None`,
/// JSON `null` → `Some(None)`, string → `Some(Some(_))`.
#[allow(clippy::option_option)]
#[must_use]
pub fn decode_tri_state_string(params: &Value, field: &str) -> Option<Option<String>> {
    match params.get(field) {
        Some(Value::Null) => Some(None),
        Some(Value::String(s)) => Some(Some(s.clone())),
        None | Some(_) => None,
    }
}

/// Serialize a value into JSON, mapping serde errors to a stable
/// human-readable string.
///
/// # Errors
///
/// Returns an error string if `serde_json::to_value` fails.
pub fn json_or_err<T: serde::Serialize>(value: &T) -> Result<Value, String> {
    serde_json::to_value(value).map_err(|e| format!("serialization error: {e}"))
}

/// Render an [`AppError`] for the MCP client. We pass the JSON-shape
/// through so a future MCP-side renderer can inspect `kind`/`data`.
#[allow(clippy::needless_pass_by_value)]
#[must_use]
pub fn stringify_app(err: AppError) -> String {
    let message = err.to_string();
    serde_json::to_string(&json!({
        "kind": "AppError",
        "error": err,
        "message": message,
    }))
    .unwrap_or(message)
}

// =====================================================================
// Cross-process event-log publish — mirrors IPC handler `events::emit`
// calls so the standalone `catique-hub-mcp` binary reaches the same
// realtime channel via `change_events` + the Tauri-shell tail task.
//
// Keep the constants below in sync with `crates/api/src/events.rs`
// (and the three `mcp_server:*` strings in
// `crates/api/src/handlers/mcp_servers.rs`). `catique-application`
// must NOT depend on `catique-api` (it would create a cycle —
// `catique-api` depends on this crate), so we duplicate the strings
// here behind a doc-pointer to the source of truth.
// =====================================================================

#[allow(dead_code)] // some constants are placeholders for arms not yet in dispatch (update_role_note, delete_role_note, …); kept in lock-step with `crates/api/src/events.rs`.
mod ev {
    //! Event-name constants. Mirror of `catique_api::events::*` —
    //! kept in this crate so `mcp_dispatch` can publish to the
    //! cross-process bus without pulling in the api crate.
    //!
    //! When adding a new entry, also append it to
    //! `crates/api/src/events.rs` so the in-process handler path
    //! agrees with the cross-process bus.

    // Boards / columns / tasks
    pub const BOARD_CREATED: &str = "board:created";
    pub const BOARD_UPDATED: &str = "board:updated";
    pub const BOARD_DELETED: &str = "board:deleted";
    pub const COLUMN_CREATED: &str = "column:created";
    pub const COLUMN_UPDATED: &str = "column:updated";
    pub const COLUMN_DELETED: &str = "column:deleted";
    pub const TASK_CREATED: &str = "task:created";
    pub const TASK_UPDATED: &str = "task:updated";
    pub const TASK_MOVED: &str = "task:moved";
    pub const TASK_DELETED: &str = "task:deleted";

    // Spaces / prompts / roles / tags
    pub const SPACE_CREATED: &str = "space:created";
    pub const SPACE_UPDATED: &str = "space:updated";
    pub const SPACE_DELETED: &str = "space:deleted";
    pub const PROMPT_CREATED: &str = "prompt:created";
    pub const PROMPT_UPDATED: &str = "prompt:updated";
    pub const PROMPT_DELETED: &str = "prompt:deleted";
    pub const ROLE_CREATED: &str = "role:created";
    pub const ROLE_UPDATED: &str = "role:updated";
    pub const ROLE_DELETED: &str = "role:deleted";
    pub const ROLE_NOTE_CREATED: &str = "role_note:created";
    pub const ROLE_NOTE_UPDATED: &str = "role_note:updated";
    pub const ROLE_NOTE_DELETED: &str = "role_note:deleted";
    pub const TAG_CREATED: &str = "tag:created";
    pub const TAG_UPDATED: &str = "tag:updated";
    pub const TAG_DELETED: &str = "tag:deleted";

    // Skills + steps + attachments + import
    pub const SKILL_CREATED: &str = "skill:created";
    pub const SKILL_UPDATED: &str = "skill:updated";
    pub const SKILL_DELETED: &str = "skill:deleted";
    pub const SKILL_ATTACHMENT_ADDED: &str = "skill:attachment_added";
    pub const SKILL_ATTACHMENT_REMOVED: &str = "skill:attachment_removed";
    pub const SKILL_IMPORTED: &str = "skill:imported";
    pub const SKILL_STEP_CREATED: &str = "skill_step:created";
    pub const SKILL_STEP_UPDATED: &str = "skill_step:updated";
    pub const SKILL_STEP_DELETED: &str = "skill_step:deleted";

    // MCP tools / servers
    pub const MCP_TOOL_CREATED: &str = "mcp_tool:created";
    pub const MCP_TOOL_UPDATED: &str = "mcp_tool:updated";
    pub const MCP_TOOL_DELETED: &str = "mcp_tool:deleted";
    pub const MCP_SERVER_CREATED: &str = "mcp_server:created";
    pub const MCP_SERVER_UPDATED: &str = "mcp_server:updated";
    pub const MCP_SERVER_DELETED: &str = "mcp_server:deleted";

    // Prompt groups
    pub const PROMPT_GROUP_CREATED: &str = "prompt_group:created";
    pub const PROMPT_GROUP_UPDATED: &str = "prompt_group:updated";
    pub const PROMPT_GROUP_DELETED: &str = "prompt_group:deleted";
    pub const PROMPT_GROUP_MEMBERS_CHANGED: &str = "prompt_group:members_changed";

    // Agent reports + attachments
    pub const AGENT_REPORT_CREATED: &str = "agent_report:created";
    pub const AGENT_REPORT_UPDATED: &str = "agent_report:updated";
    pub const AGENT_REPORT_DELETED: &str = "agent_report:deleted";
    pub const ATTACHMENT_CREATED: &str = "attachment:created";
    pub const ATTACHMENT_UPDATED: &str = "attachment:updated";
    pub const ATTACHMENT_DELETED: &str = "attachment:deleted";

    // Connected providers
    pub const CONNECTED_PROVIDER_ADDED: &str = "connected_provider:added";
    pub const CONNECTED_PROVIDER_REMOVED: &str = "connected_provider:removed";
}

/// Map an `(method, params, result)` triple to the realtime event
/// the matching IPC handler would have emitted — see
/// `crates/api/src/handlers/*.rs` for the canonical (name, payload)
/// pairs. Returns one or more `(event_name, payload)` tuples; methods
/// that do not mutate state (reads, settings writes, etc.) return an
/// empty slice.
///
/// We return a `Vec` (rather than `Option<(name, payload)>`) so the
/// few paths that fan out (`add_skill_step` → both `skill_step:*` and
/// `skill:updated`; `reorder_skill_steps` → one update per step) can
/// share the helper without a second branch.
///
/// Best-effort: when expected fields are missing from `result` the
/// helper returns an empty vec rather than panicking. The MCP dispatch
/// caller treats an empty vec as "nothing to publish".
#[allow(clippy::too_many_lines)]
fn map_method_to_events(method: &str, params: &Value, result: &Value) -> Vec<(&'static str, Value)> {
    let id_from_result = || result.get("id").and_then(Value::as_str).map(str::to_owned);
    let id_from_params = || params.get("id").and_then(Value::as_str).map(str::to_owned);

    match method {
        // -------- create_* (id comes from the returned entity) --------
        "create_board" => match id_from_result() {
            Some(id) => vec![(ev::BOARD_CREATED, json!({ "id": id }))],
            None => Vec::new(),
        },
        "create_column" => {
            let id = result.get("id").and_then(Value::as_str);
            let board_id = result.get("boardId").and_then(Value::as_str);
            match (id, board_id) {
                (Some(id), Some(bid)) => vec![(
                    ev::COLUMN_CREATED,
                    json!({ "id": id, "board_id": bid }),
                )],
                _ => Vec::new(),
            }
        }
        "create_task" => {
            let id = result.get("id").and_then(Value::as_str);
            let column_id = result.get("columnId").and_then(Value::as_str);
            let board_id = result.get("boardId").and_then(Value::as_str);
            match (id, column_id, board_id) {
                (Some(id), Some(cid), Some(bid)) => vec![(
                    ev::TASK_CREATED,
                    json!({ "id": id, "column_id": cid, "board_id": bid }),
                )],
                _ => Vec::new(),
            }
        }
        "create_space" => match id_from_result() {
            Some(id) => vec![(ev::SPACE_CREATED, json!({ "id": id }))],
            None => Vec::new(),
        },
        "create_prompt" => match id_from_result() {
            Some(id) => vec![(ev::PROMPT_CREATED, json!({ "id": id }))],
            None => Vec::new(),
        },
        "create_prompt_group" => match id_from_result() {
            Some(id) => vec![(ev::PROMPT_GROUP_CREATED, json!({ "id": id }))],
            None => Vec::new(),
        },
        "create_role" => match id_from_result() {
            Some(id) => vec![(ev::ROLE_CREATED, json!({ "id": id }))],
            None => Vec::new(),
        },
        "create_skill" => match id_from_result() {
            Some(id) => vec![(ev::SKILL_CREATED, json!({ "id": id }))],
            None => Vec::new(),
        },
        "create_tag" => match id_from_result() {
            Some(id) => vec![(ev::TAG_CREATED, json!({ "id": id }))],
            None => Vec::new(),
        },
        "create_mcp_server" => match id_from_result() {
            Some(id) => vec![(ev::MCP_SERVER_CREATED, json!({ "id": id }))],
            None => Vec::new(),
        },
        "create_mcp_tool" => match id_from_result() {
            Some(id) => vec![(ev::MCP_TOOL_CREATED, json!({ "id": id }))],
            None => Vec::new(),
        },
        "create_agent_report" => {
            let id = result.get("id").and_then(Value::as_str);
            let task_id = result.get("taskId").and_then(Value::as_str);
            match (id, task_id) {
                (Some(id), Some(tid)) => vec![(
                    ev::AGENT_REPORT_CREATED,
                    json!({ "id": id, "task_id": tid }),
                )],
                _ => Vec::new(),
            }
        }
        "create_attachment" | "upload_attachment" | "upload_attachment_blob" => {
            let id = result.get("id").and_then(Value::as_str);
            let task_id = result.get("taskId").and_then(Value::as_str);
            match (id, task_id) {
                (Some(id), Some(tid)) => vec![(
                    ev::ATTACHMENT_CREATED,
                    json!({ "id": id, "task_id": tid }),
                )],
                _ => Vec::new(),
            }
        }

        // -------- update_* (id comes from params; some entities carry extra fields) --------
        "update_board" => match id_from_params() {
            Some(id) => vec![(ev::BOARD_UPDATED, json!({ "id": id }))],
            None => Vec::new(),
        },
        "update_column" => {
            let id = result.get("id").and_then(Value::as_str);
            let board_id = result.get("boardId").and_then(Value::as_str);
            match (id, board_id) {
                (Some(id), Some(bid)) => vec![(
                    ev::COLUMN_UPDATED,
                    json!({ "id": id, "board_id": bid }),
                )],
                _ => Vec::new(),
            }
        }
        "update_task" => {
            let id = result.get("id").and_then(Value::as_str);
            let column_id = result.get("columnId").and_then(Value::as_str);
            let board_id = result.get("boardId").and_then(Value::as_str);
            match (id, column_id, board_id) {
                (Some(id), Some(cid), Some(bid)) => vec![(
                    ev::TASK_UPDATED,
                    json!({ "id": id, "column_id": cid, "board_id": bid }),
                )],
                _ => Vec::new(),
            }
        }
        // catique-8: urgency mutation is a flavour of task update for
        // the UI listener — we don't carry urgency in the payload yet
        // because the frontend invalidator already refetches the task
        // body on `task:updated`.
        "set_task_urgency" => match id_from_params() {
            Some(id) => vec![(ev::TASK_UPDATED, json!({ "id": id }))],
            None => Vec::new(),
        },
        // catique-1 / catique-5: writes through to disk; from the
        // UI's perspective the space stayed the same shape but its
        // bound agent file changed. Emit `space:updated` so any
        // dependent panel (project folder badge, sync-state ribbon)
        // can re-fetch.
        "sync_owner_to_agent_file" | "sync_workflow_to_agent_file" => {
            match params.get("space_id").and_then(Value::as_str) {
                Some(id) => vec![(ev::SPACE_UPDATED, json!({ "id": id }))],
                None => Vec::new(),
            }
        }
        "update_space" => match id_from_params() {
            Some(id) => vec![(ev::SPACE_UPDATED, json!({ "id": id }))],
            None => Vec::new(),
        },
        "update_prompt" | "recompute_prompt_token_count" => match id_from_params() {
            Some(id) => vec![(ev::PROMPT_UPDATED, json!({ "id": id }))],
            None => Vec::new(),
        },
        "update_prompt_group" => match id_from_params() {
            Some(id) => vec![(ev::PROMPT_GROUP_UPDATED, json!({ "id": id }))],
            None => Vec::new(),
        },
        "update_role" => match id_from_params() {
            Some(id) => vec![(ev::ROLE_UPDATED, json!({ "id": id }))],
            None => Vec::new(),
        },
        "update_skill" => match id_from_params() {
            Some(id) => vec![(ev::SKILL_UPDATED, json!({ "id": id }))],
            None => Vec::new(),
        },
        "update_tag" => match id_from_params() {
            Some(id) => vec![(ev::TAG_UPDATED, json!({ "id": id }))],
            None => Vec::new(),
        },
        "update_mcp_server" => match id_from_params() {
            Some(id) => vec![(ev::MCP_SERVER_UPDATED, json!({ "id": id }))],
            None => Vec::new(),
        },
        "update_mcp_tool" => match id_from_params() {
            Some(id) => vec![(ev::MCP_TOOL_UPDATED, json!({ "id": id }))],
            None => Vec::new(),
        },
        "update_agent_report" => {
            let id = result.get("id").and_then(Value::as_str);
            let task_id = result.get("taskId").and_then(Value::as_str);
            match (id, task_id) {
                (Some(id), Some(tid)) => vec![(
                    ev::AGENT_REPORT_UPDATED,
                    json!({ "id": id, "task_id": tid }),
                )],
                _ => Vec::new(),
            }
        }
        "update_attachment" => {
            let id = result.get("id").and_then(Value::as_str);
            let task_id = result.get("taskId").and_then(Value::as_str);
            match (id, task_id) {
                (Some(id), Some(tid)) => vec![(
                    ev::ATTACHMENT_UPDATED,
                    json!({ "id": id, "task_id": tid }),
                )],
                _ => Vec::new(),
            }
        }
        // -------- delete_* (id from params; entity-coupled payloads
        // copy the IPC handler's GET-before-delete shape — we cannot
        // recreate it without the deleted row, so we fall back to the
        // minimum `{ id }` payload that the frontend listeners tolerate) --------
        "delete_board" => match id_from_params() {
            Some(id) => vec![(ev::BOARD_DELETED, json!({ "id": id }))],
            None => Vec::new(),
        },
        "delete_column" => match id_from_params() {
            Some(id) => vec![(ev::COLUMN_DELETED, json!({ "id": id }))],
            None => Vec::new(),
        },
        "delete_task" => match id_from_params() {
            Some(id) => vec![(ev::TASK_DELETED, json!({ "id": id }))],
            None => Vec::new(),
        },
        "delete_space" => match id_from_params() {
            Some(id) => vec![(ev::SPACE_DELETED, json!({ "id": id }))],
            None => Vec::new(),
        },
        "delete_prompt" => match id_from_params() {
            Some(id) => vec![(ev::PROMPT_DELETED, json!({ "id": id }))],
            None => Vec::new(),
        },
        "delete_prompt_group" => match id_from_params() {
            Some(id) => vec![(ev::PROMPT_GROUP_DELETED, json!({ "id": id }))],
            None => Vec::new(),
        },
        "delete_role" => match id_from_params() {
            Some(id) => vec![(ev::ROLE_DELETED, json!({ "id": id }))],
            None => Vec::new(),
        },
        "delete_skill" => match id_from_params() {
            Some(id) => vec![(ev::SKILL_DELETED, json!({ "id": id }))],
            None => Vec::new(),
        },
        "delete_tag" => match id_from_params() {
            Some(id) => vec![(ev::TAG_DELETED, json!({ "id": id }))],
            None => Vec::new(),
        },
        "delete_mcp_server" => match id_from_params() {
            Some(id) => vec![(ev::MCP_SERVER_DELETED, json!({ "id": id }))],
            None => Vec::new(),
        },
        "delete_mcp_tool" => match id_from_params() {
            Some(id) => vec![(ev::MCP_TOOL_DELETED, json!({ "id": id }))],
            None => Vec::new(),
        },
        "delete_agent_report" => match id_from_params() {
            Some(id) => vec![(ev::AGENT_REPORT_DELETED, json!({ "id": id }))],
            None => Vec::new(),
        },
        "delete_attachment" => match id_from_params() {
            Some(id) => vec![(ev::ATTACHMENT_DELETED, json!({ "id": id }))],
            None => Vec::new(),
        },

        // -------- role notes (handler shape: `{ roleId, noteId }`) --------
        "add_role_note" => {
            let role_id = result.get("roleId").and_then(Value::as_str);
            let note_id = result.get("id").and_then(Value::as_str);
            match (role_id, note_id) {
                (Some(rid), Some(nid)) => vec![(
                    ev::ROLE_NOTE_CREATED,
                    json!({ "roleId": rid, "noteId": nid }),
                )],
                _ => Vec::new(),
            }
        }

        // -------- skill attachments / steps / import --------
        "add_skill_file_attachment" | "add_skill_git_attachment" => {
            let skill_id = result.get("skillId").and_then(Value::as_str);
            let att_id = result.get("id").and_then(Value::as_str);
            match (skill_id, att_id) {
                (Some(sid), Some(aid)) => vec![(
                    ev::SKILL_ATTACHMENT_ADDED,
                    json!({ "skillId": sid, "attachmentId": aid }),
                )],
                _ => Vec::new(),
            }
        }
        "remove_skill_attachment" => {
            // `params.attachment_id` is all we have — the use case
            // returns `{ ok: true }`. Frontend listener keys off
            // `attachmentId` only.
            let att_id = params
                .get("attachment_id")
                .and_then(Value::as_str)
                .map(str::to_owned);
            match att_id {
                Some(aid) => vec![(
                    ev::SKILL_ATTACHMENT_REMOVED,
                    json!({ "attachmentId": aid }),
                )],
                None => Vec::new(),
            }
        }
        "import_skill_from_url" => {
            // `import_skill_from_url_arm` returns the full
            // `ImportReport` — same envelope the handler emits.
            let skill_id = result.get("skillId").and_then(Value::as_str);
            match skill_id {
                Some(sid) => vec![(
                    ev::SKILL_IMPORTED,
                    json!({ "skillId": sid, "importReport": result.clone() }),
                )],
                None => Vec::new(),
            }
        }
        "add_skill_step" => {
            let skill = result.get("skillId").and_then(Value::as_str);
            let step = result.get("id").and_then(Value::as_str);
            match (skill, step) {
                (Some(skill), Some(step)) => vec![(
                    ev::SKILL_STEP_CREATED,
                    json!({ "skillId": skill, "stepId": step }),
                )],
                _ => Vec::new(),
            }
        }
        "update_skill_step" => {
            let skill = result.get("skillId").and_then(Value::as_str);
            let step = result.get("id").and_then(Value::as_str);
            match (skill, step) {
                (Some(skill), Some(step)) => vec![(
                    ev::SKILL_STEP_UPDATED,
                    json!({ "skillId": skill, "stepId": step }),
                )],
                _ => Vec::new(),
            }
        }
        "delete_skill_step" => {
            // Step id is the only field we have (use case returns
            // `{ ok: true }`). Skill id is unrecoverable from this
            // call site — emit the bare `{ stepId }` envelope; the
            // frontend's step-list listener uses `stepId` as the
            // invalidation key.
            let step_id = id_from_params();
            match step_id {
                Some(stid) => vec![(
                    ev::SKILL_STEP_DELETED,
                    json!({ "stepId": stid }),
                )],
                None => Vec::new(),
            }
        }
        "reorder_skill_steps" => {
            // Fan out one `skill_step:updated` per supplied step id so
            // id-keyed react-query caches refresh — matches the
            // handler's shape (`handlers/skills.rs:434`).
            let skill_id = params
                .get("skill_id")
                .and_then(Value::as_str)
                .map(str::to_owned);
            let step_ids = params
                .get("step_ids")
                .and_then(Value::as_array)
                .map(|arr| {
                    arr.iter()
                        .filter_map(|v| v.as_str().map(str::to_owned))
                        .collect::<Vec<_>>()
                })
                .unwrap_or_default();
            match skill_id {
                Some(sid) => step_ids
                    .into_iter()
                    .map(|stid| {
                        (
                            ev::SKILL_STEP_UPDATED,
                            json!({ "skillId": sid, "stepId": stid }),
                        )
                    })
                    .collect(),
                None => Vec::new(),
            }
        }

        // -------- task lifecycle (move + route + rate + log + override) --------
        "move_task" => {
            // `move_task_arm` returns the post-move Task. The handler
            // also emits a `task:moved` on column change, but we
            // cannot detect "did the column change" without a
            // pre-move snapshot — the use case already committed by
            // this point. Emit `task:updated` unconditionally; emit
            // `task:moved` whenever the result carries both
            // `column_id` and `board_id` AND the caller supplied a
            // `column_id` param different from the result's. As a
            // floor: always fire `task:updated` so cache invalidates.
            let id = result.get("id").and_then(Value::as_str);
            let column_id = result.get("columnId").and_then(Value::as_str);
            let board_id = result.get("boardId").and_then(Value::as_str);
            match (id, column_id, board_id) {
                (Some(id), Some(cid), Some(bid)) => {
                    let mut out = vec![(
                        ev::TASK_UPDATED,
                        json!({ "id": id, "column_id": cid, "board_id": bid }),
                    )];
                    // Best-effort move event — we don't know the
                    // "from" column without a pre-snapshot. Emit
                    // with `from_column_id` set to the param value
                    // when it differs from the result (caller-side
                    // expectation); otherwise skip the move event
                    // and let the `task:updated` carry invalidation.
                    out.push((
                        ev::TASK_MOVED,
                        json!({
                            "id": id,
                            "from_column_id": Value::Null,
                            "to_column_id": cid,
                            "board_id": bid,
                        }),
                    ));
                    out
                }
                _ => Vec::new(),
            }
        }
        "route_task_to_board" => {
            let id = result.get("id").and_then(Value::as_str);
            let column_id = result.get("columnId").and_then(Value::as_str);
            let board_id = result.get("boardId").and_then(Value::as_str);
            match (id, column_id, board_id) {
                (Some(id), Some(cid), Some(bid)) => vec![
                    (
                        ev::TASK_UPDATED,
                        json!({ "id": id, "column_id": cid, "board_id": bid }),
                    ),
                    (
                        ev::TASK_MOVED,
                        json!({
                            "id": id,
                            "from_column_id": Value::Null,
                            "to_column_id": cid,
                            "board_id": bid,
                        }),
                    ),
                ],
                _ => Vec::new(),
            }
        }
        // -------- task lifecycle helpers + task join-tables
        // (prompts + skills + mcp tools). The IPC handlers emit
        // `task:updated` with the full `{ id, column_id, board_id }`
        // shape after a GET — we don't have the column/board here, so
        // emit `{ id }` only; the frontend listener tolerates it.
        "rate_task"
        | "log_step"
        | "set_task_prompt_override"
        | "clear_task_prompt_override"
        | "add_task_prompt"
        | "remove_task_prompt"
        | "add_task_skill"
        | "remove_task_skill"
        | "add_task_mcp_tool"
        | "remove_task_mcp_tool" => {
            let task_id = params
                .get("task_id")
                .and_then(Value::as_str)
                .map(str::to_owned);
            match task_id {
                Some(tid) => vec![(ev::TASK_UPDATED, json!({ "id": tid }))],
                None => Vec::new(),
            }
        }

        // -------- board / column / space / role / tag join-tables --------
        "add_board_prompt" | "remove_board_prompt" | "set_board_prompts" | "set_board_mcp_tools"
        | "set_board_skills" | "set_board_owner" => {
            let board_id = params
                .get("board_id")
                .and_then(Value::as_str)
                .map(str::to_owned);
            match board_id {
                Some(bid) => vec![(ev::BOARD_UPDATED, json!({ "id": bid }))],
                None => Vec::new(),
            }
        }
        "add_column_prompt" | "remove_column_prompt" | "set_column_prompts"
        | "set_column_mcp_tools" | "set_column_skills" => {
            let column_id = params
                .get("column_id")
                .and_then(Value::as_str)
                .map(str::to_owned);
            match column_id {
                Some(cid) => vec![(ev::COLUMN_UPDATED, json!({ "id": cid }))],
                None => Vec::new(),
            }
        }
        "add_space_prompt" | "remove_space_prompt" | "set_space_prompts" | "set_space_mcp_tools"
        | "set_space_skills" | "set_workflow_graph" => {
            let space_id = params
                .get("space_id")
                .and_then(Value::as_str)
                .map(str::to_owned);
            match space_id {
                Some(sid) => vec![(ev::SPACE_UPDATED, json!({ "id": sid }))],
                None => Vec::new(),
            }
        }
        "add_role_prompt" | "remove_role_prompt" | "add_role_skill" | "remove_role_skill"
        | "add_role_mcp_tool" | "remove_role_mcp_tool" | "set_role_prompts" => {
            let role_id = params
                .get("role_id")
                .and_then(Value::as_str)
                .map(str::to_owned);
            match role_id {
                Some(rid) => vec![(ev::ROLE_UPDATED, json!({ "id": rid }))],
                None => Vec::new(),
            }
        }
        "add_prompt_tag" | "remove_prompt_tag" | "set_tag_prompts" => {
            let tag_id = params
                .get("tag_id")
                .and_then(Value::as_str)
                .map(str::to_owned);
            match tag_id {
                Some(tid) => vec![(ev::TAG_UPDATED, json!({ "id": tid }))],
                None => Vec::new(),
            }
        }

        // -------- prompt-group members --------
        "add_prompt_group_member" | "remove_prompt_group_member" | "set_prompt_group_members" => {
            let group_id = params
                .get("group_id")
                .and_then(Value::as_str)
                .map(str::to_owned);
            match group_id {
                Some(gid) => vec![(
                    ev::PROMPT_GROUP_MEMBERS_CHANGED,
                    json!({ "group_id": gid }),
                )],
                None => Vec::new(),
            }
        }

        // -------- connected providers --------
        "add_provider" => {
            let id = params
                .get("id")
                .and_then(Value::as_str)
                .map(str::to_owned);
            match id {
                Some(id) => vec![(ev::CONNECTED_PROVIDER_ADDED, json!({ "id": id }))],
                None => Vec::new(),
            }
        }
        "remove_provider" => {
            let id = params
                .get("id")
                .and_then(Value::as_str)
                .map(str::to_owned);
            match id {
                Some(id) => vec![(ev::CONNECTED_PROVIDER_REMOVED, json!({ "id": id }))],
                None => Vec::new(),
            }
        }

        // -------- MCP server refresh --------
        "refresh_mcp_server" => {
            let id = params
                .get("id")
                .and_then(Value::as_str)
                .map(str::to_owned);
            match id {
                Some(id) => vec![(ev::MCP_SERVER_UPDATED, json!({ "id": id }))],
                None => Vec::new(),
            }
        }

        // Reads / settings writes / proxy calls / keychain resolves /
        // anything else — no event.
        _ => Vec::new(),
    }
}

/// Publish whatever realtime event(s) match `method` to the
/// `change_events` table so the Tauri-shell tail task can re-emit them
/// to the frontend. No-op for read methods. Never panics; every
/// failure path logs to stderr and returns silently — the caller has
/// already committed the underlying use case.
///
/// Use both `params` (for IDs that don't appear in the result, e.g.
/// `delete_*` and join-table arms that return `{ ok: true }`) and
/// `result` (for `create_*` paths that allocate a new id).
pub fn publish_change_for_method(pool: &Pool, method: &str, params: &Value, result: &Value) {
    let events = map_method_to_events(method, params, result);
    if events.is_empty() {
        return;
    }
    let conn = match pool.get() {
        Ok(c) => c,
        Err(e) => {
            eprintln!("[catique-hub] event_log acquire failed: {e}");
            return;
        }
    };
    for (name, payload) in events {
        if let Err(e) = catique_infrastructure::db::event_log::publish(&conn, name, &payload) {
            eprintln!("[catique-hub] event_log publish({name}) failed: {e}");
        }
    }
}

#[cfg(test)]
mod tests {
    //! Smoke tests for the dispatch surface. Coverage focuses on:
    //!
    //!  * tri-state + optional decode shapes,
    //!  * a representative happy path per sub-domain,
    //!  * typed `AppError` envelope shape on contract-bearing edge cases,
    //!  * manifest ↔ dispatch arm name alignment.
    use super::*;
    use catique_infrastructure::db::pool::memory_pool_for_tests;
    use catique_infrastructure::db::runner::run_pending;

    fn fresh_pool_with_role(role_id: &str) -> Pool {
        let pool = memory_pool_for_tests();
        let mut conn = pool.get().unwrap();
        run_pending(&mut conn).unwrap();
        conn.execute(
            "INSERT INTO roles (id, name, content, created_at, updated_at) \
             VALUES (?1, ?1, '', 0, 0)",
            rusqlite::params![role_id],
        )
        .unwrap();
        drop(conn);
        pool
    }

    fn fresh_pool() -> Pool {
        let pool = memory_pool_for_tests();
        let mut conn = pool.get().unwrap();
        run_pending(&mut conn).unwrap();
        drop(conn);
        pool
    }

    #[test]
    fn dispatch_add_role_note_round_trips_via_recall() {
        let pool = fresh_pool_with_role("r1");
        let added = dispatch(
            &pool,
            "add_role_note",
            json!({
                "role_id": "r1",
                "body": "first retrospective",
                "tags": ["rust", "async"],
            }),
        )
        .expect("add_role_note dispatch");
        assert_eq!(added["roleId"], "r1");
        assert_eq!(added["authoredBy"], "agent");

        let recalled = dispatch(
            &pool,
            "recall_role_notes",
            json!({"role_id": "r1", "tags": ["rust"]}),
        )
        .expect("recall_role_notes dispatch");
        let arr = recalled.as_array().expect("array");
        assert_eq!(arr.len(), 1);
        assert_eq!(arr[0]["body"], "first retrospective");
    }

    #[test]
    fn dispatch_unknown_method_returns_error() {
        let pool = fresh_pool();
        let err = dispatch(&pool, "totally_unknown", json!({})).expect_err("unknown");
        assert!(err.contains("Unknown ipc_call method"));
    }

    #[test]
    fn dispatch_create_then_list_prompt_round_trip() {
        let pool = fresh_pool();
        let created = dispatch(
            &pool,
            "create_prompt",
            json!({"name": "P1", "content": "hello"}),
        )
        .expect("create_prompt dispatch");
        let id = created["id"].as_str().expect("id").to_owned();

        let listed = dispatch(&pool, "list_prompts", json!({})).expect("list_prompts dispatch");
        let arr = listed.as_array().expect("array");
        assert_eq!(arr.len(), 1);
        assert_eq!(arr[0]["id"], id);
    }

    #[test]
    fn dispatch_update_prompt_tri_state_clears_via_null() {
        let pool = fresh_pool();
        let created = dispatch(
            &pool,
            "create_prompt",
            json!({"name": "U1", "content": "", "icon": "star"}),
        )
        .unwrap();
        let id = created["id"].as_str().unwrap().to_owned();
        let updated = dispatch(&pool, "update_prompt", json!({"id": id, "icon": null})).unwrap();
        assert!(updated["icon"].is_null());
    }

    #[test]
    fn tool_manifest_parses_and_arms_resolve() {
        // The manifest is the source-of-truth tool list shipped by both
        // the legacy Node sidecar and the new `catique-hub-mcp` binary.
        // Every entry must either resolve through `dispatch` directly
        // OR be one of the four async-only arms gated outside this
        // function.
        let raw = include_str!("../../../sidecar/tool-manifest.json");
        let parsed: serde_json::Value = serde_json::from_str(raw).expect("valid json");
        let pool = fresh_pool();
        let async_only = [
            "add_provider",
            "remove_provider",
            "proxy_tool_call",
            "refresh_mcp_server",
            "import_skill_from_url",
        ];
        for tool in parsed["tools"].as_array().unwrap() {
            let name = tool["name"].as_str().unwrap();
            if async_only.contains(&name) {
                continue;
            }
            let err = dispatch(&pool, name, json!({})).err().unwrap_or_default();
            assert!(
                !err.contains("Unknown ipc_call method"),
                "tool `{name}` declared in manifest has no dispatch arm"
            );
        }
    }

    #[test]
    fn manifest_is_alphabetically_sorted() {
        let raw = include_str!("../../../sidecar/tool-manifest.json");
        let parsed: serde_json::Value = serde_json::from_str(raw).unwrap();
        let names: Vec<&str> = parsed["tools"]
            .as_array()
            .unwrap()
            .iter()
            .map(|t| t["name"].as_str().unwrap())
            .collect();
        let mut sorted = names.clone();
        sorted.sort_unstable();
        assert_eq!(
            names, sorted,
            "tool-manifest.json entries must be ordered alphabetically"
        );
    }
}
