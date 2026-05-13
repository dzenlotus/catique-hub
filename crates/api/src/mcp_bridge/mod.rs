//! MCP bridge — Node sidecar `tools/call` → Rust use-case dispatch.
//!
//! ctq-112 / E5 round 1. The Node MCP server (`sidecar/index.js`) holds
//! a JSON Schema-typed tool surface; when a client invokes one, the
//! Node handler issues an `ipc_call(method, params)` over the
//! supervisor channel back to Rust. This module is the single
//! dispatcher that translates `(method, params)` into a use-case call
//! and returns the JSON result.
//!
//! **No Tauri IPC re-entry.** The dispatcher receives the raw JSON
//! payload and reuses the same use-case constructors that the
//! `#[tauri::command]` handlers do — see [`install`].
//!
//! **Scope this round (post-ADR-0008).** The external tool surface is
//! restricted to Catique-native reads (boards / columns / tasks /
//! task bundle). The registry-only `list_mcp_servers` /
//! `get_mcp_server_connection_hint` arms were removed when ADR-0008
//! reversed the MCP model from "registry" to "pass-through proxy" —
//! agents must not see upstream-server connection metadata. The
//! eventual proxy entry point will be `proxy_tool_call(server_id,
//! tool_name, args)`, added in the ctq-126 rewrite under ADR-0008.
//!
//! **Agent-B expansion.** ~45 dispatch arms covering the prompts,
//! prompt_groups, spaces, and connected_providers domains land here
//! for full parity with the Tauri IPC surface. Sync arms slot into the
//! existing `dispatch()` match (rusqlite is sync); the two async
//! provider mutators (`add_provider` / `remove_provider`) take their
//! own pre-dispatch branch inside [`install`] because they need both
//! the Tokio runtime AND an [`OrchestratorHandle`] to fire the
//! post-mutation sync trigger.
//!
//! ## Adding a new tool
//!
//! Two changes are required:
//!
//!   1. Add the entry to `sidecar/tool-manifest.json` (Node side —
//!      describes the wire shape to the MCP client).
//!   2. Add a match arm to [`dispatch`] that decodes `params` into the
//!      use-case call and re-serializes the result via `serde_json`.
//!
//! Once the xtask generator from `TODO(ctq-112-manifest-gen)` lands, the
//! manifest entry will be derived automatically; only the Rust dispatch
//! arm has to be added by hand.
//!
//! TODO(ctq-112-S4): require the Node side to authenticate every
//! `ipc_call` with a per-launch shared secret env var. Until that ships
//! we trust the OS-pipe parent/child boundary — anyone with permission
//! to attach to our stdio is already inside the trust boundary.

use std::sync::Arc;
use std::time::Duration;

use catique_application::{
    attachments::AttachmentsUseCase,
    boards::BoardsUseCase,
    clients::ConnectedProvidersUseCase,
    columns::ColumnsUseCase,
    connected_providers::{build_bundle_for_test, OrchestratorHandle, SyncTrigger},
    mcp_proxy::{McpProxyUseCase, UpstreamCaller, UpstreamError},
    mcp_servers::{McpServersUseCase, ServerWireMeta, UpstreamIntrospector, UpstreamToolDecl},
    mcp_tools::McpToolsUseCase,
    prompt_groups::PromptGroupsUseCase,
    prompts::PromptsUseCase,
    reports::ReportsUseCase,
    role_notes::RoleNotesUseCase,
    roles::RolesUseCase,
    search::SearchUseCase,
    settings::SettingsUseCase,
    skills::SkillsUseCase,
    spaces::{CreateSpaceArgs, SpacesUseCase, UpdateSpaceArgs},
    tags::TagsUseCase,
    tasks::TasksUseCase,
    AppError,
};
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
use catique_sidecar::{IpcHandler, SidecarError, SidecarManager};
use serde_json::{json, Value};

/// Wire timeout for one upstream MCP `tools/call`. Matches
/// [`catique_application::mcp_proxy::DEFAULT_UPSTREAM_TIMEOUT`].
const UPSTREAM_CALL_TIMEOUT: Duration = Duration::from_secs(60);

/// Adapter that lets [`McpProxyUseCase`] reach the wire through the
/// concrete `SidecarManager` without the application crate depending
/// on `catique-sidecar`. Exposed via [`sidecar_upstream`] so command
/// handlers can build one against the live `AppState.sidecar` clone.
pub struct SidecarUpstream {
    mgr: SidecarManager,
}

/// Construct a [`SidecarUpstream`] bound to the given manager. Cheap —
/// `SidecarManager::clone` is Arc-backed.
#[must_use]
pub fn sidecar_upstream(mgr: &SidecarManager) -> SidecarUpstream {
    SidecarUpstream { mgr: mgr.clone() }
}

impl UpstreamCaller for SidecarUpstream {
    async fn call_upstream(
        &self,
        server_id: &str,
        tool_name: &str,
        args: Value,
    ) -> Result<Value, UpstreamError> {
        match self
            .mgr
            .call_upstream(server_id, tool_name, args, UPSTREAM_CALL_TIMEOUT)
            .await
        {
            Ok(v) => {
                // ADR-0008: Node side surfaces upstream-side `isError:
                // true` by returning a payload of shape `{ "isError":
                // true, "content": [...] }`. Detect it here so the
                // proxy use case can categorise the failure.
                if v.get("isError").and_then(Value::as_bool) == Some(true) {
                    Err(UpstreamError::UpstreamIsError(v.to_string()))
                } else {
                    Ok(v)
                }
            }
            Err(SidecarError::IpcTimeout(_)) => Err(UpstreamError::Timeout),
            Err(other) => Err(UpstreamError::Transport(other.to_string())),
        }
    }
}

/// Wire impl of [`UpstreamIntrospector`]. Dispatches one
/// `introspect_upstream` supervisor frame to the Node side, which
/// opens (or reuses) the upstream MCP client and replies with the
/// `tools/list` payload.
const INTROSPECT_TIMEOUT: Duration = Duration::from_secs(15);

impl UpstreamIntrospector for SidecarUpstream {
    async fn list_tools(
        &self,
        meta: &ServerWireMeta,
    ) -> Result<Vec<UpstreamToolDecl>, UpstreamError> {
        let params = json!({
            "server_id": meta.id,
            "meta": {
                "id": meta.id,
                "name": meta.name,
                "transport": meta.transport,
                "url": meta.url,
                "command": meta.command,
            },
        });
        let raw = self
            .mgr
            .call_ipc("introspect_upstream", params, INTROSPECT_TIMEOUT)
            .await
            .map_err(|e| match e {
                SidecarError::IpcTimeout(_) => UpstreamError::Timeout,
                other => UpstreamError::Transport(other.to_string()),
            })?;
        // Node returns { tools: [{ name, description?, inputSchema }] }.
        let tools = raw.get("tools").and_then(Value::as_array).ok_or_else(|| {
            UpstreamError::Transport("introspect_upstream: missing tools[]".into())
        })?;
        let mut out = Vec::with_capacity(tools.len());
        for entry in tools {
            let name = entry
                .get("name")
                .and_then(Value::as_str)
                .ok_or_else(|| UpstreamError::Transport("tool missing name".into()))?
                .to_owned();
            let description = entry
                .get("description")
                .and_then(Value::as_str)
                .map(str::to_owned);
            let input_schema = entry
                .get("inputSchema")
                .cloned()
                .unwrap_or_else(|| json!({"type": "object"}));
            out.push(UpstreamToolDecl {
                name,
                description,
                input_schema,
            });
        }
        Ok(out)
    }
}

/// Install the MCP bridge handler onto `mgr`. The handler captures a
/// cheap `Pool` clone and routes every `ipc_call` through [`dispatch`]
/// (sync arms) or one of the dedicated async arms (proxy + provider
/// mutators that need the wire / orchestrator).
///
/// `orchestrator` is optional: at startup the Tauri shell installs the
/// orchestrator before this bridge is registered, but unit tests may
/// build the bridge without one. The `add_provider` / `remove_provider`
/// arms fall back to "no trigger" when the handle is `None` — the
/// initial sync inside the use case still runs unconditionally.
///
/// Idempotent: subsequent calls overwrite the previous handler.
pub async fn install(mgr: &SidecarManager, pool: Pool, orchestrator: Option<OrchestratorHandle>) {
    let pool = Arc::new(pool);
    let captured_mgr = mgr.clone();
    let captured_orch = orchestrator;
    let handler: IpcHandler = Arc::new(move |method, params| {
        let pool = Arc::clone(&pool);
        let mgr = captured_mgr.clone();
        let orch = captured_orch.clone();
        Box::pin(async move {
            // Async-first arms — they need the Tokio runtime AND either
            // the wire (proxy_tool_call / refresh_mcp_server) or the
            // orchestrator (provider mutators). They cannot live in the
            // `spawn_blocking` path.
            match method.as_str() {
                "proxy_tool_call" => return proxy_tool_call_arm(&pool, &mgr, params).await,
                "add_provider" => return add_provider_arm(&pool, orch.as_ref(), params).await,
                "remove_provider" => {
                    return remove_provider_arm(&pool, orch.as_ref(), params).await
                }
                "refresh_mcp_server" => return refresh_mcp_server_arm(&pool, &mgr, params).await,
                _ => {}
            }
            // Use cases are sync (rusqlite is sync); offload onto a
            // blocking thread so the reader task can keep draining
            // stdout while a long DB call runs.
            tokio::task::spawn_blocking(move || dispatch(&pool, &method, params))
                .await
                .map_err(|e| format!("dispatch join error: {e}"))?
        })
    });
    mgr.set_ipc_handler(handler).await;
}

/// Async path for `proxy_tool_call`. Constructs a fresh
/// [`McpProxyUseCase`] per call (the inner state is purely the pool +
/// the upstream caller, both cheap to compose).
async fn proxy_tool_call_arm(
    pool: &Pool,
    mgr: &SidecarManager,
    params: Value,
) -> Result<Value, String> {
    let server_id = decode_string(&params, "server_id")?;
    let tool_name = decode_string(&params, "tool_name")?;
    let args = params.get("args").cloned().unwrap_or(json!({}));
    let caller = SidecarUpstream { mgr: mgr.clone() };
    McpProxyUseCase::new(pool, &caller)
        .call(&server_id, &tool_name, args)
        .await
        .map_err(stringify_app)
}

/// Async arm for `add_provider`. Mirrors `handlers::clients::add_provider`
/// but skips the Tauri event emit (events are a UI concern; agents see
/// the result through the returned row).
///
/// Fires `SyncTrigger::ProviderAdded` on success when an orchestrator
/// handle is wired so the orchestrator coalesces any concurrent
/// mutations into a follow-up sync round.
async fn add_provider_arm(
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

/// Async arm for `remove_provider`. Mirrors
/// `handlers::clients::remove_provider`. Idempotent on the DB side.
/// The orchestrator does not currently differentiate the "removed"
/// cause; we still fire `ProviderAdded` (the only trigger that resolves
/// to a full sync round today) so a stale provider that re-detects
/// is picked up automatically. NOTE: when a dedicated
/// `SyncTrigger::ProviderRemoved` variant lands, swap this in — the
/// existing variants are exhaustively documented in
/// `catique_application::connected_providers`.
async fn remove_provider_arm(
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

/// MCP-EXPAND-A: async arm for `refresh_mcp_server`. Mirrors
/// `handlers::mcp_servers::refresh_mcp_server` minus the Tauri event
/// emit — the introspection itself requires the live `SidecarManager`
/// so the arm lives in the async pre-dispatch slot, not the sync
/// `dispatch()` match.
///
/// Returns the [`RefreshReport`] verbatim — Node side surfaces it as
/// `tools/call` JSON content.
async fn refresh_mcp_server_arm(
    pool: &Pool,
    mgr: &SidecarManager,
    params: Value,
) -> Result<Value, String> {
    let id = decode_string(&params, "id")?;
    let introspector = sidecar_upstream(mgr);
    let report = McpServersUseCase::new(pool)
        .refresh(&id, &introspector)
        .await
        .map_err(stringify_app)?;
    json_or_err(&report)
}

/// Look up `method` in the dispatch table, decode `params`, run the
/// use-case, and return the JSON-encoded result. Errors collapse into
/// a single `String` (the Node MCP layer surfaces it as `isError:
/// true` text content).
///
/// Keep the match arms ordered alphabetically — easier scan when the
/// list grows past five entries.
#[allow(clippy::too_many_lines)]
fn dispatch(pool: &Pool, method: &str, params: Value) -> Result<Value, String> {
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

// ---------------------------------------------------------------------
// Per-arm helpers (kept out of `dispatch` to keep the match readable).
// ---------------------------------------------------------------------

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

/// Mirrors `handlers::prompts::add_column_prompt`.
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

/// Mirrors `handlers::prompts::remove_board_prompt`. Returns
/// AppError::NotFound semantics when no join-row matched.
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

/// Mirrors `handlers::prompts::remove_column_prompt`.
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

/// Mirrors `handlers::tasks::add_task_prompt`.
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

/// Mirrors `handlers::tasks::remove_task_prompt`.
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

/// Mirrors `handlers::tasks::set_task_prompt_override`.
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

/// Mirrors `handlers::tasks::clear_task_prompt_override`.
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

/// ctq-137 / MEM-S1: external arm for `recall_role_notes`. The agent
/// surface always operates on its own role's notes — `role_id` is a
/// required argument.
///
/// `limit` is optional; defaults to 20 to mirror the IPC handler. The
/// use case caps at 50.
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

/// ctq-137 / MEM-S1: external arm for `add_role_note`. The agent
/// surface ALWAYS sets `authored_by = "agent"`; the user-authored
/// path is reachable only through the Tauri IPC.
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

/// ctq-137 / MEM-S1: external arm for `list_role_tags`. Agents call
/// this before inventing tags, biasing them toward reuse.
fn list_role_tags_arm(pool: &Pool, params: &Value) -> Result<Value, String> {
    let role_id = decode_string(params, "role_id")?;
    let out = RoleNotesUseCase::new(pool)
        .list_tags(&role_id)
        .map_err(stringify_app)?;
    json_or_err(&out)
}

/// Internal supervisor-channel arm (Node → Rust): hand back the list
/// of proxied tools the Node side should merge into its dynamic
/// `tools/list` response. Real body lands here in PROXY-S4 round 1
/// (`McpServersUseCase::list_proxied_tools` joins `mcp_servers` ×
/// `mcp_tools` filtered to enabled + source=upstream + synced).
fn list_proxied_tools_arm(pool: &Pool) -> Result<Value, String> {
    let tools = McpServersUseCase::new(pool)
        .list_proxied_tools()
        .map_err(stringify_app)?;
    json_or_err(&tools)
}

/// Internal supervisor-channel arm (Node → Rust): resolve the secret
/// referenced by `mcp_servers.auth_json` for `server_id`. The secret
/// crosses the pipe exactly once per upstream call (ADR-0008 risk
/// axis 1) and Node never caches.
///
/// Error path: missing keychain entry → `keychain_missing`; backend
/// not wired yet → `not_implemented`. Strings are deliberate short
/// tokens that the Node side can stuff into `isError` content
/// without leaking the actual key.
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
        // `code` is a `&'static str`, so this branch carries no
        // caller-controlled bytes into the bridge error message —
        // see `secrets::map_keyring_err` in
        // `crates/infrastructure/src/secrets/mod.rs`.
        secrets::SecretError::Backend(code) => format!("keychain_backend: {code}"),
        secrets::SecretError::NotImplemented(_) => "not_implemented".to_owned(),
        secrets::SecretError::MalformedRef(m) => format!("malformed_ref: {m}"),
    })?;
    // The secret crosses the pipe in the response body. Node must
    // use it once and forget — see `sidecar/upstream-clients.js`
    // (PROXY-S2).
    Ok(json!({ "secret": secret }))
}

// ---------------------------------------------------------------------
// MCP-EXPAND-C arms — tasks / boards / columns / attachments / search.
// Mirror the Tauri handlers in `handlers::{tasks,boards,columns,
// attachments,search}` one-for-one; event emission is intentionally
// omitted (events are a UI concern — agents see the result through the
// returned row).
// ---------------------------------------------------------------------

/// Mirrors `handlers::tasks::move_task`. Honours the same
/// "either column_id or board_id" decision the Tauri command makes —
/// when only `board_id` is supplied we route to that board's default
/// column via [`TasksUseCase::route_task_to_board`].
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

/// Mirrors `handlers::tasks::rate_task`. The IPC payload uses `i32`
/// (JSON-native) and re-narrows to `i8` after the range guard, matching
/// the handler's contract.
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

/// Mirrors `handlers::tasks::get_step_log`. Returns `""` for tasks that
/// have never been logged-to; `AppError::NotFound` if the task id is
/// unknown.
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

/// Mirrors `handlers::tasks::delete_task`. Resolves the app-data dir for
/// the attachment-directory cleanup so the cascaded `task_attachments`
/// rows and on-disk blobs disappear together. Filesystem cleanup is
/// best-effort — a missing or unreadable directory does not fail the
/// call (see `TasksUseCase::delete_with_attachments`).
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

/// Mirrors `handlers::attachments::create_attachment`. Metadata-only —
/// the caller is expected to have already written the blob under
/// `<app_data>/attachments/<task_id>/<storage_path>`.
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

/// Mirrors `handlers::attachments::delete_attachment`. Removes both the
/// metadata row AND the on-disk blob (best-effort on the FS side — see
/// `AttachmentsUseCase::delete_with_blob`).
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

/// Mirrors `handlers::attachments::upload_attachment`. The path-based
/// upload only makes sense for callers that can name a local file (the
/// desktop UI); agents normally reach for `upload_attachment_blob` with
/// a base64 payload. We expose this arm for parity with the Tauri
/// command — same validations, same cleanup-on-failure contract.
fn upload_attachment_arm(pool: &Pool, params: &Value) -> Result<Value, String> {
    use std::path::PathBuf;
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
    let sanitized: String = original_filename
        .chars()
        .map(|c| match c {
            '/' | '\\' | ':' | '*' | '?' | '"' | '<' | '>' | '|' => '_',
            other => other,
        })
        .collect();
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
        .unwrap_or_else(|| mime_from_ext_bridge(&src).to_owned());
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

/// Mirrors `handlers::attachments::upload_attachment_blob`. Reuses the
/// crate-internal `upload_attachment_blob_inner` so the size-cap +
/// atomic-write + cleanup-on-insert-failure path stays one source of
/// truth across the Tauri command and the MCP bridge.
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
    let attachment = crate::handlers::attachments::upload_attachment_blob_inner(
        pool,
        &data_root,
        task_id,
        filename,
        &content_b64,
        mime,
    )
    .map_err(stringify_app)?;
    json_or_err(&attachment)
}

/// Bridge-local MIME inference — duplicate of the private helper in
/// `handlers::attachments` to avoid widening that module's surface. We
/// intentionally keep the table identical; if you add an extension
/// there, mirror it here.
fn mime_from_ext_bridge(path: &std::path::Path) -> &'static str {
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

// ---------------------------------------------------------------------
// MCP-EXPAND-A arms — roles / skills / mcp tools+servers / agent reports /
// tags / settings / workflow. Each helper mirrors the corresponding
// Tauri handler in `handlers::*` minus the event emit (events are a UI
// concern; agents observe results through the returned JSON row).
// ---------------------------------------------------------------------

/// Mirrors `handlers::tags::add_prompt_tag`. Idempotent on `(prompt_id,
/// tag_id)`. FK violations surface as `TransactionRolledBack`.
fn add_prompt_tag_arm(pool: &Pool, params: &Value) -> Result<Value, String> {
    let prompt_id = decode_string(params, "prompt_id")?;
    let tag_id = decode_string(params, "tag_id")?;
    let conn = acquire(pool).map_err(|e| format!("db acquire: {e}"))?;
    tags_repo::add_prompt_tag(&conn, &prompt_id, &tag_id).map_err(|e| format!("db: {e}"))?;
    Ok(json!({ "ok": true }))
}

/// Mirrors `handlers::tags::remove_prompt_tag`. Returns `NotFound`
/// when no row matched so the caller can distinguish a real detach from
/// a no-op.
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

/// Mirrors `handlers::roles::add_role_prompt`. ADR-0006 cascade — the
/// join insert and `task_prompts` materialisation share one immediate
/// transaction so the resolver never observes a half-attached state.
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

/// Mirrors `handlers::roles::remove_role_prompt`. Returns `NotFound`
/// when no join row matched. Inherited `task_prompts` rows tagged
/// `origin = 'role:<role_id>'` are stripped in the same transaction.
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

/// Mirrors `handlers::roles::add_role_skill`. ctq-121 cascade variant —
/// the join insert plus `task_skills` materialisation share one
/// immediate transaction.
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

/// Mirrors `handlers::roles::remove_role_skill`. Returns `NotFound`
/// when no join row matched.
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

/// Mirrors `handlers::roles::add_role_mcp_tool`. ctq-121 cascade
/// variant.
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

/// Mirrors `handlers::roles::remove_role_mcp_tool`. Returns `NotFound`
/// when no join row matched.
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

/// Mirrors `handlers::skills::delete_skill`. Scrubs the per-skill blob
/// directory under `<app_data>/skills/<id>` after the row is deleted.
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

/// Mirrors `handlers::skills::add_skill_file_attachment`. The blob is
/// sent as standard base64 over the wire — we decode here and hand
/// raw bytes to the use case so the size cap and atomic-write logic
/// stay in one place.
fn add_skill_file_attachment_arm(pool: &Pool, params: &Value) -> Result<Value, String> {
    use base64::{engine::general_purpose::STANDARD as BASE64, Engine as _};
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

/// Mirrors `handlers::skills::add_skill_git_attachment`. Git URL is
/// validated server-side; raw tokens MUST NOT be passed here — auth
/// belongs in the user's local git config / SSH keys.
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

/// Mirrors `handlers::skills::remove_skill_attachment`. Removes both
/// the metadata row AND the on-disk blob (file-kind only).
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

/// Mirrors `handlers::mcp_servers::create_mcp_server` minus the
/// best-effort introspect-on-create (that requires the live wire and
/// belongs in the async pre-arm path). The MCP surface caller can
/// follow up with `refresh_mcp_server` to populate the upstream tool
/// inventory.
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

/// Mirrors `handlers::mcp_servers::update_mcp_server`. Transport is
/// optional; the use case validates the merged transport/url/command
/// split against the schema invariant.
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

/// Decode a required [`Transport`] enum value. Accepts lowercase
/// `"stdio" | "http" | "sse"` per the wire convention.
fn decode_transport(params: &Value, field: &str) -> Result<Transport, String> {
    let raw = decode_string(params, field)?;
    parse_transport(&raw, field)
}

/// Optional [`Transport`] variant. Missing / null → `None`; an unknown
/// string is a validation error so we don't silently fall back to a
/// default.
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

// ---------------------------------------------------------------------
// Param-decoding helpers.
//
// Naming convention:
//   * `decode_*`             — required field; error on missing.
//   * `decode_optional_*`    — Option<T>; missing key OR null → None.
//   * `decode_tri_state_*`   — Option<Option<T>>; missing → None,
//                              null → Some(None), value → Some(Some(_)).
// ---------------------------------------------------------------------

/// Decode a required string field from the inbound `params` object.
///
/// Returns a stable error message that the MCP client surfaces; the
/// shape mirrors `AppError::Validation { field, reason }` so callers
/// can grep the same way.
fn decode_string(params: &Value, field: &str) -> Result<String, String> {
    params
        .get(field)
        .and_then(Value::as_str)
        .map(str::to_owned)
        .ok_or_else(|| format!("validation failed on `{field}`: missing or non-string"))
}

/// Decode a required `i64` field.
fn decode_i64(params: &Value, field: &str) -> Result<i64, String> {
    params
        .get(field)
        .and_then(Value::as_i64)
        .ok_or_else(|| format!("validation failed on `{field}`: missing or non-integer"))
}

/// Decode a required `f64` field. Integer JSON numbers are accepted
/// (serde widens them transparently).
fn decode_f64(params: &Value, field: &str) -> Result<f64, String> {
    params
        .get(field)
        .and_then(Value::as_f64)
        .ok_or_else(|| format!("validation failed on `{field}`: missing or non-number"))
}

/// Decode a required `bool` field.
fn decode_bool(params: &Value, field: &str) -> Result<bool, String> {
    params
        .get(field)
        .and_then(Value::as_bool)
        .ok_or_else(|| format!("validation failed on `{field}`: missing or non-bool"))
}

/// Decode a required `Vec<String>`. Empty arrays are accepted; missing
/// key OR non-array surfaces as a validation error.
fn decode_string_array(params: &Value, field: &str) -> Result<Vec<String>, String> {
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
/// `[]` is `Some(vec![])`. Non-array (and not-null) is treated as an
/// error caller can choose to ignore by mapping to `None`.
fn decode_optional_string_array(params: &Value, field: &str) -> Option<Vec<String>> {
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
fn decode_optional_string(params: &Value, field: &str) -> Option<String> {
    params.get(field).and_then(Value::as_str).map(str::to_owned)
}

/// Decode an `Option<f64>`. Missing key OR `null` → `None`.
fn decode_optional_f64(params: &Value, field: &str) -> Option<f64> {
    params.get(field).and_then(Value::as_f64)
}

/// Decode an `Option<i64>`. Missing key OR `null` → `None`. Used by
/// search arms whose `limit` argument is optional (the use-case defaults
/// kick in when `None`).
fn decode_optional_i64(params: &Value, field: &str) -> Option<i64> {
    params.get(field).and_then(Value::as_i64)
}

/// Decode an `Option<Option<String>>` clearable field — the Tauri
/// IPC's tri-state convention. Missing key → `None` (skip), JSON `null`
/// → `Some(None)` (clear), string → `Some(Some(s))` (set).
///
/// The `Option<Option<String>>` shape is load-bearing here: it mirrors
/// the Tauri serde contract for clearable fields (see
/// `handlers::prompts::update_prompt`, `handlers::spaces::update_space`).
/// A custom enum would force every downstream use case to either grow a
/// new param type OR re-translate at the bridge layer — neither buys us
/// anything since the application crate already consumes the
/// `Option<Option<T>>` shape natively.
#[allow(clippy::option_option)]
fn decode_tri_state_string(params: &Value, field: &str) -> Option<Option<String>> {
    match params.get(field) {
        Some(Value::Null) => Some(None),
        Some(Value::String(s)) => Some(Some(s.clone())),
        None | Some(_) => None,
    }
}

fn json_or_err<T: serde::Serialize>(value: &T) -> Result<Value, String> {
    serde_json::to_value(value).map_err(|e| format!("serialization error: {e}"))
}

/// Render an [`AppError`] for the MCP client. We pass the JSON-shape
/// through so a future MCP-side renderer can inspect `kind`/`data`.
fn stringify_app(err: AppError) -> String {
    let message = err.to_string();
    serde_json::to_string(&json!({
        "kind": "AppError",
        "error": err,
        "message": message,
    }))
    .unwrap_or(message)
}

#[cfg(test)]
mod tests {
    //! ctq-137 / MEM-S1: smoke tests for the three role-memory dispatch
    //! arms. We exercise the arms through the private `dispatch`
    //! entry point (same module) so the wire decoding path stays in
    //! scope, but stop short of standing up a full Tauri event bus —
    //! `events::emit` short-circuits when `AppState.app_handle` is
    //! unset, which is the contract documented in `events.rs`. Event
    //! emission is covered by the Tauri IPC handlers (which call the
    //! same use case + emit immediately after); here we focus on the
    //! decode + dispatch shape.
    //!
    //! Tool-manifest parse check guards against typo regressions
    //! between this file and `sidecar/tool-manifest.json`: every new
    //! entry must be well-formed JSON Schema AND match a dispatch arm
    //! by name.
    //!
    //! Agent-B expansion: smoke coverage for the prompts / prompt_groups
    //! / spaces arms. The provider arms cannot be exercised in unit
    //! tests because they reach for the filesystem; their dispatch
    //! shape is asserted via the manifest-parses test.
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
        assert!(added["tags"].as_array().unwrap().len() == 2);

        let recalled = dispatch(
            &pool,
            "recall_role_notes",
            json!({
                "role_id": "r1",
                "tags": ["rust"],
            }),
        )
        .expect("recall_role_notes dispatch");
        let arr = recalled.as_array().expect("array");
        assert_eq!(arr.len(), 1);
        assert_eq!(arr[0]["body"], "first retrospective");
    }

    #[test]
    fn dispatch_list_role_tags_returns_count_pairs() {
        let pool = fresh_pool_with_role("r1");
        let _ = dispatch(
            &pool,
            "add_role_note",
            json!({"role_id": "r1", "body": "n1", "tags": ["rust", "async"]}),
        )
        .unwrap();
        let _ = dispatch(
            &pool,
            "add_role_note",
            json!({"role_id": "r1", "body": "n2", "tags": ["rust"]}),
        )
        .unwrap();

        let cloud = dispatch(&pool, "list_role_tags", json!({"role_id": "r1"}))
            .expect("list_role_tags dispatch");
        let arr = cloud.as_array().expect("array");
        assert_eq!(arr.len(), 2);
        // First entry is the most common tag ("rust", count 2).
        assert_eq!(arr[0]["tag"], "rust");
        assert_eq!(arr[0]["count"], 2);
    }

    #[test]
    fn dispatch_add_role_note_missing_role_returns_typed_app_error() {
        let pool = fresh_pool_with_role("r1");
        let err = dispatch(
            &pool,
            "add_role_note",
            json!({"role_id": "ghost", "body": "n", "tags": ["rust"]}),
        )
        .expect_err("nf");
        // Stringified AppError JSON carries `kind: "AppError"` envelope
        // + `error.kind: "notFound"`.
        let parsed: serde_json::Value = serde_json::from_str(&err).expect("AppError envelope JSON");
        assert_eq!(parsed["kind"], "AppError");
        assert_eq!(parsed["error"]["kind"], "notFound");
        assert_eq!(parsed["error"]["data"]["entity"], "role");
    }

    #[test]
    fn dispatch_recall_with_zero_limit_returns_empty_array() {
        let pool = fresh_pool_with_role("r1");
        let _ = dispatch(
            &pool,
            "add_role_note",
            json!({"role_id": "r1", "body": "n", "tags": ["rust"]}),
        )
        .unwrap();
        let out = dispatch(
            &pool,
            "recall_role_notes",
            json!({"role_id": "r1", "tags": ["rust"], "limit": 0}),
        )
        .unwrap();
        assert!(out.as_array().unwrap().is_empty());
    }

    #[test]
    fn dispatch_unknown_method_returns_error() {
        let pool = fresh_pool_with_role("r1");
        let err = dispatch(&pool, "totally_unknown", json!({})).expect_err("unknown");
        assert!(err.contains("Unknown ipc_call method"));
    }

    #[test]
    fn dispatch_create_then_list_prompt_round_trip() {
        let pool = fresh_pool();

        let created = dispatch(
            &pool,
            "create_prompt",
            json!({
                "name": "P1",
                "content": "hello",
            }),
        )
        .expect("create_prompt dispatch");
        let id = created["id"].as_str().expect("id").to_owned();

        let listed = dispatch(&pool, "list_prompts", json!({})).expect("list_prompts dispatch");
        let arr = listed.as_array().expect("array");
        assert_eq!(arr.len(), 1);
        assert_eq!(arr[0]["id"], id);
        assert_eq!(arr[0]["name"], "P1");

        // get_prompt round-trip.
        let got = dispatch(&pool, "get_prompt", json!({"id": id})).expect("get_prompt");
        assert_eq!(got["name"], "P1");
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
        assert_eq!(created["icon"], "star");

        // null clears the icon back to NULL.
        let updated = dispatch(&pool, "update_prompt", json!({"id": id, "icon": null})).unwrap();
        assert!(updated["icon"].is_null());
    }

    #[test]
    fn dispatch_create_space_then_get() {
        let pool = fresh_pool();
        let space = dispatch(&pool, "create_space", json!({"name": "S1", "prefix": "s1"}))
            .expect("create_space");
        let id = space["id"].as_str().expect("id").to_owned();

        let got = dispatch(&pool, "get_space", json!({"id": id})).expect("get_space");
        assert_eq!(got["name"], "S1");
        assert_eq!(got["prefix"], "s1");
    }

    #[test]
    fn dispatch_set_space_prompts_replaces_and_clears() {
        let pool = fresh_pool();
        let space = dispatch(&pool, "create_space", json!({"name": "S", "prefix": "sp"})).unwrap();
        let space_id = space["id"].as_str().unwrap().to_owned();

        // Seed three prompts and bulk-set them.
        let mut ids = Vec::new();
        for n in ["P1", "P2", "P3"] {
            let p = dispatch(&pool, "create_prompt", json!({"name": n, "content": ""})).unwrap();
            ids.push(p["id"].as_str().unwrap().to_owned());
        }
        dispatch(
            &pool,
            "set_space_prompts",
            json!({"space_id": space_id, "prompt_ids": ids}),
        )
        .unwrap();
        let listed = dispatch(&pool, "list_space_prompts", json!({"space_id": space_id})).unwrap();
        assert_eq!(listed.as_array().unwrap().len(), 3);

        // Empty array clears.
        dispatch(
            &pool,
            "set_space_prompts",
            json!({"space_id": space_id, "prompt_ids": []}),
        )
        .unwrap();
        let listed = dispatch(&pool, "list_space_prompts", json!({"space_id": space_id})).unwrap();
        assert!(listed.as_array().unwrap().is_empty());
    }

    #[test]
    fn dispatch_prompt_group_members_round_trip() {
        let pool = fresh_pool();
        // Create group + two prompts.
        let group =
            dispatch(&pool, "create_prompt_group", json!({"name": "G"})).expect("create_pg");
        let group_id = group["id"].as_str().unwrap().to_owned();
        let p1 = dispatch(&pool, "create_prompt", json!({"name": "P1", "content": ""})).unwrap();
        let p2 = dispatch(&pool, "create_prompt", json!({"name": "P2", "content": ""})).unwrap();
        let p1_id = p1["id"].as_str().unwrap().to_owned();
        let p2_id = p2["id"].as_str().unwrap().to_owned();

        // set_members replaces.
        dispatch(
            &pool,
            "set_prompt_group_members",
            json!({
                "group_id": group_id,
                "ordered_prompt_ids": [p1_id.clone(), p2_id.clone()],
            }),
        )
        .unwrap();

        let members = dispatch(
            &pool,
            "list_prompt_group_members",
            json!({"group_id": group_id}),
        )
        .unwrap();
        let arr = members.as_array().unwrap();
        assert_eq!(arr.len(), 2);
        assert_eq!(arr[0], p1_id);
        assert_eq!(arr[1], p2_id);

        // remove_member shrinks.
        dispatch(
            &pool,
            "remove_prompt_group_member",
            json!({"group_id": group_id, "prompt_id": p1_id}),
        )
        .unwrap();
        let members = dispatch(
            &pool,
            "list_prompt_group_members",
            json!({"group_id": group_id}),
        )
        .unwrap();
        assert_eq!(members.as_array().unwrap().len(), 1);
    }

    #[test]
    fn dispatch_list_supported_providers_returns_catalogue() {
        let pool = fresh_pool();
        let out = dispatch(&pool, "list_supported_providers", json!({})).unwrap();
        let arr = out.as_array().expect("array");
        assert!(
            !arr.is_empty(),
            "static provider catalogue must be non-empty"
        );
        // Every entry must carry the four documented fields (camelCase
        // via SupportedProvider serde rename).
        for entry in arr {
            assert!(entry.get("id").and_then(Value::as_str).is_some());
            assert!(entry.get("displayName").and_then(Value::as_str).is_some());
        }
    }

    #[test]
    fn tool_manifest_parses_and_includes_role_memory_entries() {
        // Re-load the manifest the sidecar advertises; the new MEM-S1
        // entries MUST be addressable by exact name and carry a
        // well-formed JSON Schema.
        let raw = include_str!("../../../../sidecar/tool-manifest.json");
        let parsed: serde_json::Value =
            serde_json::from_str(raw).expect("tool-manifest.json must be valid JSON");
        let tools = parsed["tools"].as_array().expect("tools[]");
        let names: Vec<&str> = tools
            .iter()
            .map(|t| t["name"].as_str().expect("name"))
            .collect();
        for required in ["recall_role_notes", "add_role_note", "list_role_tags"] {
            assert!(
                names.contains(&required),
                "missing manifest entry: {required}",
            );
        }
        // Every entry has an `inputSchema.type == "object"` body.
        for tool in tools {
            assert_eq!(
                tool["inputSchema"]["type"], "object",
                "tool `{}` missing inputSchema.type=object",
                tool["name"],
            );
        }
    }

    #[test]
    fn manifest_role_memory_tools_have_required_role_id_arg() {
        // The agent surface always pivots on `role_id`; the manifest
        // must list it as required so the MCP client refuses to call
        // without it.
        let raw = include_str!("../../../../sidecar/tool-manifest.json");
        let parsed: serde_json::Value = serde_json::from_str(raw).unwrap();
        for name in ["recall_role_notes", "add_role_note", "list_role_tags"] {
            let tool = parsed["tools"]
                .as_array()
                .unwrap()
                .iter()
                .find(|t| t["name"] == name)
                .unwrap_or_else(|| panic!("manifest missing tool {name}"));
            let required = tool["inputSchema"]["required"]
                .as_array()
                .expect("required[]");
            assert!(
                required.iter().any(|r| r == "role_id"),
                "tool {name} must require role_id",
            );
        }
    }

    #[test]
    fn manifest_agent_b_expansion_entries_present() {
        // Every Agent-B tool must show up in the manifest by exact name
        // with a `description` and a JSON-schema `inputSchema`.
        let raw = include_str!("../../../../sidecar/tool-manifest.json");
        let parsed: serde_json::Value = serde_json::from_str(raw).unwrap();
        let tools = parsed["tools"].as_array().unwrap();
        let names: Vec<&str> = tools.iter().map(|t| t["name"].as_str().unwrap()).collect();
        // Spot-check across all four sub-domains. The full list also
        // includes every other entry — covering ~45 here would just be
        // a transcription test; we lean on
        // `manifest_entries_have_descriptions` for breadth.
        for required in [
            // prompts
            "create_prompt",
            "delete_prompt",
            "get_prompt",
            "list_prompts",
            "update_prompt",
            "set_board_prompts",
            "set_column_prompts",
            "set_space_prompts",
            "recompute_prompt_token_count",
            "set_task_prompt_override",
            "clear_task_prompt_override",
            // prompt groups
            "create_prompt_group",
            "list_prompt_groups",
            "list_prompt_group_members",
            "set_prompt_group_members",
            // spaces
            "create_space",
            "list_spaces",
            "update_space",
            "set_space_skills",
            "set_space_mcp_tools",
            // providers
            "add_provider",
            "remove_provider",
            "list_supported_providers",
            "list_connected_providers",
            "get_sync_status",
        ] {
            assert!(
                names.contains(&required),
                "missing manifest entry: {required}",
            );
        }
    }

    #[test]
    fn manifest_entries_have_descriptions() {
        // Project convention: every tool MUST carry a top-level
        // `description` so the MCP client renders a meaningful tooltip
        // before the agent decides to invoke. Catch typos / paste
        // omissions early.
        let raw = include_str!("../../../../sidecar/tool-manifest.json");
        let parsed: serde_json::Value = serde_json::from_str(raw).unwrap();
        for tool in parsed["tools"].as_array().unwrap() {
            let name = tool["name"].as_str().unwrap();
            let desc = tool["description"]
                .as_str()
                .unwrap_or_else(|| panic!("tool `{name}` missing top-level description"));
            assert!(
                desc.len() >= 30,
                "tool `{name}` description too short ({} chars) — write 2-4 sentences",
                desc.len()
            );
        }
    }

    #[test]
    fn manifest_arm_names_match_dispatch_table() {
        // Sanity: every tool name in the manifest (excluding the
        // internal supervisor-channel arms `list_proxied_tools` and
        // `resolve_keychain`, plus the async-only `proxy_tool_call` and
        // the provider mutators which are gated in `install`) must
        // resolve to *something* in `dispatch` — either successfully
        // or with a typed AppError. An "Unknown ipc_call method"
        // string means the manifest declared a tool the bridge can't
        // honour.
        let raw = include_str!("../../../../sidecar/tool-manifest.json");
        let parsed: serde_json::Value = serde_json::from_str(raw).unwrap();
        let pool = fresh_pool();
        // Names handled outside `dispatch` (async pre-arms in
        // `install`) — skip them, they're not in the sync match.
        // MCP-EXPAND-A added `refresh_mcp_server` to the async slot
        // because the introspection step requires the live wire.
        let async_only = [
            "add_provider",
            "remove_provider",
            "proxy_tool_call",
            "refresh_mcp_server",
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

    // -----------------------------------------------------------------
    // MCP-EXPAND-C smoke tests — tasks / boards / columns / attachments /
    // search dispatch arms. Mirror the shape of B's coverage: at least
    // one happy-path round-trip per sub-domain plus a couple of
    // contract-bearing edge cases (search empty query, rate_task out of
    // range). We piggy-back on B's `fresh_pool` and add a board/column
    // fixture so the task arms have a parent to FK against.
    // -----------------------------------------------------------------

    /// Seed an in-memory DB by calling `create_space` (which provisions
    /// one default board + default column) and resolving their ids so
    /// task-domain dispatch tests have a real parent to FK against.
    /// Returns `(pool, board_id, column_id)`. We deliberately reuse the
    /// auto-provisioned board rather than minting a second one — migration
    /// 016 enforces UNIQUE(space_id, owner_role_id) so a NULL-owner second
    /// board would collide.
    fn fresh_pool_with_board() -> (Pool, String, String) {
        let pool = fresh_pool();
        let space = dispatch(&pool, "create_space", json!({"name": "S", "prefix": "sp"})).unwrap();
        let space_id = space["id"].as_str().unwrap().to_owned();
        let conn = pool.get().unwrap();
        let (board_id, column_id) = conn
            .query_row(
                "SELECT b.id, c.id \
                 FROM boards b \
                 JOIN columns c ON c.board_id = b.id AND c.is_default = 1 \
                 WHERE b.space_id = ?1 \
                 LIMIT 1",
                rusqlite::params![space_id],
                |r| Ok((r.get::<_, String>(0)?, r.get::<_, String>(1)?)),
            )
            .expect("create_space must provision a default board + default column");
        drop(conn);
        (pool, board_id, column_id)
    }

    #[test]
    fn dispatch_create_task_then_get_and_delete() {
        let (pool, board_id, column_id) = fresh_pool_with_board();
        let task = dispatch(
            &pool,
            "create_task",
            json!({
                "board_id": board_id,
                "column_id": column_id,
                "title": "T1",
                "position": 1.0,
            }),
        )
        .expect("create_task");
        let id = task["id"].as_str().expect("id").to_owned();
        assert_eq!(task["title"], "T1");

        let got = dispatch(&pool, "get_task", json!({"id": id.clone()})).expect("get_task");
        assert_eq!(got["title"], "T1");

        dispatch(&pool, "delete_task", json!({"id": id.clone()})).expect("delete_task");
        // get_task after delete → typed NotFound (`AppError` envelope).
        let err = dispatch(&pool, "get_task", json!({"id": id}))
            .expect_err("post-delete get_task must fail");
        let parsed: serde_json::Value = serde_json::from_str(&err).expect("AppError envelope JSON");
        assert_eq!(parsed["error"]["kind"], "notFound");
    }

    #[test]
    fn dispatch_log_step_appends_and_get_step_log_reads() {
        let (pool, board_id, column_id) = fresh_pool_with_board();
        let task = dispatch(
            &pool,
            "create_task",
            json!({
                "board_id": board_id,
                "column_id": column_id,
                "title": "T1",
                "position": 1.0,
            }),
        )
        .unwrap();
        let task_id = task["id"].as_str().unwrap().to_owned();

        dispatch(
            &pool,
            "log_step",
            json!({"task_id": task_id, "summary": "started work"}),
        )
        .expect("log_step");
        let buf =
            dispatch(&pool, "get_step_log", json!({"task_id": task_id})).expect("get_step_log");
        let text = buf.as_str().expect("step log is a string");
        assert!(
            text.contains("started work"),
            "step log must contain the appended summary: {text}"
        );
    }

    #[test]
    fn dispatch_rate_task_round_trips_and_rejects_out_of_range() {
        let (pool, board_id, column_id) = fresh_pool_with_board();
        let task = dispatch(
            &pool,
            "create_task",
            json!({
                "board_id": board_id,
                "column_id": column_id,
                "title": "T1",
                "position": 1.0,
            }),
        )
        .unwrap();
        let task_id = task["id"].as_str().unwrap().to_owned();

        dispatch(&pool, "rate_task", json!({"task_id": task_id, "rating": 1}))
            .expect("rate_task +1");
        let got = dispatch(
            &pool,
            "get_task_rating",
            json!({"task_id": task_id.clone()}),
        )
        .expect("get_task_rating");
        assert_eq!(got["rating"], 1);

        // Out-of-range surfaces as a typed Validation error.
        let err = dispatch(&pool, "rate_task", json!({"task_id": task_id, "rating": 7}))
            .expect_err("rate_task 7 must fail");
        let parsed: serde_json::Value = serde_json::from_str(&err).expect("AppError envelope");
        assert_eq!(parsed["error"]["kind"], "validation");
    }

    #[test]
    fn dispatch_move_task_requires_column_or_board() {
        let (pool, board_id, column_id) = fresh_pool_with_board();
        let task = dispatch(
            &pool,
            "create_task",
            json!({
                "board_id": board_id,
                "column_id": column_id,
                "title": "T",
                "position": 1.0,
            }),
        )
        .unwrap();
        let task_id = task["id"].as_str().unwrap().to_owned();

        let err = dispatch(&pool, "move_task", json!({"task_id": task_id}))
            .expect_err("move_task with neither column nor board must fail");
        let parsed: serde_json::Value = serde_json::from_str(&err).expect("AppError envelope");
        assert_eq!(parsed["error"]["kind"], "validation");
    }

    #[test]
    fn dispatch_get_board_returns_row_and_delete_default_is_refused() {
        let (pool, board_id, _column_id) = fresh_pool_with_board();
        let got = dispatch(&pool, "get_board", json!({"id": board_id.clone()})).expect("get_board");
        // The default board provisioned by `create_space` carries its
        // own name (migration `016_*` stamps it); we don't assert the
        // exact name to stay decoupled from migration cosmetics, only
        // that `get_board` returned the row for our board id.
        assert_eq!(got["id"], board_id);

        // `delete_board` against the space's only board surfaces a
        // typed Validation error — the default-board guard refuses to
        // orphan a space. Confirming the typed shape doubles as a
        // contract test for the AppError envelope.
        let err = dispatch(&pool, "delete_board", json!({"id": board_id}))
            .expect_err("default-board delete must be refused");
        let parsed: serde_json::Value = serde_json::from_str(&err).expect("AppError envelope");
        assert_eq!(parsed["error"]["kind"], "validation");
    }

    #[test]
    fn dispatch_create_column_round_trips_and_update_renames() {
        let (pool, board_id, _column_id) = fresh_pool_with_board();
        let col = dispatch(
            &pool,
            "create_column",
            json!({"board_id": board_id, "name": "Doing", "position": 1}),
        )
        .expect("create_column");
        let id = col["id"].as_str().unwrap().to_owned();
        assert_eq!(col["name"], "Doing");

        let renamed = dispatch(
            &pool,
            "update_column",
            json!({"id": id.clone(), "name": "In Progress"}),
        )
        .expect("update_column");
        assert_eq!(renamed["name"], "In Progress");
    }

    #[test]
    fn dispatch_list_attachments_returns_empty_when_no_rows() {
        let pool = fresh_pool();
        let out = dispatch(&pool, "list_attachments", json!({})).expect("list_attachments");
        assert!(out.as_array().unwrap().is_empty());
    }

    #[test]
    fn dispatch_search_tasks_empty_query_returns_empty_array() {
        let pool = fresh_pool();
        // Empty / whitespace query short-circuits before the DB.
        let out =
            dispatch(&pool, "search_tasks", json!({"query": ""})).expect("search_tasks empty");
        assert!(out.as_array().unwrap().is_empty());
        let out =
            dispatch(&pool, "search_all", json!({"query": "   "})).expect("search_all whitespace");
        assert!(out.as_array().unwrap().is_empty());
    }

    #[test]
    fn manifest_expand_c_entries_present() {
        // Spot-check every C sub-domain shows up in the manifest. Full
        // coverage is enforced by `manifest_arm_names_match_dispatch_table`
        // already; this guards against an accidental rename between
        // dispatch arm and manifest entry.
        let raw = include_str!("../../../../sidecar/tool-manifest.json");
        let parsed: serde_json::Value = serde_json::from_str(raw).unwrap();
        let tools = parsed["tools"].as_array().unwrap();
        let names: Vec<&str> = tools.iter().map(|t| t["name"].as_str().unwrap()).collect();
        for required in [
            // tasks core
            "create_task",
            "delete_task",
            "update_task",
            "move_task",
            "route_task_to_board",
            "rate_task",
            "get_task_rating",
            "log_step",
            "get_step_log",
            // task joins
            "add_task_skill",
            "add_task_mcp_tool",
            "remove_task_skill",
            "remove_task_mcp_tool",
            "list_task_prompts",
            "list_task_skills",
            "list_task_mcp_tools",
            // boards
            "get_board",
            "delete_board",
            "set_board_skills",
            "set_board_mcp_tools",
            "set_board_owner",
            // columns
            "create_column",
            "delete_column",
            "get_column",
            "update_column",
            "set_column_skills",
            "set_column_mcp_tools",
            // attachments
            "create_attachment",
            "delete_attachment",
            "get_attachment",
            "update_attachment",
            "list_attachments",
            "upload_attachment",
            "upload_attachment_blob",
            // search
            "search_all",
            "search_tasks",
            "search_agent_reports",
            "search_tasks_by_cat_and_space",
        ] {
            assert!(
                names.contains(&required),
                "missing manifest entry: {required}",
            );
        }
    }

    #[test]
    fn manifest_is_alphabetically_sorted() {
        // The bridge module doc lists the alphabetical-order invariant
        // for the dispatch match; the manifest must follow the same
        // convention so a casual reader can binary-scan either side.
        let raw = include_str!("../../../../sidecar/tool-manifest.json");
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

    // -----------------------------------------------------------------
    // MCP-EXPAND-A smoke tests — roles / skills / mcp tools+servers /
    // agent reports / tags / settings / workflow dispatch arms. One
    // happy-path round-trip per sub-domain plus a couple of
    // contract-bearing edge cases. Follows the B+C pattern.
    // -----------------------------------------------------------------

    #[test]
    fn dispatch_create_role_round_trips_and_lists() {
        let pool = fresh_pool();
        let role = dispatch(
            &pool,
            "create_role",
            json!({"name": "Reviewer", "content": "Body"}),
        )
        .expect("create_role");
        let id = role["id"].as_str().unwrap().to_owned();
        assert_eq!(role["name"], "Reviewer");

        let got = dispatch(&pool, "get_role", json!({"id": id.clone()})).expect("get_role");
        assert_eq!(got["content"], "Body");

        let listed = dispatch(&pool, "list_roles", json!({})).expect("list_roles");
        let arr = listed.as_array().unwrap();
        assert!(arr.iter().any(|r| r["id"] == id));
    }

    #[test]
    fn dispatch_delete_role_refuses_system_row_with_forbidden() {
        // Migration `004_cat_as_agent_phase1.sql` seeds
        // `maintainer-system` as `is_system = 1`. The use-case guard
        // must surface a typed Forbidden envelope.
        let pool = fresh_pool();
        let err = dispatch(&pool, "delete_role", json!({"id": "maintainer-system"}))
            .expect_err("forbidden");
        let parsed: serde_json::Value = serde_json::from_str(&err).expect("AppError envelope");
        assert_eq!(parsed["error"]["kind"], "forbidden");
    }

    #[test]
    fn dispatch_create_skill_then_attach_and_remove_git_attachment() {
        let pool = fresh_pool();
        let skill = dispatch(
            &pool,
            "create_skill",
            json!({"name": "Rust", "position": 0.0}),
        )
        .expect("create_skill");
        let skill_id = skill["id"].as_str().unwrap().to_owned();

        let att = dispatch(
            &pool,
            "add_skill_git_attachment",
            json!({"skill_id": skill_id.clone(), "git_url": "https://example.com/repo.git"}),
        )
        .expect("add_skill_git_attachment");
        let att_id = att["id"].as_str().unwrap().to_owned();

        let listed = dispatch(
            &pool,
            "list_skill_attachments",
            json!({"skill_id": skill_id}),
        )
        .expect("list_skill_attachments");
        assert_eq!(listed.as_array().unwrap().len(), 1);

        dispatch(
            &pool,
            "remove_skill_attachment",
            json!({"attachment_id": att_id}),
        )
        .expect("remove_skill_attachment");
    }

    #[test]
    fn dispatch_create_mcp_tool_then_list_and_delete() {
        let pool = fresh_pool();
        let tool = dispatch(
            &pool,
            "create_mcp_tool",
            json!({
                "name": "echo",
                "schema_json": "{\"type\":\"object\"}",
                "position": 0.0,
            }),
        )
        .expect("create_mcp_tool");
        let id = tool["id"].as_str().unwrap().to_owned();

        let listed = dispatch(&pool, "list_mcp_tools", json!({})).expect("list_mcp_tools");
        assert!(listed.as_array().unwrap().iter().any(|t| t["id"] == id));

        dispatch(&pool, "delete_mcp_tool", json!({"id": id.clone()})).expect("delete_mcp_tool");
        let err = dispatch(&pool, "get_mcp_tool", json!({"id": id}))
            .expect_err("post-delete get_mcp_tool must fail");
        let parsed: serde_json::Value = serde_json::from_str(&err).expect("AppError envelope");
        assert_eq!(parsed["error"]["kind"], "notFound");
    }

    #[test]
    fn dispatch_create_mcp_server_stdio_round_trips() {
        let pool = fresh_pool();
        let server = dispatch(
            &pool,
            "create_mcp_server",
            json!({
                "name": "local-echo",
                "transport": "stdio",
                "command": "/bin/echo",
            }),
        )
        .expect("create_mcp_server");
        let id = server["id"].as_str().unwrap().to_owned();
        assert_eq!(server["transport"], "stdio");
        assert_eq!(server["command"], "/bin/echo");

        let got =
            dispatch(&pool, "get_mcp_server", json!({"id": id.clone()})).expect("get_mcp_server");
        assert_eq!(got["name"], "local-echo");

        let listed = dispatch(&pool, "list_mcp_servers", json!({})).expect("list_mcp_servers");
        assert!(listed.as_array().unwrap().iter().any(|s| s["id"] == id));

        let status = dispatch(&pool, "get_mcp_server_status", json!({"id": id.clone()}))
            .expect("get_mcp_server_status");
        // Fresh server, never introspected → tool_count = 0,
        // state = "unreachable" (lowercase per the rename_all).
        assert_eq!(status["toolCount"], 0);
        assert_eq!(status["state"], "unreachable");
    }

    #[test]
    fn dispatch_create_mcp_server_rejects_unknown_transport() {
        let pool = fresh_pool();
        let err = dispatch(
            &pool,
            "create_mcp_server",
            json!({"name": "x", "transport": "bogus"}),
        )
        .expect_err("unknown transport must fail");
        assert!(
            err.contains("transport"),
            "error must mention transport: {err}"
        );
    }

    #[test]
    fn dispatch_create_then_update_tag_clears_color_via_null() {
        let pool = fresh_pool();
        let tag = dispatch(
            &pool,
            "create_tag",
            json!({"name": "rust", "color": "#abcdef"}),
        )
        .expect("create_tag");
        let id = tag["id"].as_str().unwrap().to_owned();
        assert_eq!(tag["color"], "#abcdef");

        let updated =
            dispatch(&pool, "update_tag", json!({"id": id, "color": null})).expect("update_tag");
        assert!(updated["color"].is_null());
    }

    #[test]
    fn dispatch_add_and_remove_prompt_tag_round_trip() {
        let pool = fresh_pool();
        let prompt = dispatch(&pool, "create_prompt", json!({"name": "P", "content": ""})).unwrap();
        let prompt_id = prompt["id"].as_str().unwrap().to_owned();
        let tag = dispatch(&pool, "create_tag", json!({"name": "t1"})).unwrap();
        let tag_id = tag["id"].as_str().unwrap().to_owned();

        dispatch(
            &pool,
            "add_prompt_tag",
            json!({"prompt_id": prompt_id.clone(), "tag_id": tag_id.clone()}),
        )
        .expect("add_prompt_tag");

        let map = dispatch(&pool, "list_prompt_tags_map", json!({})).expect("list_prompt_tags_map");
        let arr = map.as_array().unwrap();
        let entry = arr
            .iter()
            .find(|e| e["promptId"] == prompt_id)
            .expect("prompt entry");
        let tags = entry["tagIds"].as_array().unwrap();
        assert_eq!(tags.len(), 1);

        dispatch(
            &pool,
            "remove_prompt_tag",
            json!({"prompt_id": prompt_id.clone(), "tag_id": tag_id.clone()}),
        )
        .expect("remove_prompt_tag");
        // Re-removing must surface NotFound — agents need to
        // distinguish a real detach from a stale state.
        let err = dispatch(
            &pool,
            "remove_prompt_tag",
            json!({"prompt_id": prompt_id, "tag_id": tag_id}),
        )
        .expect_err("re-remove must fail");
        let parsed: serde_json::Value = serde_json::from_str(&err).expect("AppError envelope");
        assert_eq!(parsed["error"]["kind"], "notFound");
    }

    #[test]
    fn dispatch_set_role_prompts_replaces_and_clears() {
        let pool = fresh_pool();
        let role = dispatch(&pool, "create_role", json!({"name": "R", "content": ""})).unwrap();
        let role_id = role["id"].as_str().unwrap().to_owned();

        let mut ids = Vec::new();
        for n in ["P1", "P2"] {
            let p = dispatch(&pool, "create_prompt", json!({"name": n, "content": ""})).unwrap();
            ids.push(p["id"].as_str().unwrap().to_owned());
        }
        dispatch(
            &pool,
            "set_role_prompts",
            json!({"role_id": role_id.clone(), "prompt_ids": ids}),
        )
        .expect("set_role_prompts");

        // Empty list clears.
        dispatch(
            &pool,
            "set_role_prompts",
            json!({"role_id": role_id, "prompt_ids": []}),
        )
        .expect("set_role_prompts clear");
    }

    #[test]
    fn dispatch_get_and_set_setting_round_trip() {
        let pool = fresh_pool();
        // Absent key → null.
        let got =
            dispatch(&pool, "get_setting", json!({"key": "selected_space"})).expect("get_setting");
        assert!(got.is_null());

        dispatch(
            &pool,
            "set_setting",
            json!({"key": "selected_space", "value": "spc_1"}),
        )
        .expect("set_setting");
        let got = dispatch(&pool, "get_setting", json!({"key": "selected_space"}))
            .expect("get_setting after set");
        assert_eq!(got, "spc_1");
    }

    #[test]
    fn dispatch_create_then_list_agent_report() {
        let (pool, board_id, column_id) = fresh_pool_with_board();
        let task = dispatch(
            &pool,
            "create_task",
            json!({
                "board_id": board_id,
                "column_id": column_id,
                "title": "T",
                "position": 1.0,
            }),
        )
        .unwrap();
        let task_id = task["id"].as_str().unwrap().to_owned();

        let report = dispatch(
            &pool,
            "create_agent_report",
            json!({
                "task_id": task_id.clone(),
                "kind": "progress",
                "title": "Step 1",
                "content": "Body",
            }),
        )
        .expect("create_agent_report");
        let report_id = report["id"].as_str().unwrap().to_owned();

        let listed = dispatch(&pool, "list_agent_reports", json!({"task_id": task_id}))
            .expect("list_agent_reports");
        assert_eq!(listed.as_array().unwrap().len(), 1);

        let got = dispatch(&pool, "get_agent_report", json!({"id": report_id.clone()}))
            .expect("get_agent_report");
        assert_eq!(got["title"], "Step 1");

        dispatch(&pool, "delete_agent_report", json!({"id": report_id}))
            .expect("delete_agent_report");
    }

    #[test]
    fn dispatch_workflow_graph_round_trip_arbitrary_string() {
        let pool = fresh_pool();
        let space = dispatch(&pool, "create_space", json!({"name": "S", "prefix": "wf"})).unwrap();
        let space_id = space["id"].as_str().unwrap().to_owned();

        let initial = dispatch(
            &pool,
            "get_workflow_graph",
            json!({"space_id": space_id.clone()}),
        )
        .expect("get_workflow_graph (initial)");
        assert!(initial.is_null());

        dispatch(
            &pool,
            "set_workflow_graph",
            json!({"space_id": space_id.clone(), "json": "{\"nodes\":[]}"}),
        )
        .expect("set_workflow_graph");

        let got = dispatch(&pool, "get_workflow_graph", json!({"space_id": space_id}))
            .expect("get_workflow_graph (after set)");
        assert_eq!(got, "{\"nodes\":[]}");
    }

    #[test]
    fn manifest_expand_a_entries_present() {
        // Spot-check every A sub-domain shows up. Full coverage is
        // enforced by `manifest_arm_names_match_dispatch_table` and
        // `manifest_is_alphabetically_sorted`; this guards against an
        // accidental rename between dispatch arm and manifest entry.
        let raw = include_str!("../../../../sidecar/tool-manifest.json");
        let parsed: serde_json::Value = serde_json::from_str(raw).unwrap();
        let names: Vec<&str> = parsed["tools"]
            .as_array()
            .unwrap()
            .iter()
            .map(|t| t["name"].as_str().unwrap())
            .collect();
        for required in [
            // roles
            "create_role",
            "delete_role",
            "get_role",
            "list_roles",
            "update_role",
            "add_role_prompt",
            "add_role_skill",
            "add_role_mcp_tool",
            "remove_role_prompt",
            "remove_role_skill",
            "remove_role_mcp_tool",
            "list_role_skills",
            "list_role_mcp_tools",
            "set_role_prompts",
            // skills
            "create_skill",
            "delete_skill",
            "get_skill",
            "list_skills",
            "update_skill",
            "add_skill_file_attachment",
            "add_skill_git_attachment",
            "remove_skill_attachment",
            "list_skill_attachments",
            // mcp tools
            "create_mcp_tool",
            "delete_mcp_tool",
            "get_mcp_tool",
            "list_mcp_tools",
            "update_mcp_tool",
            // mcp servers
            "create_mcp_server",
            "delete_mcp_server",
            "get_mcp_server",
            "list_mcp_servers",
            "update_mcp_server",
            "refresh_mcp_server",
            "get_mcp_server_status",
            "list_mcp_tools_by_server",
            // agent reports
            "create_agent_report",
            "delete_agent_report",
            "get_agent_report",
            "list_agent_reports",
            "update_agent_report",
            // tags
            "create_tag",
            "delete_tag",
            "get_tag",
            "list_tags",
            "update_tag",
            "add_prompt_tag",
            "remove_prompt_tag",
            "set_tag_prompts",
            "list_prompt_tags_map",
            // settings
            "get_setting",
            "set_setting",
            // workflow
            "get_workflow_graph",
            "set_workflow_graph",
        ] {
            assert!(
                names.contains(&required),
                "missing manifest entry: {required}",
            );
        }
    }
}
