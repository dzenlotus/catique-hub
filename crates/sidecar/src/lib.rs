//! MCP sidecar lifecycle manager — ADR-0002 spike (ctq-56).
//!
//! # Scope
//!
//! Validates the Tauri spawn / lifecycle / health story **before** the real
//! MCP bridge is written in E5. This crate is intentionally minimal:
//!
//! * Spawns `node sidecar/index.js` as a child process.
//! * Tracks the child PID + stdin/stdout handles behind an `Arc<Mutex<Inner>>`.
//! * Provides `ping()` — sends a JSON-RPC `ping` line, reads back the
//!   `pong`, and returns the round-trip latency in microseconds.
//! * Provides `stop()` — sends `shutdown`, waits up to `timeout`, then
//!   SIGKILLs if needed.
//! * Provides `restart()` — stop + start.
//! * Enforces a restart-policy: ≤ 3 restarts within 60 seconds; after that
//!   stays in `Crashed` until manually restarted.
//! * Runs a background supervisor task every 10 seconds; on ping failure,
//!   marks `Crashed` and attempts auto-restart up to the policy limit.
//!
//! # NOT in scope (E5)
//!
//! Real MCP protocol, tool surface, IPC transport to Rust DB layer.

use std::path::{Path, PathBuf};
use std::sync::Arc;
use std::time::{Duration, Instant};

use serde::{Deserialize, Serialize};
use thiserror::Error;
use tokio::io::{AsyncBufReadExt, AsyncWriteExt, BufReader};
use tokio::process::{Child, ChildStdin, ChildStdout, Command};
use tokio::sync::Mutex;
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

/// Errors from the lifecycle manager.
#[derive(Debug, Error)]
pub enum SidecarError {
    #[error("sidecar is not running")]
    NotRunning,

    #[error("sidecar failed to start: {0}")]
    SpawnFailed(#[from] std::io::Error),

    #[error("ping timed out after {0:?}")]
    PingTimeout(Duration),

    #[error("ping response parse error: {0}")]
    PingParseFailed(String),

    #[error("restart policy exceeded: too many restarts in a short window")]
    RestartPolicyExceeded,

    #[error("IPC write error: {0}")]
    WriteError(String),

    #[error("IPC read error: {0}")]
    ReadError(String),
}

// ---------------------------------------------------------------------------
// Internal state
// ---------------------------------------------------------------------------

/// Maximum restarts within the rolling window before giving up.
const MAX_RESTARTS: usize = 3;
/// Rolling window duration for the restart policy.
const RESTART_WINDOW: Duration = Duration::from_secs(60);
/// Heartbeat interval.
const HEARTBEAT_INTERVAL: Duration = Duration::from_secs(10);
/// Ping response timeout — used both for heartbeat and user-facing ping.
const PING_TIMEOUT: Duration = Duration::from_secs(5);

struct Inner {
    child: Option<Child>,
    stdin: Option<ChildStdin>,
    stdout: Option<BufReader<ChildStdout>>,
    status: SidecarStatus,
    /// Timestamps of recent (re)starts within the restart window.
    restart_history: Vec<Instant>,
    /// Resolved path to sidecar dir (saved so the supervisor can restart).
    sidecar_dir: Option<PathBuf>,
}

impl Inner {
    fn new() -> Self {
        Self {
            child: None,
            stdin: None,
            stdout: None,
            status: SidecarStatus::Stopped,
            restart_history: Vec::new(),
            sidecar_dir: None,
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
}

// ---------------------------------------------------------------------------
// SidecarManager
// ---------------------------------------------------------------------------

/// Thread-safe lifecycle manager for the `catique-sidecar` Node process.
///
/// Cheaply cloneable (Arc-backed). All async methods acquire the internal
/// Mutex for the duration of a single line-level IO exchange.
#[derive(Clone)]
pub struct SidecarManager {
    inner: Arc<Mutex<Inner>>,
}

impl SidecarManager {
    /// Create a manager in the `Stopped` state.
    #[must_use]
    pub fn new() -> Self {
        Self {
            inner: Arc::new(Mutex::new(Inner::new())),
        }
    }

    /// Spawn `node <sidecar_dir>/index.js`.  Returns the child PID.
    ///
    /// Also kicks off the background supervisor task that heartbeats the
    /// process and auto-restarts on failure.
    ///
    /// # Errors
    ///
    /// Returns `SidecarError::SpawnFailed` if `node` is not found or the
    /// process cannot be created.
    pub async fn start(&self, sidecar_dir: &Path) -> Result<u32, SidecarError> {
        let pid = do_spawn(&self.inner, sidecar_dir).await?;
        // Kick off the supervisor in its own task.  We pass the Arc directly
        // so the supervisor is `Send + 'static` without capturing `self`.
        spawn_supervisor(Arc::clone(&self.inner));
        Ok(pid)
    }

    /// Send `{"method":"shutdown"}`, wait up to `timeout_dur`, then SIGKILL.
    ///
    /// # Errors
    ///
    /// Returns `Ok` even if the sidecar was already stopped.
    pub async fn stop(&self, timeout_dur: Duration) -> Result<(), SidecarError> {
        do_stop(&self.inner, timeout_dur).await
    }

    /// Stop then start.  Respects restart policy.
    ///
    /// # Errors
    ///
    /// Returns `SidecarError::RestartPolicyExceeded` if too many restarts
    /// occurred in the last 60 seconds.
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

    /// Return the current status without side effects.
    pub async fn status(&self) -> SidecarStatus {
        self.inner.lock().await.status.clone()
    }

    /// Send a `ping` JSON-RPC request and return the round-trip latency in
    /// microseconds.
    ///
    /// # Errors
    ///
    /// * `SidecarError::NotRunning` — sidecar not in `Running` state.
    /// * `SidecarError::PingTimeout` — no response within 5 seconds.
    /// * `SidecarError::PingParseFailed` — malformed JSON or unexpected shape.
    pub async fn ping(&self) -> Result<u64, SidecarError> {
        do_ping(&self.inner).await
    }
}

impl Default for SidecarManager {
    fn default() -> Self {
        Self::new()
    }
}

// ---------------------------------------------------------------------------
// Free-standing async helpers — all `Send + 'static` safe
// ---------------------------------------------------------------------------

/// Spawn the child process and populate `inner`.
async fn do_spawn(inner: &Arc<Mutex<Inner>>, sidecar_dir: &Path) -> Result<u32, SidecarError> {
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
    g.stdout = Some(BufReader::new(stdout));
    g.child = Some(child);
    g.status = SidecarStatus::Running { pid };
    Ok(pid)
}

/// Gracefully stop the sidecar.
async fn do_stop(inner: &Arc<Mutex<Inner>>, timeout_dur: Duration) -> Result<(), SidecarError> {
    // Phase 1: send shutdown and drain IO handles — release lock before awaiting.
    let child_opt = {
        let mut g = inner.lock().await;
        if let Some(stdin) = g.stdin.as_mut() {
            let msg = "{\"jsonrpc\":\"2.0\",\"id\":0,\"method\":\"shutdown\"}\n";
            let _ = stdin.write_all(msg.as_bytes()).await;
            let _ = stdin.flush().await;
        }
        g.stdin = None;
        g.stdout = None;
        g.child.take()
    };

    // Phase 2: wait for child exit (no lock held).
    if let Some(mut child) = child_opt {
        let wait_result = timeout(timeout_dur, child.wait()).await;
        if !matches!(wait_result, Ok(Ok(_))) {
            let _ = child.kill().await;
            let _ = child.wait().await;
        }
    }

    inner.lock().await.status = SidecarStatus::Stopped;
    Ok(())
}

/// Send a ping and return latency in microseconds.
async fn do_ping(inner: &Arc<Mutex<Inner>>) -> Result<u64, SidecarError> {
    let mut g = inner.lock().await;

    if !matches!(g.status, SidecarStatus::Running { .. }) {
        return Err(SidecarError::NotRunning);
    }

    let stdin = g.stdin.as_mut().ok_or(SidecarError::NotRunning)?;
    let t0 = Instant::now();
    let msg = "{\"jsonrpc\":\"2.0\",\"id\":1,\"method\":\"ping\"}\n";
    stdin
        .write_all(msg.as_bytes())
        .await
        .map_err(|e| SidecarError::WriteError(e.to_string()))?;
    stdin
        .flush()
        .await
        .map_err(|e| SidecarError::WriteError(e.to_string()))?;

    let reader = g.stdout.as_mut().ok_or(SidecarError::NotRunning)?;
    let mut line = String::new();
    let read_fut = reader.read_line(&mut line);

    let bytes_read = timeout(PING_TIMEOUT, read_fut)
        .await
        .map_err(|_| SidecarError::PingTimeout(PING_TIMEOUT))?
        .map_err(|e| SidecarError::ReadError(e.to_string()))?;

    if bytes_read == 0 {
        return Err(SidecarError::ReadError("EOF on stdout".into()));
    }

    // Round-trips longer than ~584 years overflow u64 microseconds — acceptable truncation.
    #[allow(clippy::cast_possible_truncation)]
    let latency = t0.elapsed().as_micros() as u64;

    let v: serde_json::Value = serde_json::from_str(line.trim())
        .map_err(|e| SidecarError::PingParseFailed(e.to_string()))?;
    if v["result"]["pong"].as_bool() != Some(true) {
        return Err(SidecarError::PingParseFailed(format!(
            "unexpected pong shape: {v}"
        )));
    }

    Ok(latency)
}

// ---------------------------------------------------------------------------
// Supervisor task
// ---------------------------------------------------------------------------

/// Spawn the supervisor as a `tokio::task`.  The supervisor heartbeats the
/// process every `HEARTBEAT_INTERVAL` and auto-restarts on failure.
///
/// Design note: rather than recursing (which prevents the compiler from
/// proving `Send`), the supervisor loop handles restarts inline within a
/// single task — one iteration per heartbeat period.
fn spawn_supervisor(inner: Arc<Mutex<Inner>>) {
    tokio::spawn(supervisor_task(inner));
}

/// The supervisor loop body.  Runs until the sidecar is stopped by the user
/// or the restart policy is exhausted.
async fn supervisor_task(inner: Arc<Mutex<Inner>>) {
    loop {
        tokio::time::sleep(HEARTBEAT_INTERVAL).await;

        // Exit if no longer running (user stopped it).
        {
            let status = inner.lock().await.status.clone();
            if !matches!(status, SidecarStatus::Running { .. }) {
                break;
            }
        }

        match do_ping(&inner).await {
            Ok(_latency_us) => {
                // Healthy — continue heartbeat loop.
            }
            Err(err) => {
                eprintln!("[catique-sidecar] heartbeat ping failed: {err}");

                // Mark crashed and retrieve the sidecar dir.
                let (may, dir) = {
                    let mut g = inner.lock().await;
                    g.stdin = None;
                    g.stdout = None;
                    g.status = SidecarStatus::Crashed { exit_code: None };
                    let may = g.may_restart();
                    let dir = g.sidecar_dir.clone();
                    (may, dir)
                };

                let Some(dir) = dir else {
                    eprintln!("[catique-sidecar] no sidecar_dir recorded; cannot auto-restart");
                    break;
                };

                if !may {
                    eprintln!("[catique-sidecar] restart policy exhausted; staying Crashed");
                    break;
                }

                // Clean up child handle (no blocking wait — process may already be dead).
                let child_opt = inner.lock().await.child.take();
                if let Some(mut child) = child_opt {
                    let _ = child.kill().await;
                    let _ = child.wait().await;
                }
                inner.lock().await.status = SidecarStatus::Stopped;

                // Re-spawn.
                match do_spawn(&inner, &dir).await {
                    Ok(pid) => {
                        eprintln!(
                            "[catique-sidecar] auto-restarted after heartbeat fail, pid={pid}"
                        );
                        // Continue the loop — next iteration will heartbeat the new pid.
                    }
                    Err(e) => {
                        eprintln!("[catique-sidecar] auto-restart spawn failed: {e}");
                        inner.lock().await.status =
                            SidecarStatus::Crashed { exit_code: None };
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
        // Walk up from CARGO_MANIFEST_DIR to workspace root, then into sidecar/.
        let manifest = PathBuf::from(env!("CARGO_MANIFEST_DIR"));
        // crates/sidecar/ -> crates/ -> workspace root
        manifest
            .parent()
            .expect("crates/")
            .parent()
            .expect("workspace root")
            .join("sidecar")
    }

    /// Smoke test: spawn → ping → pong → shutdown → clean exit.
    ///
    /// Marked `#[ignore]` because it requires `node` on PATH, which is not
    /// guaranteed in all CI environments.  Run locally with:
    ///   cargo test -p catique-sidecar -- --ignored
    #[tokio::test]
    #[ignore = "requires `node` on PATH; run locally with --ignored"]
    async fn smoke_ping_pong_shutdown() {
        let dir = sidecar_dir();
        assert!(
            dir.join("index.js").exists(),
            "sidecar/index.js not found at {:?}",
            dir.join("index.js")
        );

        let mgr = SidecarManager::new();

        // Start.
        let pid = mgr.start(&dir).await.expect("start should succeed");
        assert!(pid > 0, "expected valid PID");

        // Ping.
        let latency_us = mgr.ping().await.expect("ping should succeed");
        assert!(latency_us < 5_000_000, "ping took longer than 5 s");

        // Stop (graceful shutdown).
        mgr.stop(Duration::from_secs(2))
            .await
            .expect("stop should succeed");

        assert_eq!(mgr.status().await, SidecarStatus::Stopped);
    }
}
