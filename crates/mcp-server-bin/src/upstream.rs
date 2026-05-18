//! Upstream MCP client pool — Rust port of the Node sidecar's
//! `sidecar/upstream-clients.js`.
//!
//! The standalone binary plays two roles simultaneously:
//!
//!   * **MCP server** — speaks stdio JSON-RPC to the external agent
//!     (Claude Desktop / Claude Code / Codex). Handled by `main.rs`.
//!   * **MCP client** — speaks JSON-RPC to upstream MCP servers
//!     registered in the Catique HUB DB (Atlassian, GitHub, …).
//!     Handled by THIS module.
//!
//! Each unique `server_id` gets one cached, warm [`UpstreamClient`].
//! Caching across calls keeps the upstream transport warm (avoiding
//! re-spawn of stdio subprocesses on every `tools/call`); the cache is
//! cleared on binary shutdown via [`UpstreamPool::close_all`].
//!
//! ## Concurrency
//!
//! Concurrent first-call races for the same `server_id` share a single
//! in-flight connect future. This mirrors the Node version's
//! `pending` field and avoids opening two stdio children for the same
//! row. Once `connect()` resolves, subsequent callers receive the
//! cached client straight from the map.
//!
//! ## Transports
//!
//! * `stdio` — spawn `tokio::process::Command::new(exe).args(args)`;
//!   talk newline-delimited JSON-RPC over the child's stdin / stdout.
//!   The `command` column today encodes the whole CLI as one
//!   whitespace-separated string; we split on whitespace exactly like
//!   the Node side did. Future versions may switch to a structured
//!   `{command, args[]}` shape.
//! * `http`  — POST JSON-RPC requests at `mcp_servers.url`. The
//!   Streamable-HTTP MCP transport may return either a JSON response
//!   body or an SSE stream; we accept JSON and fall back to "first
//!   `data:` line" for SSE replies.
//! * `sse`   — equivalent to `http` from the request side (POST to
//!   `url`) but the response is always SSE.
//!
//! ## Secrets — out of scope this round
//!
//! `mcp_server_secrets` keychain rows are not yet plumbed in. If a
//! server has secrets configured we log a single warning on connect
//! and proceed unauthenticated. Mirrors PROXY-S2 in the Node sidecar,
//! tracked as a follow-up for the standalone binary.

use std::collections::HashMap;
use std::sync::Arc;
use std::time::Duration;

use catique_domain::Transport;
use catique_infrastructure::db::repositories::mcp_servers::{
    self as repo, McpServerRow, TransportKind,
};
use serde_json::{json, Value};
use thiserror::Error;
use tokio::io::{AsyncBufReadExt, AsyncWriteExt, BufReader};
use tokio::process::{Child, ChildStdin, ChildStdout};
use tokio::sync::Mutex;
use tokio::time::timeout;

use crate::jsonrpc::{self, Request, Response};

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

/// Wall-clock timeout for one upstream JSON-RPC call. Matches
/// [`catique_application::mcp_proxy::DEFAULT_UPSTREAM_TIMEOUT`].
pub const DEFAULT_CALL_TIMEOUT: Duration = Duration::from_secs(60);

/// Connection-open budget. Stdio child + initialize handshake must
/// complete inside this window or the call fails fast.
pub const CONNECT_TIMEOUT: Duration = Duration::from_secs(10);

/// Server metadata pulled from the `mcp_servers` row. Kept local to
/// this module so we never hand the live [`McpServerRow`] across the
/// async boundary.
#[derive(Debug, Clone)]
pub struct ServerMeta {
    pub id: String,
    pub name: String,
    pub transport: Transport,
    pub url: Option<String>,
    pub command: Option<String>,
    /// `auth_json` reference, if any. Used only to decide whether to
    /// emit the "secrets not yet plumbed" warning — never resolved.
    pub auth_ref_json: Option<String>,
}

impl From<McpServerRow> for ServerMeta {
    fn from(row: McpServerRow) -> Self {
        Self {
            id: row.id,
            name: row.name,
            transport: match row.transport {
                TransportKind::Stdio => Transport::Stdio,
                TransportKind::Http => Transport::Http,
                TransportKind::Sse => Transport::Sse,
            },
            url: row.url,
            command: row.command,
            auth_ref_json: row.auth_json,
        }
    }
}

/// Transport-side error from a single upstream call. Strings inside
/// must NOT carry resolved secrets — they end up in stderr logs and,
/// for tool calls, in the response surfaced to the external agent.
///
/// Parallel to `catique_application::mcp_proxy::UpstreamError`; the
/// shapes diverge slightly because this layer never reaches the
/// supervisor-channel transport that the API-crate version had to
/// represent.
#[derive(Debug, Error)]
pub enum UpstreamError {
    /// Misconfigured row reached the pool — schema CHECK should
    /// prevent this in production but we guard at the call site.
    #[error("misconfigured upstream {id}: {reason}")]
    BadConfig { id: String, reason: String },

    /// I/O failure on the wire (stdio pipe broke, HTTP refused, …).
    #[error("transport: {0}")]
    Transport(String),

    /// JSON parse / shape error on the upstream's reply.
    #[error("protocol: {0}")]
    Protocol(String),

    /// Upstream replied with `{isError: true}` content. The message
    /// carries the stringified content array for log forensics.
    #[error("upstream returned isError: {0}")]
    UpstreamIsError(String),

    /// Wall-clock timeout exceeded.
    #[error("timed out")]
    Timeout,
}

// ---------------------------------------------------------------------------
// UpstreamClient — one warm connection
// ---------------------------------------------------------------------------

/// One open MCP-client connection. Cheaply cloneable (Arc-backed) so
/// the pool can hand the same client to multiple `tools/call` invocations
/// without serializing them at the connection boundary.
///
/// The internals hold a [`tokio::sync::Mutex`] around the per-call
/// state because JSON-RPC over a single pipe is request-response: two
/// concurrent calls would interleave their newlines on the wire. The
/// MCP wire protocol does support id-based multiplexing in principle,
/// but the stdio transport's PIPE backpressure makes a per-client
/// mutex by far the simplest correct implementation.
#[derive(Clone)]
pub struct UpstreamClient {
    inner: Arc<Mutex<ClientInner>>,
    /// Stable copy of the meta for `close_all` logging — avoids re-locking
    /// the inner mutex during shutdown.
    meta: ServerMeta,
}

/// State for a stdio-backed upstream. Boxed inside [`ClientInner`] to
/// keep the enum size flat — the stdio variant carries a `Child` and a
/// `BufReader` and is ~6x the size of the HTTP variant otherwise
/// (clippy::large_enum_variant).
struct StdioState {
    child: Child,
    stdin: ChildStdin,
    reader: BufReader<ChildStdout>,
    /// Monotonic id allocator for outbound requests.
    next_id: u64,
}

enum ClientInner {
    /// Stdio transport — we own both halves of the child's pipe.
    Stdio(Box<StdioState>),
    /// Streamable-HTTP transport. `client` is shared across calls so
    /// the connection pool inside `reqwest` keeps sockets warm.
    Http {
        client: reqwest::Client,
        url: String,
        next_id: u64,
    },
    /// SSE transport. From a wire perspective requests still go out as
    /// POSTs; only the response framing differs. We share the impl
    /// with `Http` and discriminate on parse time.
    Sse {
        client: reqwest::Client,
        url: String,
        next_id: u64,
    },
}

impl UpstreamClient {
    /// Send a JSON-RPC request and return the parsed `result` value.
    /// Maps wire failures to [`UpstreamError`] variants.
    ///
    /// # Errors
    ///
    /// Forwards every [`UpstreamError`] case.
    pub async fn request(
        &self,
        method: &str,
        params: Value,
        call_timeout: Duration,
    ) -> Result<Value, UpstreamError> {
        let mut g = self.inner.lock().await;
        let fut = async {
            match &mut *g {
                ClientInner::Stdio(state) => {
                    let StdioState {
                        stdin,
                        reader,
                        next_id,
                        ..
                    } = state.as_mut();
                    stdio_request(stdin, reader, next_id, method, params).await
                }
                ClientInner::Http {
                    client,
                    url,
                    next_id,
                } => http_request(client, url, next_id, method, params, false).await,
                ClientInner::Sse {
                    client,
                    url,
                    next_id,
                } => http_request(client, url, next_id, method, params, true).await,
            }
        };
        match timeout(call_timeout, fut).await {
            Ok(res) => res,
            Err(_) => Err(UpstreamError::Timeout),
        }
    }

    /// Issue a JSON-RPC notification (no response expected). The MCP
    /// protocol uses notifications for `initialized` after the
    /// `initialize` handshake completes.
    async fn notify(&self, method: &str, params: Value) -> Result<(), UpstreamError> {
        let mut g = self.inner.lock().await;
        match &mut *g {
            ClientInner::Stdio(state) => stdio_notify(&mut state.stdin, method, params).await,
            ClientInner::Http { client, url, .. } | ClientInner::Sse { client, url, .. } => {
                http_notify(client, url, method, params).await
            }
        }
    }

    /// `tools/list` against this upstream. Returns the raw `{tools:
    /// [...]}` payload; aggregation into the standalone server's own
    /// `tools/list` reply happens in `main.rs` after qualification.
    ///
    /// # Errors
    ///
    /// Forwards every [`UpstreamError`] case.
    pub async fn list_tools(&self) -> Result<Value, UpstreamError> {
        self.request("tools/list", json!({}), DEFAULT_CALL_TIMEOUT)
            .await
    }

    /// `tools/call` against this upstream. Returns the raw `{content,
    /// isError?}` payload **verbatim** so an upstream-side `isError:
    /// true` survives the round-trip — the standalone binary's
    /// `tools/call` handler passes the same shape on to the external
    /// agent.
    ///
    /// # Errors
    ///
    /// Forwards every [`UpstreamError`] case. `isError: true` payloads
    /// are NOT auto-mapped to [`UpstreamError::UpstreamIsError`] here
    /// because the call sites want to surface the upstream payload to
    /// the external agent unmodified; the variant exists for log
    /// accounting only.
    pub async fn call_tool(&self, tool_name: &str, args: Value) -> Result<Value, UpstreamError> {
        self.request(
            "tools/call",
            json!({"name": tool_name, "arguments": args}),
            DEFAULT_CALL_TIMEOUT,
        )
        .await
    }

    /// Best-effort shutdown. Stdio children get SIGKILL'd on Drop, but
    /// closing the connection explicitly lets us await the child's
    /// exit and avoids zombie processes during a slow shutdown.
    async fn close(&self) {
        let mut g = self.inner.lock().await;
        match &mut *g {
            ClientInner::Stdio(state) => {
                let _ = state.child.kill().await;
                let _ = state.child.wait().await;
            }
            ClientInner::Http { .. } | ClientInner::Sse { .. } => {
                // reqwest::Client cleans up its connection pool on drop;
                // nothing to do here.
            }
        }
    }
}

// ---------------------------------------------------------------------------
// UpstreamPool — module-level cache
// ---------------------------------------------------------------------------

/// Cache entry. The `pending` field holds the in-flight connect
/// `oneshot::Receiver` so concurrent callers do not race two transport
/// opens. Once the connect future resolves, the receiver is dropped
/// and the cached client becomes the canonical reference.
enum CacheEntry {
    Pending(tokio::sync::watch::Receiver<Option<Result<UpstreamClient, String>>>),
    Ready(UpstreamClient),
}

/// Connection pool, keyed by `server_id`. Hold one instance for the
/// lifetime of the binary.
pub struct UpstreamPool {
    cache: Mutex<HashMap<String, CacheEntry>>,
}

impl Default for UpstreamPool {
    fn default() -> Self {
        Self::new()
    }
}

impl UpstreamPool {
    /// Construct an empty pool.
    #[must_use]
    pub fn new() -> Self {
        Self {
            cache: Mutex::new(HashMap::new()),
        }
    }

    /// Get-or-create a connected MCP client for one upstream server.
    ///
    /// Idempotent: subsequent calls for the same `server_id` return
    /// the cached client. Concurrent first-call races await the same
    /// connect future; only one transport is opened. A failed connect
    /// **does not** poison the slot — the next caller will re-attempt
    /// the open.
    ///
    /// # Errors
    ///
    /// Forwards [`UpstreamError`] variants from the connect path.
    pub async fn get_or_connect(&self, meta: &ServerMeta) -> Result<UpstreamClient, UpstreamError> {
        // Fast path — already-ready entry.
        {
            let g = self.cache.lock().await;
            if let Some(CacheEntry::Ready(c)) = g.get(&meta.id) {
                return Ok(c.clone());
            }
        }

        // Slow path — install our own connect future OR await one that
        // a concurrent caller already kicked off.
        let (tx, mut rx) =
            tokio::sync::watch::channel::<Option<Result<UpstreamClient, String>>>(None);
        let should_drive: bool;
        {
            let mut g = self.cache.lock().await;
            match g.get(&meta.id) {
                Some(CacheEntry::Ready(c)) => return Ok(c.clone()),
                Some(CacheEntry::Pending(existing_rx)) => {
                    rx = existing_rx.clone();
                    should_drive = false;
                }
                None => {
                    g.insert(meta.id.clone(), CacheEntry::Pending(rx.clone()));
                    should_drive = true;
                }
            }
        }

        if should_drive {
            // We own the connect — drive it, publish, and store the
            // ready entry. Any failure clears the slot so retries work.
            let res = connect_one(meta).await;
            let publish = match &res {
                Ok(client) => Ok(client.clone()),
                Err(err) => Err(err.to_string()),
            };
            {
                let mut g = self.cache.lock().await;
                match &res {
                    Ok(client) => {
                        g.insert(meta.id.clone(), CacheEntry::Ready(client.clone()));
                    }
                    Err(_) => {
                        g.remove(&meta.id);
                    }
                }
            }
            // `send` is best-effort — if every receiver is gone we
            // silently swallow the error.
            let _ = tx.send(Some(publish));
            return res;
        }

        // Awaiter path — wait for the driver to publish a result.
        loop {
            if rx.changed().await.is_err() {
                return Err(UpstreamError::Transport(
                    "concurrent upstream connect aborted".into(),
                ));
            }
            if let Some(out) = rx.borrow().clone() {
                return out.map_err(UpstreamError::Transport);
            }
        }
    }

    /// Close every cached client. Called from the binary's shutdown
    /// path; idempotent. Failures during close are swallowed and
    /// logged — one stuck upstream must not block shutdown.
    pub async fn close_all(&self) {
        let entries: Vec<(String, CacheEntry)> = {
            let mut g = self.cache.lock().await;
            g.drain().collect()
        };
        for (id, entry) in entries {
            if let CacheEntry::Ready(client) = entry {
                let label = client.meta.name.clone();
                client.close().await;
                eprintln!("[catique-hub-mcp] upstream {id} ({label}) closed");
            }
        }
    }
}

/// Drive one fresh connect end-to-end: build the transport, send
/// `initialize`, send the `notifications/initialized` notification,
/// return the warm client.
async fn connect_one(meta: &ServerMeta) -> Result<UpstreamClient, UpstreamError> {
    if meta.auth_ref_json.is_some() {
        // Standalone-binary secret resolution is not wired yet. Mirror
        // the Node-era PROXY-S2 caveat: warn on stderr and continue
        // unauthenticated. Public upstreams still work; auth-only ones
        // will fail later on the actual `initialize`.
        eprintln!(
            "[catique-hub-mcp] upstream {}: secrets not yet plumbed in standalone binary",
            meta.id
        );
    }

    let inner = match meta.transport {
        Transport::Stdio => build_stdio(meta)?,
        Transport::Http => build_http(meta, false)?,
        Transport::Sse => build_http(meta, true)?,
    };
    let client = UpstreamClient {
        inner: Arc::new(Mutex::new(inner)),
        meta: meta.clone(),
    };
    // Perform the MCP handshake. `initialize` is gated by
    // `CONNECT_TIMEOUT`; the upstream may legitimately take a few
    // hundred ms to come up (cold stdio child), but we cannot block
    // the standalone binary's tools/list for an unresponsive server.
    let init_params = json!({
        "protocolVersion": "2024-11-05",
        "capabilities": {},
        "clientInfo": {
            "name": "catique-hub-mcp",
            "version": env!("CARGO_PKG_VERSION"),
        },
    });
    client
        .request("initialize", init_params, CONNECT_TIMEOUT)
        .await?;
    client
        .notify("notifications/initialized", json!({}))
        .await?;
    Ok(client)
}

// ---------------------------------------------------------------------------
// stdio transport
// ---------------------------------------------------------------------------

fn build_stdio(meta: &ServerMeta) -> Result<ClientInner, UpstreamError> {
    let cmd = meta
        .command
        .as_deref()
        .ok_or_else(|| UpstreamError::BadConfig {
            id: meta.id.clone(),
            reason: "stdio transport requires `command`".into(),
        })?;
    // Same naive split as the Node side (`command.trim().split(/\s+/)`).
    // Future versions may switch to a structured shape.
    let parts: Vec<&str> = cmd.split_whitespace().collect();
    let Some((exe, args)) = parts.split_first() else {
        return Err(UpstreamError::BadConfig {
            id: meta.id.clone(),
            reason: "stdio `command` is empty after whitespace split".into(),
        });
    };
    let mut command = tokio::process::Command::new(exe);
    command
        .args(args)
        .stdin(std::process::Stdio::piped())
        .stdout(std::process::Stdio::piped())
        .stderr(std::process::Stdio::inherit())
        .kill_on_drop(true);
    let mut child = command
        .spawn()
        .map_err(|e| UpstreamError::Transport(format!("spawn `{exe}`: {e}")))?;
    let stdin = child
        .stdin
        .take()
        .ok_or_else(|| UpstreamError::Transport("stdio child has no stdin".into()))?;
    let stdout = child
        .stdout
        .take()
        .ok_or_else(|| UpstreamError::Transport("stdio child has no stdout".into()))?;
    Ok(ClientInner::Stdio(Box::new(StdioState {
        child,
        stdin,
        reader: BufReader::new(stdout),
        next_id: 1,
    })))
}

async fn stdio_request(
    stdin: &mut ChildStdin,
    reader: &mut BufReader<ChildStdout>,
    next_id: &mut u64,
    method: &str,
    params: Value,
) -> Result<Value, UpstreamError> {
    let id_num = *next_id;
    *next_id = next_id.wrapping_add(1);
    let id_val = Value::from(id_num);
    let frame = Request {
        jsonrpc: jsonrpc::VERSION.into(),
        id: Some(id_val.clone()),
        method: method.into(),
        params: Some(params),
    };
    write_stdio_frame(stdin, &serde_json::to_value(&frame).unwrap_or(Value::Null)).await?;
    // Drain frames until we see one with our id. Notifications from the
    // upstream are tolerated — we just keep reading.
    loop {
        let mut line = String::new();
        let n = reader
            .read_line(&mut line)
            .await
            .map_err(|e| UpstreamError::Transport(format!("stdio read: {e}")))?;
        if n == 0 {
            return Err(UpstreamError::Transport("stdio EOF before reply".into()));
        }
        let trimmed = line.trim();
        if trimmed.is_empty() {
            continue;
        }
        let parsed: Response = if let Ok(r) = serde_json::from_str(trimmed) {
            r
        } else {
            // Either a notification or a malformed frame. Inspect the
            // raw JSON to decide.
            if let Ok(any) = serde_json::from_str::<Value>(trimmed) {
                if any.get("id").is_none() {
                    // Notification — ignore and keep reading.
                    continue;
                }
            }
            return Err(UpstreamError::Protocol(format!(
                "could not parse stdio frame: {trimmed}"
            )));
        };
        if parsed.id != id_val {
            // Out-of-band reply to a different in-flight call. Shouldn't
            // happen under our per-client mutex, but tolerate it.
            continue;
        }
        if let Some(err) = parsed.error {
            return Err(UpstreamError::Protocol(format!(
                "rpc error {}: {}",
                err.code, err.message
            )));
        }
        return Ok(parsed.result.unwrap_or(Value::Null));
    }
}

async fn stdio_notify(
    stdin: &mut ChildStdin,
    method: &str,
    params: Value,
) -> Result<(), UpstreamError> {
    let frame = json!({
        "jsonrpc": jsonrpc::VERSION,
        "method": method,
        "params": params,
    });
    write_stdio_frame(stdin, &frame).await
}

async fn write_stdio_frame(stdin: &mut ChildStdin, frame: &Value) -> Result<(), UpstreamError> {
    let mut body = serde_json::to_vec(frame)
        .map_err(|e| UpstreamError::Transport(format!("stdio serialize: {e}")))?;
    body.push(b'\n');
    stdin
        .write_all(&body)
        .await
        .map_err(|e| UpstreamError::Transport(format!("stdio write: {e}")))?;
    stdin
        .flush()
        .await
        .map_err(|e| UpstreamError::Transport(format!("stdio flush: {e}")))?;
    Ok(())
}

// ---------------------------------------------------------------------------
// http / sse transport
// ---------------------------------------------------------------------------

fn build_http(meta: &ServerMeta, sse: bool) -> Result<ClientInner, UpstreamError> {
    let url = meta.url.clone().ok_or_else(|| UpstreamError::BadConfig {
        id: meta.id.clone(),
        reason: "http/sse transport requires `url`".into(),
    })?;
    // Default reqwest client is fine; the workspace pin disables
    // OpenSSL via rustls-tls. Per-call timeouts are enforced at the
    // outer `request` boundary via `tokio::time::timeout`.
    let client = reqwest::Client::builder()
        .build()
        .map_err(|e| UpstreamError::Transport(format!("reqwest build: {e}")))?;
    Ok(if sse {
        ClientInner::Sse {
            client,
            url,
            next_id: 1,
        }
    } else {
        ClientInner::Http {
            client,
            url,
            next_id: 1,
        }
    })
}

async fn http_request(
    client: &reqwest::Client,
    url: &str,
    next_id: &mut u64,
    method: &str,
    params: Value,
    sse_response_expected: bool,
) -> Result<Value, UpstreamError> {
    let id_num = *next_id;
    *next_id = next_id.wrapping_add(1);
    let id_val = Value::from(id_num);
    let frame = json!({
        "jsonrpc": jsonrpc::VERSION,
        "id": id_val,
        "method": method,
        "params": params,
    });
    let resp = client
        .post(url)
        .header("Content-Type", "application/json")
        .header("Accept", "application/json, text/event-stream")
        .body(
            serde_json::to_vec(&frame)
                .map_err(|e| UpstreamError::Transport(format!("encode http body: {e}")))?,
        )
        .send()
        .await
        .map_err(|e| UpstreamError::Transport(format!("http send: {e}")))?;
    if !resp.status().is_success() {
        return Err(UpstreamError::Transport(format!(
            "http {} from upstream",
            resp.status()
        )));
    }
    let content_type = resp
        .headers()
        .get(reqwest::header::CONTENT_TYPE)
        .and_then(|v| v.to_str().ok())
        .unwrap_or("")
        .to_owned();

    let body = resp
        .text()
        .await
        .map_err(|e| UpstreamError::Transport(format!("http body: {e}")))?;

    // SSE replies look like a stream of `data: <json>` lines; the MCP
    // streamable-HTTP spec uses one or more `event: message` blocks
    // with the JSON-RPC payload in `data`. Pull the first `data:` line
    // that parses as our reply.
    let parsed: Value = if sse_response_expected || content_type.starts_with("text/event-stream") {
        parse_sse_response(&body, &id_val)?
    } else {
        serde_json::from_str(&body)
            .map_err(|e| UpstreamError::Protocol(format!("http json: {e}, body={body}")))?
    };

    if let Some(err) = parsed.get("error") {
        let code = err.get("code").and_then(Value::as_i64).unwrap_or(-32603);
        let msg = err
            .get("message")
            .and_then(Value::as_str)
            .unwrap_or("upstream rpc error");
        return Err(UpstreamError::Protocol(format!("rpc error {code}: {msg}")));
    }
    Ok(parsed.get("result").cloned().unwrap_or(Value::Null))
}

fn parse_sse_response(body: &str, want_id: &Value) -> Result<Value, UpstreamError> {
    for line in body.lines() {
        if let Some(rest) = line.strip_prefix("data:") {
            let trimmed = rest.trim();
            if trimmed.is_empty() {
                continue;
            }
            if let Ok(v) = serde_json::from_str::<Value>(trimmed) {
                if v.get("id") == Some(want_id) {
                    return Ok(v);
                }
            }
        }
    }
    Err(UpstreamError::Protocol(format!(
        "sse body had no data line matching id {want_id}: {body}"
    )))
}

async fn http_notify(
    client: &reqwest::Client,
    url: &str,
    method: &str,
    params: Value,
) -> Result<(), UpstreamError> {
    let frame = json!({
        "jsonrpc": jsonrpc::VERSION,
        "method": method,
        "params": params,
    });
    let resp = client
        .post(url)
        .header("Content-Type", "application/json")
        .body(
            serde_json::to_vec(&frame)
                .map_err(|e| UpstreamError::Transport(format!("encode http body: {e}")))?,
        )
        .send()
        .await
        .map_err(|e| UpstreamError::Transport(format!("http notify: {e}")))?;
    if !resp.status().is_success() {
        return Err(UpstreamError::Transport(format!(
            "http notify {}: {}",
            resp.status(),
            resp.text().await.unwrap_or_default()
        )));
    }
    Ok(())
}

// ---------------------------------------------------------------------------
// Bridge into the application-layer UpstreamCaller
// ---------------------------------------------------------------------------

/// Tiny wrapper that turns the pool into something the
/// [`catique_application::mcp_proxy::McpProxyUseCase`] can call. The
/// trait was originally designed for the supervisor-channel hop —
/// `&dyn UpstreamCaller` makes the use case generic-free at the API
/// surface. We give it the same shape from the standalone side.
///
/// `meta_lookup` is a closure rather than a captured DB pool because
/// the standalone binary already owns one connection-acquire path in
/// `main.rs`; passing a closure avoids duplicating that code.
pub struct PoolUpstreamCaller<'a, F>
where
    F: Fn(&str) -> Result<Option<ServerMeta>, UpstreamError> + Send + Sync,
{
    pool: &'a UpstreamPool,
    meta_lookup: F,
}

impl<'a, F> PoolUpstreamCaller<'a, F>
where
    F: Fn(&str) -> Result<Option<ServerMeta>, UpstreamError> + Send + Sync,
{
    /// Constructor.
    pub fn new(pool: &'a UpstreamPool, meta_lookup: F) -> Self {
        Self { pool, meta_lookup }
    }
}

impl<F> catique_application::mcp_proxy::UpstreamCaller for PoolUpstreamCaller<'_, F>
where
    F: Fn(&str) -> Result<Option<ServerMeta>, UpstreamError> + Send + Sync,
{
    async fn call_upstream(
        &self,
        server_id: &str,
        tool_name: &str,
        args: Value,
    ) -> Result<Value, catique_application::mcp_proxy::UpstreamError> {
        use catique_application::mcp_proxy::UpstreamError as AppErr;
        let meta = match (self.meta_lookup)(server_id) {
            Ok(Some(m)) => m,
            Ok(None) => {
                return Err(AppErr::Transport(format!(
                    "upstream `{server_id}` not found in DB"
                )))
            }
            Err(e) => return Err(AppErr::Transport(e.to_string())),
        };
        let client = self
            .pool
            .get_or_connect(&meta)
            .await
            .map_err(local_to_app_err)?;
        let value = client
            .call_tool(tool_name, args)
            .await
            .map_err(local_to_app_err)?;
        // Pass through `isError: true` payloads as the structured
        // application-layer variant. The standalone binary's
        // `tools/call` handler also wants the raw shape for the
        // external agent — both call sites read this trait differently
        // (binary: raw; application use case: typed) so the trait
        // contract preserves the raw value inside the error envelope.
        if value.get("isError").and_then(Value::as_bool) == Some(true) {
            return Err(AppErr::UpstreamIsError(value.to_string()));
        }
        Ok(value)
    }
}

fn local_to_app_err(e: UpstreamError) -> catique_application::mcp_proxy::UpstreamError {
    use catique_application::mcp_proxy::UpstreamError as AppErr;
    match e {
        UpstreamError::Timeout => AppErr::Timeout,
        UpstreamError::UpstreamIsError(s) => AppErr::UpstreamIsError(s),
        other => AppErr::Transport(other.to_string()),
    }
}

// ---------------------------------------------------------------------------
// DB helper — list enabled rows as `ServerMeta`
// ---------------------------------------------------------------------------

/// Helper: enumerate every enabled `mcp_servers` row as [`ServerMeta`].
/// Used by `main.rs::tools/list` to walk the upstream pool. Caller
/// owns the DB connection; this function never blocks on the pool.
///
/// # Errors
///
/// Forwards `rusqlite` errors via [`UpstreamError::Transport`].
pub fn list_enabled_servers(conn: &rusqlite::Connection) -> Result<Vec<ServerMeta>, UpstreamError> {
    repo::list_by_enabled(conn)
        .map(|rows| rows.into_iter().map(ServerMeta::from).collect())
        .map_err(|e| UpstreamError::Transport(format!("list_by_enabled: {e}")))
}

/// Helper: look up one server by id and return its [`ServerMeta`].
/// Returns `Ok(None)` if the row is missing. Used by `tools/call` to
/// resolve a fully-qualified tool name (`server_name.tool_name`) back
/// to a `server_id`.
///
/// # Errors
///
/// Forwards `rusqlite` errors via [`UpstreamError::Transport`].
pub fn lookup_server_by_id(
    conn: &rusqlite::Connection,
    id: &str,
) -> Result<Option<ServerMeta>, UpstreamError> {
    repo::get_by_id(conn, id)
        .map(|opt| opt.map(ServerMeta::from))
        .map_err(|e| UpstreamError::Transport(format!("get_by_id: {e}")))
}

/// Helper: look up one server by **name** (the qualified-tool prefix).
/// Returns `Ok(None)` if no enabled row exists with that name. We
/// match on name rather than id because the qualified tool name uses
/// the user-visible label — `mcp_servers.name` is unique per row.
///
/// # Errors
///
/// Forwards `rusqlite` errors via [`UpstreamError::Transport`].
pub fn lookup_server_by_name(
    conn: &rusqlite::Connection,
    name: &str,
) -> Result<Option<ServerMeta>, UpstreamError> {
    let rows = repo::list_by_enabled(conn)
        .map_err(|e| UpstreamError::Transport(format!("list_by_enabled: {e}")))?;
    Ok(rows
        .into_iter()
        .find(|r| r.name == name)
        .map(ServerMeta::from))
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn server_meta_from_row_preserves_transport() {
        let row = McpServerRow {
            id: "abc".into(),
            name: "github".into(),
            transport: TransportKind::Stdio,
            url: None,
            command: Some("node mcp.js".into()),
            auth_json: None,
            enabled: true,
            created_at: 0,
            updated_at: 0,
        };
        let m = ServerMeta::from(row);
        assert_eq!(m.id, "abc");
        assert_eq!(m.transport, Transport::Stdio);
        assert_eq!(m.command.as_deref(), Some("node mcp.js"));
    }

    #[test]
    fn stdio_split_rejects_empty_command() {
        // `ClientInner` does not impl Debug (Child/BufReader don't),
        // so we can't `expect_err` it — match the result manually.
        let meta = ServerMeta {
            id: "abc".into(),
            name: "x".into(),
            transport: Transport::Stdio,
            url: None,
            command: Some("   ".into()),
            auth_ref_json: None,
        };
        match build_stdio(&meta) {
            Ok(_) => panic!("empty command must be rejected"),
            Err(UpstreamError::BadConfig { .. }) => {}
            Err(other) => panic!("wrong error variant: {other}"),
        }
    }

    #[test]
    fn http_build_rejects_missing_url() {
        let meta = ServerMeta {
            id: "abc".into(),
            name: "x".into(),
            transport: Transport::Http,
            url: None,
            command: None,
            auth_ref_json: None,
        };
        match build_http(&meta, false) {
            Ok(_) => panic!("missing url must be rejected"),
            Err(UpstreamError::BadConfig { .. }) => {}
            Err(other) => panic!("wrong error variant: {other}"),
        }
    }

    #[test]
    fn parse_sse_finds_matching_id_line() {
        let body = "event: message\n\
                    data: {\"jsonrpc\":\"2.0\",\"id\":1,\"result\":{\"ok\":true}}\n\
                    \n";
        let v = parse_sse_response(body, &Value::from(1)).unwrap();
        assert_eq!(
            v.get("result").and_then(|r| r.get("ok")),
            Some(&Value::from(true))
        );
    }

    #[test]
    fn parse_sse_rejects_no_matching_id() {
        let body = "data: {\"jsonrpc\":\"2.0\",\"id\":99,\"result\":{}}\n";
        let err = parse_sse_response(body, &Value::from(1)).expect_err("no match");
        assert!(matches!(err, UpstreamError::Protocol(_)));
    }
}
