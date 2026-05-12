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

use catique_application::{
    boards::BoardsUseCase, columns::ColumnsUseCase, mcp_servers::McpServersUseCase,
    tasks::TasksUseCase, AppError,
};
use catique_infrastructure::db::pool::Pool;
use catique_sidecar::{IpcHandler, SidecarManager};
use serde_json::{json, Value};

use crate::handlers::mcp_servers::McpServerConnectionHint;

/// Install the MCP bridge handler onto `mgr`. The handler captures a
/// cheap `Pool` clone and routes every `ipc_call` through [`dispatch`].
///
/// Idempotent: subsequent calls overwrite the previous handler.
pub async fn install(mgr: &SidecarManager, pool: Pool) {
    let pool = Arc::new(pool);
    let handler: IpcHandler = Arc::new(move |method, params| {
        let pool = Arc::clone(&pool);
        Box::pin(async move {
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

/// Look up `method` in the dispatch table, decode `params`, run the
/// use-case, and return the JSON-encoded result. Errors collapse into
/// a single `String` (the Node MCP layer surfaces it as `isError:
/// true` text content).
///
/// Keep the match arms ordered alphabetically — easier scan when the
/// list grows past five entries.
fn dispatch(pool: &Pool, method: &str, params: Value) -> Result<Value, String> {
    match method {
        "get_mcp_server_connection_hint" => {
            // ADR-0007: returns metadata only — `authRefJson` is the
            // reference (keychain entry name or env-var name); the
            // calling agent resolves the secret itself.
            let id = decode_string(&params, "id")?;
            let hint = McpServersUseCase::new(pool)
                .get_connection_hint(&id)
                .map_err(stringify_app)?;
            json_or_err(&McpServerConnectionHint::from(hint))
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
        "list_boards" => {
            let boards = BoardsUseCase::new(pool).list().map_err(stringify_app)?;
            json_or_err(&boards)
        }
        "list_columns" => {
            let columns = ColumnsUseCase::new(pool).list().map_err(stringify_app)?;
            json_or_err(&columns)
        }
        "list_mcp_servers" => {
            // ADR-0007 registry-only: only *enabled* servers cross the
            // sidecar boundary. The wire shape collapses each row into
            // the same `McpServerConnectionHint` view used by
            // `get_mcp_server_connection_hint` so the field set
            // (`authRefJson`, no `enabled`/timestamps) is consistent
            // across both tools.
            let servers = McpServersUseCase::new(pool)
                .list_enabled()
                .map_err(stringify_app)?;
            let hints: Vec<McpServerConnectionHint> = servers
                .into_iter()
                .map(|s| McpServerConnectionHint {
                    id: s.id,
                    name: s.name,
                    transport: s.transport,
                    url: s.url,
                    command: s.command,
                    auth_ref_json: s.auth_json,
                })
                .collect();
            json_or_err(&hints)
        }
        "list_tasks" => {
            let tasks = TasksUseCase::new(pool).list().map_err(stringify_app)?;
            json_or_err(&tasks)
        }
        other => Err(format!("Unknown ipc_call method: {other}")),
    }
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
