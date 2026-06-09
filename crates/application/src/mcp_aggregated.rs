//! Aggregated entity-level MCP tool dispatch.
//!
//! Collapses the 151 flat method names of [`crate::mcp_dispatch`] into
//! 16 entity-scoped tools that take `{action, ...params}`. The advertised
//! `tools/list` surface shrinks ~9× while every legacy flat name keeps
//! working unchanged via [`crate::mcp_dispatch::dispatch`].
//!
//! The mapping is intentionally a single `match` so the file reads top
//! to bottom: pick an entity, read its actions, see which legacy method
//! each resolves to.

use serde_json::{json, Value};

use catique_infrastructure::db::pool::Pool;

use crate::mcp_dispatch::dispatch;

/// Advertised entity-level tool names. Order matches the manifest
/// block ordering — keep alphabetical for predictable diff noise.
pub const ENTITY_TOOL_NAMES: &[&str] = &[
    "agent_report",
    "attachment",
    "board",
    "column",
    "mcp_server",
    "mcp_tool",
    "project_file",
    "prompt",
    "prompt_group",
    "provider",
    "role",
    "setting",
    "skill",
    "space",
    "tag",
    "task",
    "task_template",
    "workflow",
];

/// Legacy method names that require an async runtime (provider OAuth
/// roundtrips + skill import + sidecar restart). The aggregated sync
/// dispatcher refuses these; the standalone binary handles them via
/// its dedicated `*_arm` async helpers.
pub const ASYNC_LEGACY_METHODS: &[&str] = &[
    "add_provider",
    "remove_provider",
    "import_skill_from_url",
    "refresh_mcp_server",
];

/// `true` if `method` must be dispatched on a tokio runtime.
#[must_use]
pub fn is_async_legacy(method: &str) -> bool {
    ASYNC_LEGACY_METHODS.contains(&method)
}

/// Resolve `(entity, action)` to the underlying flat method name in
/// [`crate::mcp_dispatch::dispatch`]. Returns `None` if the pair is
/// unknown so the caller can produce a contextual error.
#[must_use]
#[allow(clippy::too_many_lines)]
pub fn resolve_legacy_method(entity: &str, action: &str) -> Option<&'static str> {
    match (entity, action) {
        // ---- agent_report ----
        ("agent_report", "create") => Some("create_agent_report"),
        ("agent_report", "update") => Some("update_agent_report"),
        ("agent_report", "delete") => Some("delete_agent_report"),
        ("agent_report", "get") => Some("get_agent_report"),
        ("agent_report", "list") => Some("list_agent_reports"),
        ("agent_report", "search") => Some("search_agent_reports"),

        // ---- attachment ----
        ("attachment", "create") => Some("create_attachment"),
        ("attachment", "update") => Some("update_attachment"),
        ("attachment", "delete") => Some("delete_attachment"),
        ("attachment", "get") => Some("get_attachment"),
        ("attachment", "list") => Some("list_attachments"),
        ("attachment", "upload") => Some("upload_attachment"),
        ("attachment", "upload_blob") => Some("upload_attachment_blob"),

        // ---- board (creation owned by space-create per D-006) ----
        ("board", "create") => Some("create_board"),
        ("board", "get") => Some("get_board"),
        ("board", "list") => Some("list_boards"),
        ("board", "delete") => Some("delete_board"),
        ("board", "set_owner") => Some("set_board_owner"),
        ("board", "add_prompt") => Some("add_board_prompt"),
        ("board", "remove_prompt") => Some("remove_board_prompt"),
        ("board", "set_prompts") => Some("set_board_prompts"),
        ("board", "set_skills") => Some("set_board_skills"),
        ("board", "set_mcp_tools") => Some("set_board_mcp_tools"),

        // ---- column ----
        ("column", "create") => Some("create_column"),
        ("column", "update") => Some("update_column"),
        ("column", "delete") => Some("delete_column"),
        ("column", "get") => Some("get_column"),
        ("column", "list") => Some("list_columns"),
        ("column", "add_prompt") => Some("add_column_prompt"),
        ("column", "remove_prompt") => Some("remove_column_prompt"),
        ("column", "set_prompts") => Some("set_column_prompts"),
        ("column", "set_skills") => Some("set_column_skills"),
        ("column", "set_mcp_tools") => Some("set_column_mcp_tools"),

        // ---- mcp_server (refresh is async — see ASYNC_LEGACY_METHODS) ----
        ("mcp_server", "create") => Some("create_mcp_server"),
        ("mcp_server", "update") => Some("update_mcp_server"),
        ("mcp_server", "delete") => Some("delete_mcp_server"),
        ("mcp_server", "get") => Some("get_mcp_server"),
        ("mcp_server", "list") => Some("list_mcp_servers"),
        ("mcp_server", "get_status") => Some("get_mcp_server_status"),
        ("mcp_server", "refresh") => Some("refresh_mcp_server"),

        // ---- mcp_tool ----
        ("mcp_tool", "create") => Some("create_mcp_tool"),
        ("mcp_tool", "update") => Some("update_mcp_tool"),
        ("mcp_tool", "delete") => Some("delete_mcp_tool"),
        ("mcp_tool", "get") => Some("get_mcp_tool"),
        ("mcp_tool", "list") => Some("list_mcp_tools"),
        ("mcp_tool", "list_by_server") => Some("list_mcp_tools_by_server"),

        // ---- prompt ----
        ("prompt", "create") => Some("create_prompt"),
        ("prompt", "update") => Some("update_prompt"),
        ("prompt", "delete") => Some("delete_prompt"),
        ("prompt", "get") => Some("get_prompt"),
        ("prompt", "list") => Some("list_prompts"),
        ("prompt", "add_tag") => Some("add_prompt_tag"),
        ("prompt", "remove_tag") => Some("remove_prompt_tag"),
        ("prompt", "recompute_token_count") => Some("recompute_prompt_token_count"),

        // ---- prompt_group ----
        ("prompt_group", "create") => Some("create_prompt_group"),
        ("prompt_group", "update") => Some("update_prompt_group"),
        ("prompt_group", "delete") => Some("delete_prompt_group"),
        ("prompt_group", "get") => Some("get_prompt_group"),
        ("prompt_group", "list") => Some("list_prompt_groups"),
        ("prompt_group", "add_member") => Some("add_prompt_group_member"),
        ("prompt_group", "remove_member") => Some("remove_prompt_group_member"),
        ("prompt_group", "list_members") => Some("list_prompt_group_members"),
        ("prompt_group", "set_members") => Some("set_prompt_group_members"),

        // ---- provider (add/remove are async) ----
        ("provider", "add") => Some("add_provider"),
        ("provider", "remove") => Some("remove_provider"),
        ("provider", "list_connected") => Some("list_connected_providers"),
        ("provider", "list_supported") => Some("list_supported_providers"),

        // ---- role ----
        ("role", "create") => Some("create_role"),
        ("role", "update") => Some("update_role"),
        ("role", "delete") => Some("delete_role"),
        ("role", "get") => Some("get_role"),
        ("role", "list") => Some("list_roles"),
        ("role", "add_prompt") => Some("add_role_prompt"),
        ("role", "remove_prompt") => Some("remove_role_prompt"),
        ("role", "set_prompts") => Some("set_role_prompts"),
        ("role", "add_skill") => Some("add_role_skill"),
        ("role", "remove_skill") => Some("remove_role_skill"),
        ("role", "list_skills") => Some("list_role_skills"),
        ("role", "add_mcp_tool") => Some("add_role_mcp_tool"),
        ("role", "remove_mcp_tool") => Some("remove_role_mcp_tool"),
        ("role", "list_mcp_tools") => Some("list_role_mcp_tools"),
        ("role", "list_tags") => Some("list_role_tags"),
        ("role", "add_note") => Some("add_role_note"),
        ("role", "recall_notes") => Some("recall_role_notes"),

        // ---- setting ----
        ("setting", "get") => Some("get_setting"),
        ("setting", "set") => Some("set_setting"),

        // ---- skill (import_from_url is async) ----
        ("skill", "create") => Some("create_skill"),
        ("skill", "update") => Some("update_skill"),
        ("skill", "delete") => Some("delete_skill"),
        ("skill", "get") => Some("get_skill"),
        ("skill", "list") => Some("list_skills"),
        ("skill", "import_from_url") => Some("import_skill_from_url"),
        ("skill", "add_step") => Some("add_skill_step"),
        ("skill", "update_step") => Some("update_skill_step"),
        ("skill", "delete_step") => Some("delete_skill_step"),
        ("skill", "reorder_steps") => Some("reorder_skill_steps"),
        ("skill", "list_steps") => Some("list_skill_steps"),
        ("skill", "add_file_attachment") => Some("add_skill_file_attachment"),
        ("skill", "add_git_attachment") => Some("add_skill_git_attachment"),
        ("skill", "remove_attachment") => Some("remove_skill_attachment"),
        ("skill", "list_attachments") => Some("list_skill_attachments"),
        ("skill", "log_step") => Some("log_step"),
        ("skill", "get_step_log") => Some("get_step_log"),

        // ---- space ----
        ("space", "create") => Some("create_space"),
        ("space", "update") => Some("update_space"),
        ("space", "delete") => Some("delete_space"),
        ("space", "get") => Some("get_space"),
        ("space", "list") => Some("list_spaces"),
        ("space", "add_prompt") => Some("add_space_prompt"),
        ("space", "remove_prompt") => Some("remove_space_prompt"),
        ("space", "list_prompts") => Some("list_space_prompts"),
        ("space", "set_prompts") => Some("set_space_prompts"),
        ("space", "set_skills") => Some("set_space_skills"),
        ("space", "set_mcp_tools") => Some("set_space_mcp_tools"),
        ("space", "sync_owner_to_agent_file") => Some("sync_owner_to_agent_file"),
        ("space", "sync_workflow_to_agent_file") => Some("sync_workflow_to_agent_file"),

        // ---- project_file (catique-2, disk-backed) ----
        ("project_file", "write") => Some("write_project_file"),
        ("project_file", "read") => Some("read_project_file"),
        ("project_file", "delete") => Some("delete_project_file"),
        ("project_file", "list") => Some("list_project_files"),

        // ---- tag ----
        ("tag", "create") => Some("create_tag"),
        ("tag", "update") => Some("update_tag"),
        ("tag", "delete") => Some("delete_tag"),
        ("tag", "get") => Some("get_tag"),
        ("tag", "list") => Some("list_tags"),
        ("tag", "list_prompt_map") => Some("list_prompt_tags_map"),
        ("tag", "set_prompts") => Some("set_tag_prompts"),

        // ---- task ----
        ("task", "create") => Some("create_task"),
        ("task", "update") => Some("update_task"),
        ("task", "delete") => Some("delete_task"),
        ("task", "get") => Some("get_task"),
        ("task", "list") => Some("list_tasks"),
        ("task", "move") => Some("move_task"),
        ("task", "rate") => Some("rate_task"),
        ("task", "get_rating") => Some("get_task_rating"),
        ("task", "get_bundle") => Some("get_task_bundle"),
        ("task", "get_urgency") => Some("get_task_urgency"),
        ("task", "set_urgency") => Some("set_task_urgency"),
        ("task", "search") => Some("search_tasks"),
        ("task", "search_by_cat_and_space") => Some("search_tasks_by_cat_and_space"),
        ("task", "route_to_board") => Some("route_task_to_board"),
        ("task", "link") => Some("link_tasks"),
        ("task", "unlink") => Some("unlink_tasks"),
        ("task", "list_links") => Some("list_task_links"),
        ("task", "add_prompt") => Some("add_task_prompt"),
        ("task", "remove_prompt") => Some("remove_task_prompt"),
        ("task", "list_prompts") => Some("list_task_prompts"),
        ("task", "set_prompt_override") => Some("set_task_prompt_override"),
        ("task", "clear_prompt_override") => Some("clear_task_prompt_override"),
        ("task", "add_skill") => Some("add_task_skill"),
        ("task", "remove_skill") => Some("remove_task_skill"),
        ("task", "list_skills") => Some("list_task_skills"),
        ("task", "add_mcp_tool") => Some("add_task_mcp_tool"),
        ("task", "remove_mcp_tool") => Some("remove_task_mcp_tool"),
        ("task", "list_mcp_tools") => Some("list_task_mcp_tools"),

        // ---- task_template (catique-1) ----
        ("task_template", "list") => Some("list_task_templates"),
        ("task_template", "get") => Some("get_task_template"),
        ("task_template", "create") => Some("create_task_template"),
        ("task_template", "update") => Some("update_task_template"),
        ("task_template", "delete") => Some("delete_task_template"),

        // ---- workflow ----
        ("workflow", "get") => Some("get_workflow_graph"),
        ("workflow", "set") => Some("set_workflow_graph"),

        _ => None,
    }
}

/// Split a `{ action, ... }` payload into the action string and the
/// residual params (with `action` stripped). The caller should pass
/// the residual to [`crate::mcp_dispatch::dispatch`] under the
/// resolved legacy method name.
///
/// # Errors
///
/// Returns a contextual `String` if `action` is missing or not a string.
pub fn split_action(mut params: Value, entity: &str) -> Result<(String, Value), String> {
    let action = params
        .as_object()
        .and_then(|o| o.get("action"))
        .and_then(Value::as_str)
        .ok_or_else(|| {
            format!("`{entity}`: missing required `action` field (string). See the tool's description for valid actions.")
        })?
        .to_owned();
    if let Some(obj) = params.as_object_mut() {
        obj.remove("action");
    }
    Ok((action, params))
}

/// Synchronous entity dispatch: resolves `(entity, action)` → legacy
/// method, then delegates to [`crate::mcp_dispatch::dispatch`].
///
/// Async-only legacy methods (see [`ASYNC_LEGACY_METHODS`]) return an
/// `Err` — the caller must invoke them through its async helpers.
///
/// # Errors
///
/// Returns a stringified validation or use-case error.
pub fn dispatch_entity(pool: &Pool, entity: &str, params: Value) -> Result<Value, String> {
    let (action, rest) = split_action(params, entity)?;
    let legacy = resolve_legacy_method(entity, &action).ok_or_else(|| {
        format!(
            "`{entity}`: unknown action `{action}`. See the tool's description for valid actions."
        )
    })?;
    if is_async_legacy(legacy) {
        return Err(format!(
            "`{entity}.{action}` (legacy `{legacy}`) requires an async runtime — not supported in sync dispatch."
        ));
    }
    dispatch(pool, legacy, rest)
}

// =====================================================================
// `tools/list` descriptors
// =====================================================================

/// Build a single entity-tool descriptor with an `action` enum and
/// loose `additionalProperties` for action-specific fields. The full
/// param shape lives in `description` so an LLM has enough context to
/// pick the right action and fill the right fields.
fn entity_descriptor(name: &str, summary: &str, actions: &[(&str, &str)]) -> Value {
    let action_enum: Vec<&str> = actions.iter().map(|(a, _)| *a).collect();
    let action_lines: String = actions
        .iter()
        .map(|(action, help)| format!("  * `{action}` — {help}"))
        .collect::<Vec<_>>()
        .join("\n");
    let description = format!("{summary}\n\nActions:\n{action_lines}");
    json!({
        "name": name,
        "description": description,
        "inputSchema": {
            "type": "object",
            "properties": {
                "action": {
                    "type": "string",
                    "description": "Which operation to perform. Required.",
                    "enum": action_enum,
                }
            },
            "required": ["action"],
            "additionalProperties": true,
        }
    })
}

/// Return the 16 entity-tool descriptors + 2 cross-cutting top-level
/// tools (`search_all`, `get_sync_status`). The MCP-server binary
/// surfaces this list verbatim in `tools/list` and prepends the
/// `mcp_proxy_tool` façade separately.
#[must_use]
#[allow(clippy::too_many_lines)]
pub fn aggregated_tool_descriptors() -> Vec<Value> {
    vec![
        entity_descriptor(
            "agent_report",
            "Agent-authored task reports — structured outputs an agent produces while working a task (e.g. design memos, audit notes, run logs).",
            &[
                ("create", "{ task_id, kind, title, content, author? }"),
                ("update", "{ id, kind?, title?, content?, author? (nullable) }"),
                ("delete", "{ id }"),
                ("get", "{ id }"),
                ("list", "{ task_id? } — filter by task or list all"),
                ("search", "{ query, limit? } — FTS over title + content"),
            ],
        ),
        entity_descriptor(
            "attachment",
            "Task-scoped file attachments. `upload`/`upload_blob` ingest content; `create` registers metadata for an already-stored file.",
            &[
                ("create", "{ task_id, filename, mime_type?, byte_size, sha256, uploaded_by? }"),
                ("update", "{ id, filename?, uploaded_by? (nullable) }"),
                ("delete", "{ id }"),
                ("get", "{ id }"),
                ("list", "{ task_id? }"),
                ("upload", "{ task_id, filename, mime_type?, source_path } — copy from disk"),
                ("upload_blob", "{ task_id, filename, mime_type?, base64 } — inline base64 ≤ 10 MiB"),
            ],
        ),
        entity_descriptor(
            "board",
            "Kanban board owned by a role (D-020). A space auto-provisions its default Owner board via `space.create`; use `create` to add a board for another role (one board per role — UNIQUE(space_id, role_id)).",
            &[
                ("create", "{ space_id, role_id, name, description?, color?, icon? } — role_id is the owner; one board per role per space"),
                ("get", "{ id }"),
                ("list", "{ }"),
                ("delete", "{ id }"),
                ("set_owner", "{ board_id, role_id }"),
                ("add_prompt", "{ board_id, prompt_id, position }"),
                ("remove_prompt", "{ board_id, prompt_id }"),
                ("set_prompts", "{ board_id, prompt_ids[] } — replace desired state"),
                ("set_skills", "{ board_id, skill_ids[] }"),
                ("set_mcp_tools", "{ board_id, mcp_tool_ids[] }"),
            ],
        ),
        entity_descriptor(
            "column",
            "Column on a board. Holds tasks in ordered position; carries inheritance scope for prompts/skills/MCP tools.",
            &[
                ("create", "{ board_id, name, position }"),
                ("update", "{ id, name?, position?, role_id? (nullable) }"),
                ("delete", "{ id }"),
                ("get", "{ id }"),
                ("list", "{ }"),
                ("add_prompt", "{ column_id, prompt_id, position }"),
                ("remove_prompt", "{ column_id, prompt_id }"),
                ("set_prompts", "{ column_id, prompt_ids[] }"),
                ("set_skills", "{ column_id, skill_ids[] }"),
                ("set_mcp_tools", "{ column_id, mcp_tool_ids[] }"),
            ],
        ),
        entity_descriptor(
            "mcp_server",
            "MCP server registry entries (upstream Playwright/GitHub/etc.). Auth references are keychain/env JSON, never raw secrets.",
            &[
                ("create", "{ name, transport, url?, command?, auth_json?, enabled? }"),
                ("update", "{ id, name?, transport?, url?, command?, auth_json?, enabled? }"),
                ("delete", "{ id }"),
                ("get", "{ id }"),
                ("list", "{ }"),
                ("get_status", "{ id } — live health snapshot"),
                ("refresh", "{ id } — re-introspect upstream tools (async, Tauri-shell only)"),
            ],
        ),
        entity_descriptor(
            "mcp_tool",
            "Individual MCP tool advertised by an upstream server, plus manual tools created in Catique HUB.",
            &[
                ("create", "{ name, description?, schema_json, color?, position } — manual source"),
                ("update", "{ id, name?, description?, schema_json?, color?, position? }"),
                ("delete", "{ id }"),
                ("get", "{ id }"),
                ("list", "{ }"),
                ("list_by_server", "{ server_id }"),
            ],
        ),
        entity_descriptor(
            "prompt",
            "Reusable prompt fragment. Inherited along space → role → board → column → task chains; tags are flat labels (no cascade).",
            &[
                ("create", "{ name, content, color?, short_description?, icon?, examples? }"),
                ("update", "{ id, name?, content?, color?, short_description?, icon?, examples? }"),
                ("delete", "{ id }"),
                ("get", "{ id }"),
                ("list", "{ }"),
                ("add_tag", "{ prompt_id, tag_id }"),
                ("remove_tag", "{ prompt_id, tag_id }"),
                ("recompute_token_count", "{ id } — refresh cached token estimate"),
            ],
        ),
        entity_descriptor(
            "prompt_group",
            "Ordered collection of prompts (curated bundle). Members carry an explicit position; replace the full ordered list via `set_members`.",
            &[
                ("create", "{ name, color?, icon?, position? }"),
                ("update", "{ id, name?, color?, icon?, position? }"),
                ("delete", "{ id }"),
                ("get", "{ id }"),
                ("list", "{ }"),
                ("add_member", "{ group_id, prompt_id, position }"),
                ("remove_member", "{ group_id, prompt_id }"),
                ("list_members", "{ group_id }"),
                ("set_members", "{ group_id, ordered_prompt_ids[] }"),
            ],
        ),
        entity_descriptor(
            "provider",
            "External LLM/agent providers (Claude, OpenAI, Codex, …). `add`/`remove` are async — they touch keychain + agent-file sync.",
            &[
                ("add", "{ provider, name?, api_key? } — async"),
                ("remove", "{ provider } — async"),
                ("list_connected", "{ } — providers with active credentials"),
                ("list_supported", "{ } — full catalogue"),
            ],
        ),
        entity_descriptor(
            "role",
            "Owner-role for a board (D-020). Carries inherited prompts, skills, and MCP tools that resolve down into every task on its board.",
            &[
                ("create", "{ name, content, color?, icon? }"),
                ("update", "{ id, name?, content?, color?, icon? }"),
                ("delete", "{ id }"),
                ("get", "{ id }"),
                ("list", "{ }"),
                ("add_prompt", "{ role_id, prompt_id, position }"),
                ("remove_prompt", "{ role_id, prompt_id }"),
                ("set_prompts", "{ role_id, prompt_ids[] }"),
                ("add_skill", "{ role_id, skill_id, position }"),
                ("remove_skill", "{ role_id, skill_id }"),
                ("list_skills", "{ role_id }"),
                ("add_mcp_tool", "{ role_id, mcp_tool_id, position }"),
                ("remove_mcp_tool", "{ role_id, mcp_tool_id }"),
                ("list_mcp_tools", "{ role_id }"),
                ("list_tags", "{ role_id } — tags reachable via this role's prompt set"),
                ("add_note", "{ role_id, content, author? } — retrospective memory"),
                ("recall_notes", "{ role_id, limit? } — recent notes for this role"),
            ],
        ),
        entity_descriptor(
            "setting",
            "Global key/value preferences (selected_space, theme, …).",
            &[
                ("get", "{ key }"),
                ("set", "{ key, value }"),
            ],
        ),
        entity_descriptor(
            "skill",
            "Reusable skill with ordered steps and file/git attachments. Step logs capture runtime evidence.",
            &[
                ("create", "{ name, description?, color?, position }"),
                ("update", "{ id, name?, description?, color?, position? }"),
                ("delete", "{ id }"),
                ("get", "{ id }"),
                ("list", "{ }"),
                ("import_from_url", "{ url, target_kind, target_id } — async"),
                ("add_step", "{ skill_id, title, body?, position }"),
                ("update_step", "{ id, title?, body?, position? }"),
                ("delete_step", "{ id }"),
                ("reorder_steps", "{ skill_id, ordered_step_ids[] }"),
                ("list_steps", "{ skill_id }"),
                ("add_file_attachment", "{ skill_id, filename, source_path }"),
                ("add_git_attachment", "{ skill_id, repo_url, ref?, subpath? }"),
                ("remove_attachment", "{ id }"),
                ("list_attachments", "{ skill_id }"),
                ("log_step", "{ task_id, summary }"),
                ("get_step_log", "{ task_id }"),
            ],
        ),
        entity_descriptor(
            "space",
            "Top-level workspace. Owns roles, kanban boards, prompts. D-006: every space has a 1:1 owner role and a default Owner board.",
            &[
                ("create", "{ name, prefix, description?, color?, icon?, is_default?, project_folder_path? }"),
                ("update", "{ id, name?, description?, color?, icon?, is_default?, position?, project_folder_path? }"),
                ("delete", "{ id }"),
                ("get", "{ id }"),
                ("list", "{ }"),
                ("add_prompt", "{ space_id, prompt_id, position? }"),
                ("remove_prompt", "{ space_id, prompt_id }"),
                ("list_prompts", "{ space_id }"),
                ("set_prompts", "{ space_id, prompt_ids[] }"),
                ("set_skills", "{ space_id, skill_ids[] }"),
                ("set_mcp_tools", "{ space_id, mcp_tool_ids[] }"),
                ("sync_owner_to_agent_file", "{ space_id } — write owner role to agent files"),
                ("sync_workflow_to_agent_file", "{ space_id } — write workflow graph to agent files"),
            ],
        ),
        entity_descriptor(
            "project_file",
            "Agent instruction markdown files (catique-2) living on disk in a project's folder — e.g. AGENTS.md / CLAUDE.md. `list` returns the provider-expected names plus any other root-level *.md. `write` creates or overwrites; `read`/`delete` operate by name. Requires the space to have a project folder configured.",
            &[
                ("list", "{ space_id }"),
                ("read", "{ space_id, name }"),
                ("write", "{ space_id, name, content? }"),
                ("delete", "{ space_id, name }"),
            ],
        ),
        entity_descriptor(
            "tag",
            "Flat label applied to prompts. Does NOT cascade into the inheritance chain.",
            &[
                ("create", "{ name, color? }"),
                ("update", "{ id, name?, color? }"),
                ("delete", "{ id }"),
                ("get", "{ id }"),
                ("list", "{ }"),
                ("list_prompt_map", "{ } — { tag_id: [prompt_id] } map for the whole DB"),
                ("set_prompts", "{ tag_id, prompt_ids[] } — replace labelled-set"),
            ],
        ),
        entity_descriptor(
            "task",
            "Kanban task — the atomic unit of work. Inherits prompts/skills/MCP tools from board → column → role → space and supports per-task overrides.",
            &[
                ("create", "{ board_id, column_id, title, description?, position, role_id? }"),
                ("update", "{ id, title?, description?, column_id?, position?, role_id? }"),
                ("delete", "{ id }"),
                ("get", "{ id }"),
                ("list", "{ }"),
                ("move", "{ id, target_column_id, position }"),
                ("rate", "{ task_id, score, note? }"),
                ("get_rating", "{ task_id }"),
                ("get_bundle", "{ task_id } — resolved prompt + skill + MCP bundle for execution"),
                ("get_urgency", "{ id }"),
                ("set_urgency", "{ id, urgency }"),
                ("search", "{ query, limit? }"),
                ("search_by_cat_and_space", "{ space_id, cat_id, query }"),
                ("route_to_board", "{ task_id, target_board_id } — re-home task across roles"),
                ("link", "{ src_task_id, dst_task_id, kind? } — kind ∈ related|blocks|parent (default related); idempotent"),
                ("unlink", "{ src_task_id, dst_task_id, kind? } — remove a link; idempotent"),
                ("list_links", "{ task_id } — every link the task participates in, either direction"),
                ("add_prompt", "{ task_id, prompt_id, position }"),
                ("remove_prompt", "{ task_id, prompt_id }"),
                ("list_prompts", "{ task_id }"),
                ("set_prompt_override", "{ task_id, content }"),
                ("clear_prompt_override", "{ task_id }"),
                ("add_skill", "{ task_id, skill_id, position }"),
                ("remove_skill", "{ task_id, skill_id }"),
                ("list_skills", "{ task_id }"),
                ("add_mcp_tool", "{ task_id, mcp_tool_id, position }"),
                ("remove_mcp_tool", "{ task_id, mcp_tool_id }"),
                ("list_mcp_tools", "{ task_id }"),
            ],
        ),
        entity_descriptor(
            "task_template",
            "Task templates (catique-1) — named markdown skeletons (feature / bug / research / custom) the user picks when creating a task; the body pre-fills the task description.",
            &[
                ("list", "{ }"),
                ("get", "{ id }"),
                ("create", "{ name, kind?, description?, body?, icon?, color? } — kind ∈ feature|bug|research|custom (default custom)"),
                ("update", "{ id, name?, kind?, description?, body?, icon?, color?, position? }"),
                ("delete", "{ id }"),
            ],
        ),
        entity_descriptor(
            "workflow",
            "Per-space workflow graph (state machine over columns).",
            &[
                ("get", "{ space_id }"),
                ("set", "{ space_id, json } — full replace"),
            ],
        ),
        // ---- Cross-cutting top-level tools ----
        json!({
            "name": "search_all",
            "description": "Full-text search across every searchable entity kind in a single call. Returns ranked matches grouped by kind. Use this instead of N individual `*.search` calls when you don't know yet which kind contains the hit.",
            "inputSchema": {
                "type": "object",
                "properties": {
                    "query": {"type": "string", "description": "Free-text query."},
                    "limit_per_kind": {"type": "integer", "description": "Optional cap per kind (default 20)."}
                },
                "required": ["query"],
                "additionalProperties": false,
            }
        }),
        json!({
            "name": "get_sync_status",
            "description": "Return the live orchestrator snapshot — last sync, pending writes, queued role-file renders. Used by clients to surface dirty-state before they read derived artefacts.",
            "inputSchema": {
                "type": "object",
                "properties": {},
                "additionalProperties": false,
            }
        }),
    ]
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn entity_names_alphabetically_ordered() {
        let mut sorted: Vec<&&str> = ENTITY_TOOL_NAMES.iter().collect();
        sorted.sort();
        let original: Vec<&&str> = ENTITY_TOOL_NAMES.iter().collect();
        assert_eq!(
            sorted, original,
            "ENTITY_TOOL_NAMES must stay alphabetically sorted to match manifest ordering",
        );
    }

    #[test]
    fn resolve_known_actions() {
        assert_eq!(resolve_legacy_method("task", "create"), Some("create_task"));
        assert_eq!(
            resolve_legacy_method("role", "add_mcp_tool"),
            Some("add_role_mcp_tool")
        );
        assert_eq!(
            resolve_legacy_method("space", "sync_owner_to_agent_file"),
            Some("sync_owner_to_agent_file"),
        );
        assert_eq!(
            resolve_legacy_method("attachment", "upload_blob"),
            Some("upload_attachment_blob"),
        );
    }

    #[test]
    fn resolve_returns_none_for_unknown_pair() {
        assert!(resolve_legacy_method("task", "no_such_action").is_none());
        assert!(resolve_legacy_method("no_such_entity", "list").is_none());
    }

    #[test]
    fn async_classification_matches_known_set() {
        assert!(is_async_legacy("add_provider"));
        assert!(is_async_legacy("import_skill_from_url"));
        assert!(is_async_legacy("refresh_mcp_server"));
        assert!(!is_async_legacy("create_task"));
        assert!(!is_async_legacy("list_roles"));
    }

    #[test]
    fn split_action_strips_field() {
        let payload = serde_json::json!({ "action": "list", "extra": 1 });
        let (action, rest) = split_action(payload, "task").unwrap();
        assert_eq!(action, "list");
        assert_eq!(rest, serde_json::json!({ "extra": 1 }));
    }

    #[test]
    fn split_action_errors_when_missing() {
        let payload = serde_json::json!({});
        let err = split_action(payload, "role").unwrap_err();
        assert!(err.contains("role"));
        assert!(err.contains("action"));
    }

    #[test]
    fn aggregated_descriptors_cover_every_entity_name() {
        let descriptors = aggregated_tool_descriptors();
        let names: Vec<&str> = descriptors
            .iter()
            .filter_map(|d| d.get("name").and_then(Value::as_str))
            .collect();
        for entity in ENTITY_TOOL_NAMES {
            assert!(
                names.contains(entity),
                "aggregated_tool_descriptors() is missing entity `{entity}`",
            );
        }
        assert!(names.contains(&"search_all"));
        assert!(names.contains(&"get_sync_status"));
    }

    #[test]
    fn entity_descriptors_have_action_enum() {
        let descriptors = aggregated_tool_descriptors();
        for entity in ENTITY_TOOL_NAMES {
            let descriptor = descriptors
                .iter()
                .find(|d| d.get("name").and_then(Value::as_str) == Some(entity))
                .unwrap_or_else(|| panic!("missing descriptor for `{entity}`"));
            let action_enum = descriptor
                .pointer("/inputSchema/properties/action/enum")
                .and_then(Value::as_array)
                .unwrap_or_else(|| panic!("`{entity}`: action enum missing"));
            assert!(
                !action_enum.is_empty(),
                "`{entity}`: action enum must not be empty",
            );
        }
    }

    #[test]
    fn every_descriptor_action_resolves_to_legacy_method() {
        let descriptors = aggregated_tool_descriptors();
        for entity in ENTITY_TOOL_NAMES {
            let descriptor = descriptors
                .iter()
                .find(|d| d.get("name").and_then(Value::as_str) == Some(entity))
                .unwrap();
            let action_enum = descriptor
                .pointer("/inputSchema/properties/action/enum")
                .and_then(Value::as_array)
                .unwrap();
            for action_value in action_enum {
                let action = action_value.as_str().unwrap();
                assert!(
                    resolve_legacy_method(entity, action).is_some(),
                    "advertised `{entity}.{action}` has no legacy mapping — manifest will be lying to the client",
                );
            }
        }
    }
}
