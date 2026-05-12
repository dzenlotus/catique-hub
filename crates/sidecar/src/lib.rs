//! MCP sidecar lifecycle + bridge transport (ctq-112 / E5 round 1).
//!
//! Originally an ADR-0002 spike (ctq-56) that only knew how to
//! `ping`/`shutdown` a stub Node process. ctq-112 turns it into the real
//! bridge for the MCP server in `sidecar/index.js`:
//!
//!   * `start` / `stop` / `restart` / `status` — process lifecycle, with
//!     the same supervisor + restart-policy semantics as the spike.
//!   * `call_ipc(method, params)` — Rust → Node JSON-RPC over the
//!     supervisor channel. Used internally by `ping` (now an
//!     `ipc_call("__ping")`) and by `stop` (`__shutdown`). Available to
//!     callers that need the same transport for ad-hoc supervisor
//!     methods.
//!   * `set_ipc_handler(...)` — register the Node→Rust dispatcher. The
//!     `api` crate plugs this in at startup so `tools/call` over MCP
//!     reaches a Rust use-case **without re-entering Tauri IPC**
//!     (architect's R-1 / R-2: the multiplexed reader runs in a single
//!     dedicated Tokio task; pending requests are tracked in a
//!     `Mutex<HashMap<u64, oneshot::Sender>>`).
//!
//! # Wire format — sentinel-byte multiplex (architect's R-1, Option B)
//!
//! Both stdin and stdout carry two newline-delimited JSON streams over
//! the same pipe. Frames whose first byte is `\x01` (SOH) belong to the
//! "supervisor" channel — `__ping`, `__shutdown`, `ipc_call` and
//! responses to outstanding ids. Plain frames belong to the MCP SDK's
//! `StdioServerTransport`. Today this crate only writes supervisor
//! frames; the read path forwards plain frames into a per-manager
//! `mcp_outbound` channel that ctq-126 will drain (see TODO below).
//!
//! Supervisor frames look like:
//!
//! ```text
//! \x01{"jsonrpc":"2.0","id":42,"method":"__ping"}\n
//! ```

use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::pin::Pin;
use std::sync::Arc;
use std::time::{Duration, Instant};

use serde::{Deserialize, Serialize};
use serde_json::Value;
use thiserror::Error;
use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio::process::{Child, ChildStdin, ChildStdout, Command};
use tokio::sync::{oneshot, Mutex};
use tokio::time::timeout;

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

/// Stable discriminant returned to the Tauri IPC layer and the FE.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(tag = "state", rename_all = "camelCase")]
pub enum SidecarStatus {
    Stopped,
    Starting,
    Running { pid: u32 },
    Crashed { exit_code: Option<i32> },
}

/// Errors from the lifecycle manager and the bridge transport.
#[derive(Debug, Error)]
pub enum SidecarError {
    #[error("sidecar is not running")]
    NotRunning,

    #[error("sidecar failed to start: {0}")]
    SpawnFailed(#[from] std::io::Error),

    #[error("ipc call timed out after {0:?}")]
    IpcTimeout(Duration),

    #[error("ipc serialization error: {0}")]
    IpcSerializationError(String),

    #[error("ipc protocol error: {0}")]
    IpcProtocolError(String),

    #[error("restart policy exceeded: too many restarts in a short window")]
    RestartPolicyExceeded,

    #[error("IPC write error: {0}")]
    WriteError(String),

    #[error("IPC read error: {0}")]
    ReadError(String),
}

/// Asynchronous handler invoked when the Node sidecar issues an
/// `ipc_call` (a tool wants to reach a Rust use case). Returns the
/// JSON value the Node side will surface to the MCP client, or an error
/// string that becomes a JSON-RPC error response.
pub type IpcHandler = Arc<
    dyn Fn(
            String,
            Value,
        ) -> Pin<Box<dyn std::future::Future<Output = Result<Value, String>> + Send>>
        + Send
        + Sync,
>;

// ---------------------------------------------------------------------------
// Wire types — supervisor channel
// ---------------------------------------------------------------------------

/// Outbound `ipc_call` request: Rust → Node lifecycle method.
#[derive(Debug, Serialize)]
struct OutboundRequest<'a> {
    jsonrpc: &'static str,
    id: u64,
    method: &'a str,
    #[serde(skip_serializing_if = "Option::is_none")]
    params: Option<&'a Value>,
}

/// Inbound supervisor frame — either a response to one of our pending
/// requests, or a Node-originated `ipc_call`. Discriminated by the
/// presence of `result` / `error` (response) vs. `method` (request).
#[derive(Debug, Deserialize)]
struct InboundFrame {
    #[serde(default)]
    id: Option<Value>,
    #[serde(default)]
    method: Option<String>,
    #[serde(default)]
    params: Option<Value>,
    #[serde(default)]
    result: Option<Value>,
    #[serde(default)]
    error: Option<InboundError>,
}

#[derive(Debug, Deserialize)]
struct InboundError {
    #[allow(dead_code)]
    #[serde(default)]
    code: Option<i64>,
    message: String,
}

/// Public `ipc_call` request payload. Re-exported for downstream
/// callers that want to construct one explicitly; in practice
/// [`SidecarManager::call_ipc`] handles all the framing.
#[derive(Debug, Serialize, Deserialize)]
pub struct IpcCallRequest {
    pub method: String,
    pub params: Value,
}

/// Public `ipc_call` response payload mirror — handy when integrating
/// the bridge into `#[tauri::command]` shims.
#[derive(Debug, Serialize, Deserialize)]
pub struct IpcCallResponse {
    pub result: Value,
}

// ---------------------------------------------------------------------------
// Internal state
// ---------------------------------------------------------------------------

const MAX_RESTARTS: usize = 3;
const RESTART_WINDOW: Duration = Duration::from_secs(60);
const HEARTBEAT_INTERVAL: Duration = Duration::from_secs(10);
/// Default per-call timeout on the supervisor channel.
const DEFAULT_IPC_TIMEOUT: Duration = Duration::from_secs(5);
/// SOH byte — distinguishes supervisor frames from MCP frames on the
/// shared stdin/stdout pipe (architect's R-1, Option B).
const SUPERVISOR_SENTINEL: u8 = 0x01;

/// Map of outstanding `ipc_call` ids → oneshot sender awaiting the
/// matching response. Wrapped in `Mutex` rather than `dashmap` so we
/// don't pull in a new dep — the workspace doesn't currently use it
/// (verified in `Cargo.toml`).
type PendingMap = Arc<Mutex<HashMap<u64, oneshot::Sender<Result<Value, String>>>>>;

struct Inner {
    child: Option<Child>,
    stdin: Option<ChildStdin>,
    status: SidecarStatus,
    /// Timestamps of recent (re)starts within the restart window.
    restart_history: Vec<Instant>,
    /// Resolved path to the sidecar dir — replayed by the supervisor
    /// task on auto-restart.
    sidecar_dir: Option<PathBuf>,
    /// Monotonic counter for outbound `ipc_call` request ids.
    next_id: u64,
    /// Optional Node→Rust dispatcher (set once via `set_ipc_handler`).
    ipc_handler: Option<IpcHandler>,
}

impl Inner {
    fn new() -> Self {
        Self {
            child: None,
            stdin: None,
            status: SidecarStatus::Stopped,
            restart_history: Vec::new(),
            sidecar_dir: None,
            next_id: 1,
            ipc_handler: None,
        }
    }

    fn prune_restart_history(&mut self) {
        if let Some(cutoff) = Instant::now().checked_sub(RESTART_WINDOW) {
            self.restart_history.retain(|t| *t > cutoff);
        }
    }

    fn may_restart(&mut self) -> bool {
        self.prune_restart_history();
        self.restart_history.len() < MAX_RESTARTS
    }

    fn record_restart(&mut self) {
        self.restart_history.push(Instant::now());
    }

    fn alloc_id(&mut self) -> u64 {
        let id = self.next_id;
        // Saturating add keeps the counter monotonic; collisions are
        // theoretically possible after 2^64 ids but the process restarts
        // long before then.
        self.next_id = self.next_id.wrapping_add(1);
        id
    }
}

// ---------------------------------------------------------------------------
// SidecarManager
// ---------------------------------------------------------------------------

/// Thread-safe lifecycle manager + bridge transport.
///
/// Cheaply cloneable (Arc-backed). Spawning, sending supervisor frames
/// and reading them is fully concurrent: the per-spawn reader task
/// owns the child stdout, so callers never serialize on a global
/// `Mutex<Inner>` across an IO awaitstate (architect's R-2 fix).
#[derive(Clone)]
pub struct SidecarManager {
    inner: Arc<Mutex<Inner>>,
    pending: PendingMap,
}

impl SidecarManager {
    /// Construct a manager in the `Stopped` state.
    #[must_use]
    pub fn new() -> Self {
        Self {
            inner: Arc::new(Mutex::new(Inner::new())),
            pending: Arc::new(Mutex::new(HashMap::new())),
        }
    }

    /// Register the Node→Rust `ipc_call` dispatcher. Idempotent —
    /// subsequent calls overwrite the previous handler. Should be
    /// called **before** `start`; the reader task picks it up at spawn
    /// time. Calling after `start` is allowed but stale in-flight
    /// frames may still see the previous handler.
    pub async fn set_ipc_handler(&self, handler: IpcHandler) {
        self.inner.lock().await.ipc_handler = Some(handler);
    }

    /// Spawn `node <sidecar_dir>/index.js`. Returns the child PID.
    ///
    /// Also kicks off the multiplexed stdout reader and the heartbeat
    /// supervisor.
    ///
    /// # Errors
    ///
    /// Returns `SidecarError::SpawnFailed` if `node` is not found or
    /// the process cannot be created.
    pub async fn start(&self, sidecar_dir: &Path) -> Result<u32, SidecarError> {
        let pid = do_spawn(&self.inner, &self.pending, sidecar_dir).await?;
        spawn_supervisor(self.clone());
        Ok(pid)
    }

    /// Send `__shutdown` over the supervisor channel, wait up to
    /// `timeout_dur`, then SIGKILL on overrun.
    ///
    /// # Errors
    ///
    /// Returns `Ok` even if the sidecar was already stopped.
    pub async fn stop(&self, timeout_dur: Duration) -> Result<(), SidecarError> {
        do_stop(self, timeout_dur).await
    }

    /// Stop then start. Respects the restart policy (≤ 3 restarts /
    /// 60 s).
    ///
    /// # Errors
    ///
    /// `SidecarError::RestartPolicyExceeded` when the budget is spent.
    pub async fn restart(&self, sidecar_dir: &Path) -> Result<u32, SidecarError> {
        {
            let mut g = self.inner.lock().await;
            if !g.may_restart() {
                return Err(SidecarError::RestartPolicyExceeded);
            }
        }
        self.stop(Duration::from_secs(2)).await?;
        self.start(sidecar_dir).await
    }

    /// Current lifecycle status (no side effects).
    pub async fn status(&self) -> SidecarStatus {
        self.inner.lock().await.status.clone()
    }

    /// Send a `__ping` and return the round-trip latency in microseconds.
    ///
    /// Architect's R-2 follow-on: this is a thin wrapper around
    /// [`Self::call_ipc`] kept for backward compat with the spike's
    /// `sidecar_ping` IPC handler.
    ///
    /// # Errors
    ///
    /// `SidecarError::NotRunning` / `IpcTimeout` / `IpcProtocolError`.
    pub async fn ping(&self) -> Result<u64, SidecarError> {
        let t0 = Instant::now();
        let res = self
            .call_ipc("__ping", Value::Null, DEFAULT_IPC_TIMEOUT)
            .await?;
        if res.get("pong").and_then(Value::as_bool) != Some(true) {
            return Err(SidecarError::IpcProtocolError(format!(
                "unexpected pong shape: {res}"
            )));
        }
        // Round-trips longer than ~584 years overflow u64 microseconds.
        #[allow(clippy::cast_possible_truncation)]
        let micros = t0.elapsed().as_micros() as u64;
        Ok(micros)
    }

    /// Send a JSON-RPC request to the Node sidecar over the supervisor
    /// channel and resolve when the matching response arrives.
    ///
    /// `method` is the bare method name; `params` is the JSON value
    /// (use `Value::Null` for none). Returns the unwrapped `result`
    /// payload — error responses become `SidecarError::IpcProtocolError`.
    ///
    /// # Errors
    ///
    /// * `SidecarError::NotRunning` — sidecar is not in `Running` state.
    /// * `SidecarError::IpcTimeout` — no reply within `timeout_dur`.
    /// * `SidecarError::IpcSerializationError` — could not serialize
    ///   the outgoing frame (unexpected: `params` is already a `Value`).
    /// * `SidecarError::IpcProtocolError` — Node returned an error
    ///   response.
    /// * `SidecarError::WriteError` — pipe write failed.
    pub async fn call_ipc(
        &self,
        method: &str,
        params: Value,
        timeout_dur: Duration,
    ) -> Result<Value, SidecarError> {
        // Allocate id + insert pending entry up-front so the reader
        // task can route the response even if it arrives before the
        // write future resolves.
        let id = {
            let mut g = self.inner.lock().await;
            if !matches!(g.status, SidecarStatus::Running { .. }) {
                return Err(SidecarError::NotRunning);
            }
            g.alloc_id()
        };

        let (tx, rx) = oneshot::channel();
        self.pending.lock().await.insert(id, tx);

        // Prepare the wire frame.
        let frame = OutboundRequest {
            jsonrpc: "2.0",
            id,
            method,
            params: if params.is_null() {
                None
            } else {
                Some(&params)
            },
        };
        let body = serde_json::to_string(&frame)
            .map_err(|e| SidecarError::IpcSerializationError(e.to_string()))?;
        // Sentinel-prefixed, newline-terminated.
        let mut bytes = Vec::with_capacity(body.len() + 2);
        bytes.push(SUPERVISOR_SENTINEL);
        bytes.extend_from_slice(body.as_bytes());
        bytes.push(b'\n');

        // Write under the lock so two concurrent supervisor frames
        // don't interleave on stdin. The lock scope is the writev
        // alone — read-back happens on the oneshot.
        {
            let mut g = self.inner.lock().await;
            let stdin = g.stdin.as_mut().ok_or(SidecarError::NotRunning)?;
            stdin
                .write_all(&bytes)
                .await
                .map_err(|e| SidecarError::WriteError(e.to_string()))?;
            stdin
                .flush()
                .await
                .map_err(|e| SidecarError::WriteError(e.to_string()))?;
        }

        match timeout(timeout_dur, rx).await {
            Ok(Ok(Ok(value))) => Ok(value),
            Ok(Ok(Err(msg))) => Err(SidecarError::IpcProtocolError(msg)),
            Ok(Err(_canceled)) => Err(SidecarError::IpcProtocolError(
                "response channel canceled".into(),
            )),
            Err(_elapsed) => {
                // Clean up the pending entry so the slot is freed.
                self.pending.lock().await.remove(&id);
                Err(SidecarError::IpcTimeout(timeout_dur))
            }
        }
    }
}

impl Default for SidecarManager {
    fn default() -> Self {
        Self::new()
    }
}

// ---------------------------------------------------------------------------
// Free-standing async helpers
// ---------------------------------------------------------------------------

/// Spawn the child process, install the multiplexed reader, and return
/// the new pid.
async fn do_spawn(
    inner: &Arc<Mutex<Inner>>,
    pending: &PendingMap,
    sidecar_dir: &Path,
) -> Result<u32, SidecarError> {
    let mut g = inner.lock().await;
    g.status = SidecarStatus::Starting;
    g.sidecar_dir = Some(sidecar_dir.to_path_buf());
    g.record_restart();

    let index_js = sidecar_dir.join("index.js");
    let mut child = Command::new("node")
        .arg(&index_js)
        .stdin(std::process::Stdio::piped())
        .stdout(std::process::Stdio::piped())
        .stderr(std::process::Stdio::inherit())
        .spawn()?;

    let pid = child.id().unwrap_or(0);
    let stdin = child.stdin.take().expect("stdin piped");
    let stdout = child.stdout.take().expect("stdout piped");

    g.stdin = Some(stdin);
    g.child = Some(child);
    g.status = SidecarStatus::Running { pid };
    let handler = g.ipc_handler.clone();
    drop(g);

    // Spawn the dedicated multiplexed reader. It owns `stdout` for the
    // lifetime of this child process — crucial for R-2 (no shared
    // `Mutex<Inner>` held across reads).
    tokio::spawn(reader_task(
        stdout,
        Arc::clone(pending),
        Arc::clone(inner),
        handler,
    ));

    Ok(pid)
}

/// Gracefully stop the sidecar.
///
/// We try the supervisor `__shutdown` first (5 s budget), then SIGKILL
/// the child if it didn't exit within `timeout_dur`.
async fn do_stop(mgr: &SidecarManager, timeout_dur: Duration) -> Result<(), SidecarError> {
    // Best-effort __shutdown — ignore errors: the child may already be
    // gone, or the pipe may be closed.
    let _ = mgr
        .call_ipc("__shutdown", Value::Null, DEFAULT_IPC_TIMEOUT)
        .await;

    // Drop stdin and the child handle so the OS reclaims the pipe.
    let child_opt = {
        let mut g = mgr.inner.lock().await;
        g.stdin = None;
        g.child.take()
    };
    if let Some(mut child) = child_opt {
        let wait_result = timeout(timeout_dur, child.wait()).await;
        if !matches!(wait_result, Ok(Ok(_))) {
            let _ = child.kill().await;
            let _ = child.wait().await;
        }
    }
    mgr.inner.lock().await.status = SidecarStatus::Stopped;
    // Drain any pending senders so callers stop awaiting.
    let mut p = mgr.pending.lock().await;
    p.clear();
    Ok(())
}

// ---------------------------------------------------------------------------
// Multiplexed reader task
// ---------------------------------------------------------------------------

/// Drain `stdout`, demultiplex sentinel-prefixed supervisor frames, and
/// route each frame to either:
///
///   * the `pending` map (if the frame is a response to one of our
///     outbound `ipc_call` ids); or
///   * the `ipc_handler` (if the frame is a Node-originated request);
///   * a no-op + log (if the frame is a plain MCP frame — for now;
///     ctq-126 will route these into an `mcp_outbound` queue).
async fn reader_task(
    mut stdout: ChildStdout,
    pending: PendingMap,
    inner: Arc<Mutex<Inner>>,
    handler: Option<IpcHandler>,
) {
    let mut buf = Vec::with_capacity(8 * 1024);
    let mut chunk = [0u8; 4096];
    loop {
        match stdout.read(&mut chunk).await {
            Ok(0) => {
                // EOF on stdout — child closed its end.
                eprintln!("[catique-sidecar] stdout EOF — reader task exiting");
                // Mark the manager Crashed so the supervisor can
                // attempt restart on its next tick. The supervisor
                // already has its own EOF detection via __ping
                // failure, so this is a fast path.
                let mut g = inner.lock().await;
                if matches!(g.status, SidecarStatus::Running { .. }) {
                    g.status = SidecarStatus::Crashed { exit_code: None };
                }
                break;
            }
            Ok(n) => {
                buf.extend_from_slice(&chunk[..n]);
                process_buffer(&mut buf, &pending, handler.as_ref(), &inner).await;
            }
            Err(err) => {
                eprintln!("[catique-sidecar] stdout read error: {err}");
                break;
            }
        }
    }
}

/// Drain newline-terminated frames out of `buf`, demultiplexing each.
/// Frames that haven't seen a newline yet stay in the buffer for the
/// next iteration.
async fn process_buffer(
    buf: &mut Vec<u8>,
    pending: &PendingMap,
    handler: Option<&IpcHandler>,
    inner: &Arc<Mutex<Inner>>,
) {
    while let Some(nl) = buf.iter().position(|&b| b == b'\n') {
        let line: Vec<u8> = buf.drain(..=nl).collect();
        let line_no_nl = &line[..line.len() - 1];
        if line_no_nl.is_empty() {
            continue;
        }
        if line_no_nl[0] == SUPERVISOR_SENTINEL {
            handle_supervisor_frame(&line_no_nl[1..], pending, handler, inner).await;
        } else {
            // Plain MCP frame from the Node SDK — until ctq-126 wires
            // up the `list_mcp_servers` / `proxy_tool_call` surface,
            // we drop these on the floor (with a debug log so the
            // first appearance is visible).
            // TODO(ctq-126): forward to mcp_outbound channel.
            eprintln!(
                "[catique-sidecar] dropping unhandled MCP frame ({} bytes)",
                line_no_nl.len()
            );
        }
    }
}

async fn handle_supervisor_frame(
    json_bytes: &[u8],
    pending: &PendingMap,
    handler: Option<&IpcHandler>,
    inner: &Arc<Mutex<Inner>>,
) {
    let frame: InboundFrame = match serde_json::from_slice(json_bytes) {
        Ok(f) => f,
        Err(err) => {
            eprintln!(
                "[catique-sidecar] supervisor frame parse error: {err} body={:?}",
                String::from_utf8_lossy(json_bytes)
            );
            return;
        }
    };

    // Response branch: matches one of our pending ipc_call ids.
    if let Some(id_value) = frame.id.as_ref() {
        if let Some(id) = id_value.as_u64() {
            let mut p = pending.lock().await;
            if let Some(tx) = p.remove(&id) {
                if let Some(err) = frame.error {
                    let _ = tx.send(Err(err.message));
                } else {
                    let _ = tx.send(Ok(frame.result.unwrap_or(Value::Null)));
                }
                return;
            }
        }
    }

    // Request branch: Node-originated `ipc_call`.
    let Some(method) = frame.method else {
        eprintln!(
            "[catique-sidecar] supervisor frame missing method/result/error: id={:?}",
            frame.id
        );
        return;
    };

    if method != "ipc_call" {
        eprintln!("[catique-sidecar] supervisor: unknown inbound method={method}");
        write_supervisor_error(
            inner,
            frame.id,
            -32601,
            &format!("Method not found: {method}"),
        )
        .await;
        return;
    }

    // Parse the inner ipc_call payload.
    let params = frame.params.unwrap_or(Value::Null);
    let inner_method = params
        .get("method")
        .and_then(Value::as_str)
        .unwrap_or("")
        .to_owned();
    let inner_params = params.get("params").cloned().unwrap_or(Value::Null);

    let Some(handler) = handler.cloned() else {
        write_supervisor_error(
            inner,
            frame.id,
            -32603,
            "no ipc_handler installed; cannot dispatch ipc_call",
        )
        .await;
        return;
    };

    let id = frame.id;
    // Spawn so a slow handler doesn't stall the reader task — the
    // reader must keep draining stdout to avoid PIPE backpressure on
    // the Node side. The clones are cheap (Arc-backed).
    let inner_arc = Arc::clone(inner);
    tokio::spawn(async move {
        match handler(inner_method, inner_params).await {
            Ok(value) => write_supervisor_response(&inner_arc, id, Ok(value)).await,
            Err(msg) => write_supervisor_response(&inner_arc, id, Err(msg)).await,
        }
    });
}

/// Send a JSON-RPC response back over the supervisor channel.
async fn write_supervisor_response(
    inner: &Arc<Mutex<Inner>>,
    id: Option<Value>,
    result: Result<Value, String>,
) {
    let frame = match result {
        Ok(value) => serde_json::json!({
            "jsonrpc": "2.0",
            "id": id,
            "result": value,
        }),
        Err(msg) => serde_json::json!({
            "jsonrpc": "2.0",
            "id": id,
            "error": { "code": -32000, "message": msg },
        }),
    };
    write_supervisor_raw(inner, &frame).await;
}

async fn write_supervisor_error(
    inner: &Arc<Mutex<Inner>>,
    id: Option<Value>,
    code: i64,
    message: &str,
) {
    let frame = serde_json::json!({
        "jsonrpc": "2.0",
        "id": id,
        "error": { "code": code, "message": message },
    });
    write_supervisor_raw(inner, &frame).await;
}

async fn write_supervisor_raw(inner: &Arc<Mutex<Inner>>, frame: &Value) {
    let body = match serde_json::to_string(frame) {
        Ok(s) => s,
        Err(err) => {
            eprintln!("[catique-sidecar] failed to serialize supervisor frame: {err}");
            return;
        }
    };
    let mut bytes = Vec::with_capacity(body.len() + 2);
    bytes.push(SUPERVISOR_SENTINEL);
    bytes.extend_from_slice(body.as_bytes());
    bytes.push(b'\n');

    let mut g = inner.lock().await;
    if let Some(stdin) = g.stdin.as_mut() {
        if let Err(err) = stdin.write_all(&bytes).await {
            eprintln!("[catique-sidecar] supervisor write error: {err}");
        } else if let Err(err) = stdin.flush().await {
            eprintln!("[catique-sidecar] supervisor flush error: {err}");
        }
    }
}

// ---------------------------------------------------------------------------
// Supervisor task — heartbeats + auto-restart
// ---------------------------------------------------------------------------

fn spawn_supervisor(mgr: SidecarManager) {
    tokio::spawn(supervisor_task(mgr));
}

async fn supervisor_task(mgr: SidecarManager) {
    loop {
        tokio::time::sleep(HEARTBEAT_INTERVAL).await;

        // Exit cleanly if the user (or stop()) ended the process.
        let status_now = mgr.inner.lock().await.status.clone();
        if !matches!(status_now, SidecarStatus::Running { .. }) {
            break;
        }

        match mgr.ping().await {
            Ok(_latency_us) => { /* healthy */ }
            Err(err) => {
                eprintln!("[catique-sidecar] heartbeat ping failed: {err}");
                let (may, dir) = {
                    let mut g = mgr.inner.lock().await;
                    g.stdin = None;
                    g.status = SidecarStatus::Crashed { exit_code: None };
                    (g.may_restart(), g.sidecar_dir.clone())
                };

                let Some(dir) = dir else {
                    eprintln!("[catique-sidecar] no sidecar_dir recorded; cannot auto-restart");
                    break;
                };
                if !may {
                    eprintln!("[catique-sidecar] restart policy exhausted; staying Crashed");
                    break;
                }

                let child_opt = mgr.inner.lock().await.child.take();
                if let Some(mut child) = child_opt {
                    let _ = child.kill().await;
                    let _ = child.wait().await;
                }
                mgr.inner.lock().await.status = SidecarStatus::Stopped;

                match do_spawn(&mgr.inner, &mgr.pending, &dir).await {
                    Ok(pid) => {
                        eprintln!(
                            "[catique-sidecar] auto-restarted after heartbeat fail, pid={pid}"
                        );
                    }
                    Err(e) => {
                        eprintln!("[catique-sidecar] auto-restart spawn failed: {e}");
                        mgr.inner.lock().await.status = SidecarStatus::Crashed { exit_code: None };
                        break;
                    }
                }
            }
        }
    }
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

#[cfg(test)]
mod tests {
    use super::*;
    use std::path::PathBuf;

    fn sidecar_dir() -> PathBuf {
        let manifest = PathBuf::from(env!("CARGO_MANIFEST_DIR"));
        manifest
            .parent()
            .expect("crates/")
            .parent()
            .expect("workspace root")
            .join("sidecar")
    }

    /// Smoke test: spawn → ping (`__ping`) → shutdown → clean exit.
    ///
    /// Marked `#[ignore]` because it requires `node` on PATH and the
    /// installed `@modelcontextprotocol/sdk` under `sidecar/node_modules`.
    #[tokio::test]
    #[ignore = "requires node + sidecar/node_modules; run locally with --ignored"]
    async fn smoke_ping_pong_shutdown() {
        let dir = sidecar_dir();
        assert!(
            dir.join("index.js").exists(),
            "sidecar/index.js not found at {:?}",
            dir.join("index.js")
        );

        let mgr = SidecarManager::new();
        let pid = mgr.start(&dir).await.expect("start should succeed");
        assert!(pid > 0, "expected valid PID");

        let latency_us = mgr.ping().await.expect("ping should succeed");
        assert!(latency_us < 5_000_000, "ping took longer than 5 s");

        mgr.stop(Duration::from_secs(2))
            .await
            .expect("stop should succeed");

        assert_eq!(mgr.status().await, SidecarStatus::Stopped);
    }
}
