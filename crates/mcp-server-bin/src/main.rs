//! `catique-hub-mcp` — standalone MCP stdio server (single-endpoint façade).
//!
//! Replaces the Node `sidecar/`. Bundled inside the Tauri .app at
//! `Contents/MacOS/catique-hub-mcp` and named directly as the
//! `command` field of every external MCP-client config (Claude
//! Desktop / Claude Code / Codex). No Node.js install or sidecar
//! directory is required at runtime.
//!
//! ## Wire protocol
//!
//! Plain newline-delimited JSON-RPC 2.0 over stdin/stdout. Methods:
//!
//!   * `initialize` — protocol-version handshake + advertise `tools`.
//!   * `tools/list` — returns **exactly one** tool, `mcp_proxy_tool`.
//!     The per-role list of legal `method` values is documented in the
//!     agent file body (`<mcp-tool>` blocks rendered by
//!     `catique_clients::adapters::common::render_mcp_tool_blocks`).
//!     Surfacing all 147 native + N upstream tools in `tools/list` would
//!     blow ~70 KB of schema noise into every agent's input context for
//!     no semantic gain — the agent already learns the available
//!     `method` strings from the role file.
//!   * `tools/call` — accepts only `mcp_proxy_tool`. The dispatch is
//!     driven entirely by the `method` argument: dot-qualified names
//!     forward to the upstream MCP server via [`UpstreamPool`], bare
//!     names dispatch into [`catique_application::mcp_dispatch`].
//!
//! Anything that is not stdin / stdout JSON-RPC goes to stderr,
//! prefixed `[catique-hub-mcp]`.

#![allow(clippy::needless_pass_by_value)]

use std::collections::HashSet;
use std::io::Write;
use std::sync::Arc;

use catique_application::mcp_dispatch;
use catique_hub_mcp::upstream::{
    list_enabled_servers, lookup_server_by_name, ServerMeta, UpstreamError, UpstreamPool,
};
use catique_infrastructure::db::pool::Pool;
use catique_infrastructure::db::{open_pool, run_pending};
use catique_infrastructure::paths::db_path;
use serde_json::{json, Value};
use thiserror::Error;
use tokio::io::{AsyncBufReadExt, AsyncWriteExt, BufReader};

use catique_hub_mcp::jsonrpc::{error_code, Request, Response};

const LOG_PREFIX: &str = "[catique-hub-mcp]";

/// MCP protocol version we advertise during `initialize`.
const MCP_PROTOCOL_VERSION: &str = "2024-11-05";

/// Server-side identity returned during `initialize`.
const SERVER_NAME: &str = "catique-hub";
const SERVER_VERSION: &str = env!("CARGO_PKG_VERSION");

/// Single MCP tool exposed by the standalone binary. Every catique
/// method (native + proxied upstream) is routed through this entry
/// point; see the module-level docs for the rationale.
const PROXY_TOOL_NAME: &str = "mcp_proxy_tool";

/// Embedded native tool manifest. Same JSON the legacy Node sidecar
/// shipped — used **server-side only** for method validation. The
/// external client never sees this manifest in `tools/list` under the
/// single-endpoint façade.
const TOOL_MANIFEST: &str = include_str!("../../../sidecar/tool-manifest.json");

#[derive(Debug, Error)]
enum StartupError {
    #[error("resolve db path: {0}")]
    Path(&'static str),

    #[error("open db pool at {path}: {reason}")]
    OpenPool { path: String, reason: String },

    #[error("acquire migration connection: {0}")]
    AcquireConn(String),

    #[error("run migrations: {0}")]
    Migrate(String),

    #[error("parse tool manifest: {0}")]
    ManifestParse(serde_json::Error),
}

fn log(msg: &str) {
    let mut stderr = std::io::stderr().lock();
    let _ = writeln!(stderr, "{LOG_PREFIX} {msg}");
}

#[tokio::main(flavor = "multi_thread")]
async fn main() {
    if let Err(e) = run().await {
        log(&format!("fatal: {e}"));
        std::process::exit(1);
    }
}

async fn run() -> Result<(), StartupError> {
    // Test-only override so integration tests can point the binary at
    // a temp DB without colliding with the developer's working dataset.
    // Release builds ignore this env var.
    let path = if let Ok(override_path) = std::env::var("CATIQUE_HUB_MCP_DB") {
        std::path::PathBuf::from(override_path)
    } else {
        db_path().map_err(StartupError::Path)?
    };
    let pool = open_pool(&path).map_err(|e| StartupError::OpenPool {
        path: path.display().to_string(),
        reason: e.to_string(),
    })?;

    {
        let mut conn = pool
            .get()
            .map_err(|e| StartupError::AcquireConn(e.to_string()))?;
        let applied = run_pending(&mut conn).map_err(|e| StartupError::Migrate(e.to_string()))?;
        drop(conn);
        if !applied.is_empty() {
            let names: Vec<&str> = applied.iter().map(|m| m.name.as_str()).collect();
            log(&format!("applied migrations: {names:?}"));
        }
    }

    // Parse the manifest into:
    //   * `native_tools` — the full JSON descriptors echoed verbatim in
    //     `tools/list` so external MCP clients see every catique-native
    //     tool the same way they would see any other MCP server's tools
    //     (standard pattern, no per-session filtering).
    //   * `native_methods` — a HashSet of method names for O(1)
    //     validation in `tools/call`.
    let manifest_value: Value =
        serde_json::from_str(TOOL_MANIFEST).map_err(StartupError::ManifestParse)?;
    let native_tools: Vec<Value> = manifest_value
        .get("tools")
        .and_then(Value::as_array)
        .cloned()
        .unwrap_or_default();
    let native_methods: HashSet<String> = native_tools
        .iter()
        .filter_map(|t| t.get("name").and_then(Value::as_str).map(str::to_owned))
        .collect();
    log(&format!(
        "loaded {} native tool(s) from manifest",
        native_tools.len()
    ));

    let upstream_pool = Arc::new(UpstreamPool::new());

    serve(
        Arc::new(pool),
        Arc::new(native_tools),
        Arc::new(native_methods),
        upstream_pool,
    )
    .await;

    Ok(())
}

/// Read JSON-RPC requests from stdin, dispatch them, write responses
/// to stdout. Each request is handled in its own `tokio::spawn` so a
/// slow `tools/call` does not block subsequent reads.
async fn serve(
    pool: Arc<Pool>,
    native_tools: Arc<Vec<Value>>,
    native_methods: Arc<HashSet<String>>,
    upstream: Arc<UpstreamPool>,
) {
    let stdin = tokio::io::stdin();
    let mut reader = BufReader::new(stdin);
    let stdout = Arc::new(tokio::sync::Mutex::new(tokio::io::stdout()));
    let mut line = String::new();
    log(&format!("started, pid={}", std::process::id()));
    loop {
        line.clear();
        let n = match reader.read_line(&mut line).await {
            Ok(0) => {
                log("stdin closed, exiting");
                upstream.close_all().await;
                return;
            }
            Ok(n) => n,
            Err(err) => {
                log(&format!("stdin read error: {err}"));
                upstream.close_all().await;
                return;
            }
        };
        let trimmed = line[..n].trim();
        if trimmed.is_empty() {
            continue;
        }
        let req: Request = match serde_json::from_str(trimmed) {
            Ok(r) => r,
            Err(err) => {
                let reply = Response::err(
                    Value::Null,
                    error_code::PARSE_ERROR,
                    format!("invalid JSON: {err}"),
                );
                write_response(&stdout, &reply).await;
                continue;
            }
        };
        let pool = Arc::clone(&pool);
        let native_tools = Arc::clone(&native_tools);
        let native_methods = Arc::clone(&native_methods);
        let upstream = Arc::clone(&upstream);
        let stdout = Arc::clone(&stdout);
        tokio::spawn(async move {
            let response =
                dispatch_request(&pool, &native_tools, &native_methods, &upstream, req).await;
            if let Some(resp) = response {
                write_response(&stdout, &resp).await;
            }
        });
    }
}

/// Route a single inbound request. Returns `None` for notifications.
async fn dispatch_request(
    pool: &Arc<Pool>,
    native_tools: &Arc<Vec<Value>>,
    native_methods: &Arc<HashSet<String>>,
    upstream: &Arc<UpstreamPool>,
    req: Request,
) -> Option<Response> {
    let id = req.id.clone();
    let method = req.method.as_str();
    let params = req.params.unwrap_or(Value::Null);

    let result: Result<Value, (i64, String)> = match method {
        "initialize" => Ok(handle_initialize(&params)),
        "initialized" | "notifications/initialized" => {
            id.as_ref()?;
            Ok(json!({}))
        }
        "tools/list" => Ok(handle_tools_list(native_tools)),
        "tools/call" => handle_tools_call(pool, native_methods, upstream, &params).await,
        "ping" => Ok(json!({})),
        other => Err((
            error_code::METHOD_NOT_FOUND,
            format!("method not found: {other}"),
        )),
    };

    let id = id?;
    Some(match result {
        Ok(value) => Response::ok(id, value),
        Err((code, msg)) => Response::err(id, code, msg),
    })
}

fn handle_initialize(params: &Value) -> Value {
    let protocol_version = params
        .get("protocolVersion")
        .and_then(Value::as_str)
        .unwrap_or(MCP_PROTOCOL_VERSION);
    json!({
        "protocolVersion": protocol_version,
        "capabilities": {
            "tools": {}
        },
        "serverInfo": {
            "name": SERVER_NAME,
            "version": SERVER_VERSION,
        }
    })
}

/// Build the `tools/list` reply: every catique-native tool from the
/// embedded manifest, plus the single `mcp_proxy_tool` entry that
/// fronts every upstream MCP server registered in Catique HUB.
///
/// External MCP clients (Claude Desktop / Claude Code / Codex) see this
/// as a normal MCP server — the standard pattern is to expose the full
/// tool list straight through `tools/list`. Per-role scoping happens in
/// the agent file body (`<mcp-tool>` blocks rendered by the role-sync
/// orchestrator), NOT on the wire.
fn handle_tools_list(native_tools: &Arc<Vec<Value>>) -> Value {
    let mut out: Vec<Value> = native_tools.as_ref().clone();
    out.push(proxy_tool_descriptor());
    json!({ "tools": out })
}

/// Schema descriptor for `mcp_proxy_tool` — the single façade in front
/// of every upstream MCP server (Playwright, GitHub, Slack, …)
/// registered in Catique HUB.
///
/// The description is intentionally verbose because the agent reads it
/// once on `tools/list` and decides from there how to use the tool.
fn proxy_tool_descriptor() -> Value {
    json!({
        "name": PROXY_TOOL_NAME,
        "description": "Proxy entry point for every upstream MCP server registered in Catique HUB. \
    Use this to invoke tools that belong to OTHER MCP servers your role has access to — for example Playwright, GitHub, Slack, Promptery, or any custom MCP server the user installed in Catique HUB's `MCP servers` UI.\n\n\
    WHEN TO USE:\n\
    * NOT for Catique HUB's own tools (`get_task`, `create_task`, `list_spaces`, …). Those appear in this server's tool list under their bare names — call them directly.\n\
    * ONLY for tools from an upstream MCP server. The role's agent file body lists every upstream tool you may call: look for `<mcp-tool server=\"catique\" name=\"{server_name}.{tool_name}\">` blocks. Each block also carries the upstream tool's description and full JSON Schema under `<input-schema>` — copy the field names and types from there.\n\n\
    ARGUMENT SHAPE:\n\
    * `method` — the qualified name as it appears in the `<mcp-tool>` block, e.g. `playwright.browser_navigate` or `github.search_repositories`. Must contain a dot; everything left of the dot is the upstream server name, everything right is the upstream tool name.\n\
    * `args` — the arguments object for the upstream tool. Field names + types come from the `<input-schema>` JSON inside the matching `<mcp-tool>` block. Defaults to `{}`.\n\n\
    The call is forwarded to the upstream server verbatim and its `{content, isError?}` reply is passed back to you unmodified. If the upstream returns `isError: true`, you receive that signal exactly as the upstream meant it.",
        "inputSchema": {
            "type": "object",
            "properties": {
                "method": {
                    "type": "string",
                    "description": "Qualified upstream tool name in the form `server.tool` (e.g. `playwright.browser_navigate`). Take this verbatim from the `name=` attribute of an `<mcp-tool>` block in your role's agent file."
                },
                "args": {
                    "type": "object",
                    "description": "Arguments object for the upstream tool. Field names + types come from the `<input-schema>` JSON inside the matching `<mcp-tool>` block. Forwarded verbatim to the upstream.",
                    "additionalProperties": true,
                    "default": {}
                }
            },
            "required": ["method"],
            "additionalProperties": false
        }
    })
}

/// Route a `tools/call` request. Two valid paths:
///
///   * `name` is a catique-native tool from the embedded manifest →
///     dispatch directly through [`mcp_dispatch::dispatch`].
///   * `name == "mcp_proxy_tool"` → unwrap `arguments.{method,args}`
///     and forward to the upstream MCP server identified by the
///     `server.tool` qualified `method`.
///
/// Anything else is a tool-level `isError` envelope (no JSON-RPC error,
/// no panic) per MCP semantics.
async fn handle_tools_call(
    pool: &Arc<Pool>,
    native_methods: &Arc<HashSet<String>>,
    upstream: &Arc<UpstreamPool>,
    params: &Value,
) -> Result<Value, (i64, String)> {
    let name = params
        .get("name")
        .and_then(Value::as_str)
        .ok_or_else(|| {
            (
                error_code::INVALID_PARAMS,
                "tools/call: missing `name`".to_string(),
            )
        })?
        .to_owned();

    // ---- Upstream proxy path -------------------------------------
    if name == PROXY_TOOL_NAME {
        let arguments = params.get("arguments").cloned().unwrap_or(json!({}));
        let method = match arguments.get("method").and_then(Value::as_str) {
            Some(m) if !m.is_empty() => m.to_owned(),
            _ => {
                return Ok(tools_call_error(format!(
                    "`{PROXY_TOOL_NAME}` requires `arguments.method` (string, e.g. `playwright.browser_navigate`). Received: {arguments}"
                )));
            }
        };
        let args = arguments.get("args").cloned().unwrap_or(json!({}));

        let Some((server_name, tool_name)) = method.split_once('.') else {
            return Ok(tools_call_error(format!(
                "`{PROXY_TOOL_NAME}` only proxies upstream tools — `method` must be qualified as `server.tool` (e.g. `playwright.browser_navigate`). For Catique HUB's own tools (`get_task`, `create_task`, …) call them directly via `tools/call`. You passed `method`=`{method}`."
            )));
        };
        return Ok(call_upstream_tool(pool, upstream, server_name, tool_name, args).await);
    }

    // ---- Native catique path -------------------------------------
    if !native_methods.contains(&name) {
        return Ok(unknown_method_error(pool, &name).await);
    }

    let args = params.get("arguments").cloned().unwrap_or(json!({}));
    // Snapshot for the cross-process bus publish below — the arm
    // consumes `args` by value but `publish_change_for_method` needs
    // the original to recover IDs that don't appear in the result.
    let args_for_publish = args.clone();

    let arm_result: Result<Value, String> = match name.as_str() {
        "proxy_tool_call" | "refresh_mcp_server" => {
            return Ok(tools_call_error(format!(
                "tool_not_implemented_yet: `{name}` requires the live Tauri-shell sidecar wire and is not exposed by the standalone Rust MCP server."
            )));
        }
        "add_provider" => mcp_dispatch::add_provider_arm(pool, None, args).await,
        "remove_provider" => mcp_dispatch::remove_provider_arm(pool, None, args).await,
        "import_skill_from_url" => mcp_dispatch::import_skill_from_url_arm(pool, args).await,
        _ => {
            let pool_clone = Arc::clone(pool);
            let method_owned = name.clone();
            match tokio::task::spawn_blocking(move || {
                mcp_dispatch::dispatch(&pool_clone, &method_owned, args)
            })
            .await
            {
                Ok(inner) => inner,
                Err(join_err) => Err(format!("dispatch join error: {join_err}")),
            }
        }
    };

    // ctq-cross-process-bus: publish realtime events into
    // `change_events` so the Tauri shell's tail task re-emits them as
    // the same Tauri events the in-process IPC handlers emit. Without
    // this hop the standalone-binary path stays invisible to the UI
    // until a manual reload.
    if let Ok(ref value) = arm_result {
        mcp_dispatch::publish_change_for_method(pool, &name, &args_for_publish, value);
    }

    Ok(match arm_result {
        Ok(value) => json!({
            "content": [{ "type": "text", "text": value.to_string() }],
        }),
        Err(msg) => tools_call_error(msg),
    })
}

/// Build an `isError` envelope for an unrecognised `method`. To help
/// the agent recover without dumping the entire manifest, we surface
/// the list of registered upstream namespaces (e.g. `playwright.`,
/// `promptery.`) — those are user-installed and short, while the
/// 147 native names are documented in the agent file body.
async fn unknown_method_error(pool: &Arc<Pool>, method: &str) -> Value {
    let pool_clone = Arc::clone(pool);
    let servers = tokio::task::spawn_blocking(move || {
        let conn = pool_clone.get().map_err(|e| e.to_string())?;
        list_enabled_servers(&conn).map_err(|e| e.to_string())
    })
    .await;

    let namespaces: Vec<String> = match servers {
        Ok(Ok(list)) => list.into_iter().map(|m| format!("`{}.`", m.name)).collect(),
        Ok(Err(err)) => {
            log(&format!("unknown_method_error: list servers failed: {err}"));
            Vec::new()
        }
        Err(join_err) => {
            log(&format!("unknown_method_error: join error: {join_err}"));
            Vec::new()
        }
    };

    let hint = if namespaces.is_empty() {
        "No upstream MCP servers are currently registered for this Catique HUB instance."
            .to_string()
    } else {
        format!(
            "If you meant a tool from an upstream MCP server, call `{PROXY_TOOL_NAME}` with `method` qualified as `server.tool`. Registered upstream namespaces: {}.",
            namespaces.join(", ")
        )
    };

    tools_call_error(format!(
        "Unknown tool `{method}`. Catique HUB's own tools (`get_task`, `create_task`, `list_spaces`, …) are exposed directly under `tools/list`. {hint}"
    ))
}

/// Forward a `{server_name}.{tool_name}` call to the upstream MCP
/// server. Returns the upstream's `{content, isError?}` payload
/// verbatim so an upstream `isError: true` survives the round-trip.
async fn call_upstream_tool(
    pool: &Arc<Pool>,
    upstream: &Arc<UpstreamPool>,
    server_name: &str,
    tool_name: &str,
    args: Value,
) -> Value {
    let server_name_owned = server_name.to_owned();
    let pool_for_lookup = Arc::clone(pool);
    let meta_result: Result<Option<ServerMeta>, String> = tokio::task::spawn_blocking(move || {
        let conn = pool_for_lookup.get().map_err(|e| e.to_string())?;
        lookup_server_by_name(&conn, &server_name_owned).map_err(|e| e.to_string())
    })
    .await
    .unwrap_or_else(|join_err| Err(format!("join error: {join_err}")));

    let meta = match meta_result {
        Ok(Some(m)) => m,
        Ok(None) => {
            return tools_call_error(format!(
                "upstream server `{server_name}` not found or disabled"
            ));
        }
        Err(err) => {
            return tools_call_error(format!("upstream lookup for `{server_name}` failed: {err}"));
        }
    };

    let client = match upstream.get_or_connect(&meta).await {
        Ok(c) => c,
        Err(err) => {
            return tools_call_error(format!(
                "upstream `{server_name}` connect failed: {}",
                upstream_err_msg(&err)
            ));
        }
    };

    match client.call_tool(tool_name, args).await {
        Ok(value) => {
            // Upstream returned a wire-shape `{content, isError?}`.
            // Pass through verbatim if it already conforms; otherwise
            // wrap so the external client never sees raw upstream JSON.
            if value.get("content").and_then(Value::as_array).is_some() {
                value
            } else {
                json!({
                    "content": [{ "type": "text", "text": value.to_string() }],
                })
            }
        }
        Err(err) => tools_call_error(format!(
            "upstream `{server_name}.{tool_name}` failed: {}",
            upstream_err_msg(&err)
        )),
    }
}

fn upstream_err_msg(err: &UpstreamError) -> String {
    err.to_string()
}

fn tools_call_error(message: String) -> Value {
    json!({
        "isError": true,
        "content": [{ "type": "text", "text": message }],
    })
}

async fn write_response(stdout: &Arc<tokio::sync::Mutex<tokio::io::Stdout>>, resp: &Response) {
    let mut buf = match serde_json::to_vec(resp) {
        Ok(v) => v,
        Err(err) => {
            log(&format!("serialize response: {err}"));
            return;
        }
    };
    buf.push(b'\n');
    let mut out = stdout.lock().await;
    if let Err(err) = out.write_all(&buf).await {
        log(&format!("stdout write: {err}"));
        return;
    }
    if let Err(err) = out.flush().await {
        log(&format!("stdout flush: {err}"));
    }
}
