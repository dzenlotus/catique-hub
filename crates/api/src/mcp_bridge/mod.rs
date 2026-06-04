//! MCP bridge — Tauri-shell side of the sidecar dispatch wiring.
//!
//! ctq-112 / E5 + W1 (catique-hub-mcp standalone binary, 2026-05-14).
//!
//! Originally a 3.4 k-LOC monolith that defined every `tools/call`
//! arm inline. W1 extracted the catique-native dispatch surface into
//! [`catique_application::mcp_dispatch`] so the new Rust MCP server
//! binary (`crates/mcp-server-bin/`) can reach the same use cases
//! without linking against Tauri. This file is now the thin Tauri-only
//! adapter:
//!
//!   * [`SidecarUpstream`] — bridges `McpProxyUseCase` to the live
//!     Node-side `call_upstream` / `introspect_upstream` channel.
//!   * [`install`] — registers the `IpcHandler` on the supplied
//!     `SidecarManager`. Routes async-only arms (`proxy_tool_call`,
//!     `refresh_mcp_server`, `add_provider`, `remove_provider`,
//!     `import_skill_from_url`) inline and forwards everything else
//!     to `mcp_dispatch::dispatch` via `spawn_blocking`.
//!
//! The legacy Node sidecar is still spawned in debug builds so
//! `pnpm tauri dev` keeps working while the maintainer migrates the
//! release path off Node. Release builds skip the sidecar entirely
//! and rely on the bundled `catique-hub-mcp` binary directly.

use std::sync::Arc;
use std::time::Duration;

use catique_application::{
    connected_providers::OrchestratorHandle,
    mcp_dispatch,
    mcp_proxy::{McpProxyUseCase, UpstreamCaller, UpstreamError},
    mcp_servers::{McpServersUseCase, ServerWireMeta, UpstreamIntrospector, UpstreamToolDecl},
};
use catique_infrastructure::db::pool::Pool;
use catique_sidecar::{IpcHandler, SidecarError, SidecarManager};
use serde_json::{json, Value};

/// Wire timeout for one upstream MCP `tools/call`. Matches
/// [`catique_application::mcp_proxy::DEFAULT_UPSTREAM_TIMEOUT`].
const UPSTREAM_CALL_TIMEOUT: Duration = Duration::from_secs(60);

/// Wire timeout for one upstream MCP `tools/list`.
const INTROSPECT_TIMEOUT: Duration = Duration::from_secs(15);

/// Adapter that lets [`McpProxyUseCase`] reach the wire through the
/// concrete `SidecarManager` without the application crate depending
/// on `catique-sidecar`.
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
/// cheap `Pool` clone and routes every `ipc_call` through
/// [`mcp_dispatch::dispatch`] (sync arms) or one of the dedicated async
/// arms (proxy + refresh + provider mutators that need the wire or the
/// orchestrator).
///
/// `orchestrator` is optional: at startup the Tauri shell installs the
/// orchestrator before this bridge is registered, but unit tests may
/// build the bridge without one.
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
            // ctq-cross-process-bus: every successful mutation goes
            // through `publish_change_for_method` after the arm
            // returns so the standalone `catique-hub-mcp` binary's
            // tail-bridge picks it up and re-emits to the frontend.
            // Best-effort: publish failure logs to stderr and never
            // poisons the arm result.
            //
            // Each match arm clones `params` ahead of the call so we
            // can pass the original to `publish_change_for_method`
            // for id-from-params extraction (delete/update/join-table
            // methods don't carry the id in the result envelope).
            match method.as_str() {
                "proxy_tool_call" => return proxy_tool_call_arm(&pool, &mgr, params).await,
                "add_provider" => {
                    let params_clone = params.clone();
                    let res = mcp_dispatch::add_provider_arm(&pool, orch.as_ref(), params).await;
                    if let Ok(ref v) = res {
                        mcp_dispatch::publish_change_for_method(
                            &pool,
                            "add_provider",
                            &params_clone,
                            v,
                        );
                    }
                    return res;
                }
                "remove_provider" => {
                    let params_clone = params.clone();
                    let res = mcp_dispatch::remove_provider_arm(&pool, orch.as_ref(), params).await;
                    if let Ok(ref v) = res {
                        mcp_dispatch::publish_change_for_method(
                            &pool,
                            "remove_provider",
                            &params_clone,
                            v,
                        );
                    }
                    return res;
                }
                "refresh_mcp_server" => {
                    let params_clone = params.clone();
                    let res = refresh_mcp_server_arm(&pool, &mgr, params).await;
                    if let Ok(ref v) = res {
                        mcp_dispatch::publish_change_for_method(
                            &pool,
                            "refresh_mcp_server",
                            &params_clone,
                            v,
                        );
                    }
                    return res;
                }
                "import_skill_from_url" => {
                    let params_clone = params.clone();
                    let res = mcp_dispatch::import_skill_from_url_arm(&pool, params).await;
                    if let Ok(ref v) = res {
                        mcp_dispatch::publish_change_for_method(
                            &pool,
                            "import_skill_from_url",
                            &params_clone,
                            v,
                        );
                    }
                    return res;
                }
                _ => {}
            }
            // Use cases are sync (rusqlite is sync); offload onto a
            // blocking thread so the reader task can keep draining
            // stdout while a long DB call runs.
            let pool_for_publish = Arc::clone(&pool);
            let method_for_publish = method.clone();
            let params_for_publish = params.clone();
            let dispatch_result =
                tokio::task::spawn_blocking(move || mcp_dispatch::dispatch(&pool, &method, params))
                    .await
                    .map_err(|e| format!("dispatch join error: {e}"))?;
            if let Ok(ref v) = dispatch_result {
                mcp_dispatch::publish_change_for_method(
                    &pool_for_publish,
                    &method_for_publish,
                    &params_for_publish,
                    v,
                );
            }
            dispatch_result
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
    let server_id = mcp_dispatch::decode_string(&params, "server_id")?;
    let tool_name = mcp_dispatch::decode_string(&params, "tool_name")?;
    let args = params.get("args").cloned().unwrap_or(json!({}));
    let caller = SidecarUpstream { mgr: mgr.clone() };
    McpProxyUseCase::new(pool, &caller)
        .call(&server_id, &tool_name, args)
        .await
        .map_err(mcp_dispatch::stringify_app)
}

/// MCP-EXPAND-A async arm for `refresh_mcp_server`. The introspection
/// step requires the live wire, so it cannot live in the sync
/// `dispatch()` match.
async fn refresh_mcp_server_arm(
    pool: &Pool,
    mgr: &SidecarManager,
    params: Value,
) -> Result<Value, String> {
    let id = mcp_dispatch::decode_string(&params, "id")?;
    let introspector = sidecar_upstream(mgr);
    let report = McpServersUseCase::new(pool)
        .refresh(&id, &introspector)
        .await
        .map_err(mcp_dispatch::stringify_app)?;
    mcp_dispatch::json_or_err(&report)
}
