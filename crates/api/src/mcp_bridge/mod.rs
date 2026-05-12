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
    columns::ColumnsUseCase,
    mcp_proxy::{McpProxyUseCase, UpstreamCaller, UpstreamError},
    mcp_servers::{
        McpServersUseCase, ServerWireMeta, UpstreamIntrospector, UpstreamToolDecl,
    },
    tasks::TasksUseCase,
    AppError,
};
use catique_infrastructure::{
    db::{
        pool::{acquire, Pool},
        repositories::mcp_servers as servers_repo,
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
        let tools = raw
            .get("tools")
            .and_then(Value::as_array)
            .ok_or_else(|| UpstreamError::Transport("introspect_upstream: missing tools[]".into()))?;
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
/// (sync arms) or [`dispatch_async`] (the proxy arm that needs the
/// wire).
///
/// Idempotent: subsequent calls overwrite the previous handler.
pub async fn install(mgr: &SidecarManager, pool: Pool) {
    let pool = Arc::new(pool);
    let captured_mgr = mgr.clone();
    let handler: IpcHandler = Arc::new(move |method, params| {
        let pool = Arc::clone(&pool);
        let mgr = captured_mgr.clone();
        Box::pin(async move {
            // Async-first: the proxy arm needs the sidecar wire and
            // therefore cannot live in the sync `spawn_blocking` path.
            if method == "proxy_tool_call" {
                return proxy_tool_call_arm(&pool, &mgr, params).await;
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

/// Look up `method` in the dispatch table, decode `params`, run the
/// use-case, and return the JSON-encoded result. Errors collapse into
/// a single `String` (the Node MCP layer surfaces it as `isError:
/// true` text content).
///
/// Keep the match arms ordered alphabetically — easier scan when the
/// list grows past five entries.
fn dispatch(pool: &Pool, method: &str, params: Value) -> Result<Value, String> {
    match method {
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
        "list_boards" => {
            let boards = BoardsUseCase::new(pool).list().map_err(stringify_app)?;
            json_or_err(&boards)
        }
        "list_columns" => {
            let columns = ColumnsUseCase::new(pool).list().map_err(stringify_app)?;
            json_or_err(&columns)
        }
        "list_proxied_tools" => list_proxied_tools_arm(pool),
        "list_tasks" => {
            let tasks = TasksUseCase::new(pool).list().map_err(stringify_app)?;
            json_or_err(&tasks)
        }
        "resolve_keychain" => resolve_keychain_arm(pool, &params),
        other => Err(format!("Unknown ipc_call method: {other}")),
    }
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
        secrets::SecretError::NotImplemented(_) => "not_implemented".to_owned(),
        secrets::SecretError::MalformedRef(m) => format!("malformed_ref: {m}"),
    })?;
    // The secret crosses the pipe in the response body. Node must
    // use it once and forget — see `sidecar/upstream-clients.js`
    // (PROXY-S2).
    Ok(json!({ "secret": secret }))
}

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
