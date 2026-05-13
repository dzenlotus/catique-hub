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
    boards::BoardsUseCase,
    clients::ConnectedProvidersUseCase,
    columns::ColumnsUseCase,
    connected_providers::{build_bundle_for_test, OrchestratorHandle, SyncTrigger},
    mcp_proxy::{McpProxyUseCase, UpstreamCaller, UpstreamError},
    mcp_servers::{McpServersUseCase, ServerWireMeta, UpstreamIntrospector, UpstreamToolDecl},
    prompt_groups::PromptGroupsUseCase,
    prompts::PromptsUseCase,
    role_notes::RoleNotesUseCase,
    spaces::{CreateSpaceArgs, SpacesUseCase, UpdateSpaceArgs},
    tasks::TasksUseCase,
    AppError,
};
use catique_domain::RoleNoteAuthor;
use catique_infrastructure::{
    db::{
        pool::{acquire, Pool},
        repositories::{
            mcp_servers as servers_repo, prompts as prompts_repo,
            tasks::{cascade_prompt_attachment, cascade_prompt_detachment, AttachScope},
        },
    },
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
            // the wire (proxy_tool_call) or the orchestrator (provider
            // mutators). They cannot live in the `spawn_blocking` path.
            match method.as_str() {
                "proxy_tool_call" => return proxy_tool_call_arm(&pool, &mgr, params).await,
                "add_provider" => return add_provider_arm(&pool, orch.as_ref(), params).await,
                "remove_provider" => {
                    return remove_provider_arm(&pool, orch.as_ref(), params).await
                }
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
        "add_role_note" => add_role_note_arm(pool, &params),
        "add_space_prompt" => {
            let space_id = decode_string(&params, "space_id")?;
            let prompt_id = decode_string(&params, "prompt_id")?;
            let position = decode_optional_f64(&params, "position");
            SpacesUseCase::new(pool)
                .add_space_prompt(&space_id, &prompt_id, position)
                .map_err(stringify_app)?;
            Ok(json!({ "ok": true }))
        }
        "add_task_prompt" => add_task_prompt_arm(pool, &params),
        "clear_task_prompt_override" => clear_task_prompt_override_arm(pool, &params),
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
        "delete_space" => {
            let id = decode_string(&params, "id")?;
            SpacesUseCase::new(pool)
                .delete(&id)
                .map_err(stringify_app)?;
            Ok(json!({ "ok": true }))
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
        "get_space" => {
            let id = decode_string(&params, "id")?;
            let space = SpacesUseCase::new(pool).get(&id).map_err(stringify_app)?;
            json_or_err(&space)
        }
        "get_sync_status" => {
            // Without an orchestrator handle we cannot read live status;
            // return the default `Idle` snapshot — same contract as the
            // Tauri IPC.
            let status = catique_domain::SyncStatus::default();
            json_or_err(&status)
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
        // -------- list reads --------
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
        "list_prompts" => {
            let prompts = PromptsUseCase::new(pool).list().map_err(stringify_app)?;
            json_or_err(&prompts)
        }
        "list_proxied_tools" => list_proxied_tools_arm(pool),
        "list_role_tags" => list_role_tags_arm(pool, &params),
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
        "list_tasks" => {
            let tasks = TasksUseCase::new(pool).list().map_err(stringify_app)?;
            json_or_err(&tasks)
        }
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
        "remove_space_prompt" => {
            let space_id = decode_string(&params, "space_id")?;
            let prompt_id = decode_string(&params, "prompt_id")?;
            SpacesUseCase::new(pool)
                .remove_space_prompt(&space_id, &prompt_id)
                .map_err(stringify_app)?;
            Ok(json!({ "ok": true }))
        }
        "remove_task_prompt" => remove_task_prompt_arm(pool, &params),
        "resolve_keychain" => resolve_keychain_arm(pool, &params),
        // -------- prompts bulk set --------
        "set_board_prompts" => {
            let board_id = decode_string(&params, "board_id")?;
            let prompt_ids = decode_string_array(&params, "prompt_ids")?;
            BoardsUseCase::new(pool)
                .set_board_prompts(board_id, prompt_ids)
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
        "set_prompt_group_members" => {
            let group_id = decode_string(&params, "group_id")?;
            let ordered_prompt_ids = decode_string_array(&params, "ordered_prompt_ids")?;
            PromptGroupsUseCase::new(pool)
                .set_members(group_id, ordered_prompt_ids)
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
        "set_task_prompt_override" => set_task_prompt_override_arm(pool, &params),
        // -------- updates --------
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
        let async_only = ["add_provider", "remove_provider", "proxy_tool_call"];
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
}
