//! sidecar-spike shell — ctq-56 / ADR-0002 validation.
//!
//! This is a thin, isolated copy of the spawn/echo path from
//! `crates/sidecar/src/lib.rs`. Reduced to what the spike needs:
//!
//!   * spawn Node `index.js` from the resource bundle in Tauri's `setup`,
//!   * stamp a `cold_start_ms` from `setup` entry to first `echo` reply,
//!   * expose `sidecar_status`, `sidecar_echo` IPC commands,
//!   * cleanly close stdin on `ExitRequested` so Node observes EOF and exits.
//!
//! NOT in scope: restart policy, supervisor heartbeat, structured tracing,
//! shutdown JSON-RPC. Those exist in the production crate; the spike only
//! validates what the ADR's Q-1/Q-2/Q-3 demand.

use std::path::PathBuf;
use std::sync::Arc;
use std::time::Instant;

use serde::Serialize;
use tauri::{Manager, RunEvent};
use tokio::io::{AsyncBufReadExt, AsyncWriteExt, BufReader};
use tokio::process::{ChildStdin, ChildStdout, Command};
use tokio::sync::Mutex;

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum State {
    Stopped,
    Starting,
    Running,
    Crashed,
}

#[derive(Debug, Clone, Serialize)]
pub struct StatusDto {
    pub state: String,
    pub pid: Option<u32>,
    /// Cold start = setup-entry -> first echo response, in ms. None until
    /// the first echo round-trip lands.
    pub cold_start_ms: Option<f64>,
}

struct Inner {
    child: Option<tokio::process::Child>,
    stdin: Option<ChildStdin>,
    stdout: Option<BufReader<ChildStdout>>,
    state: State,
    pid: Option<u32>,
    /// Wall-clock instant captured at `setup` entry.
    spawn_started: Option<Instant>,
    cold_start_ms: Option<f64>,
    next_id: u64,
}

#[derive(Clone)]
pub struct SpikeManager(Arc<Mutex<Inner>>);

impl SpikeManager {
    pub fn new() -> Self {
        Self(Arc::new(Mutex::new(Inner {
            child: None,
            stdin: None,
            stdout: None,
            state: State::Stopped,
            pid: None,
            spawn_started: None,
            cold_start_ms: None,
            next_id: 1,
        })))
    }

    /// Spawn `node <index_js>`. Stamps `spawn_started`. Does not block on
    /// the first response — that happens lazily on first `echo`.
    pub async fn spawn(&self, index_js: PathBuf) -> Result<(), String> {
        let mut g = self.0.lock().await;
        if matches!(g.state, State::Running | State::Starting) {
            return Ok(());
        }
        g.state = State::Starting;
        g.spawn_started = Some(Instant::now());

        eprintln!("[sidecar-spike] spawning: node {}", index_js.display());

        let mut cmd = Command::new("node");
        cmd.arg(&index_js)
            .stdin(std::process::Stdio::piped())
            .stdout(std::process::Stdio::piped())
            .stderr(std::process::Stdio::inherit())
            .kill_on_drop(true);

        let mut child = cmd
            .spawn()
            .map_err(|e| format!("spawn failed: {e} (path: {})", index_js.display()))?;

        let stdin = child.stdin.take().ok_or("no stdin handle")?;
        let stdout = child.stdout.take().ok_or("no stdout handle")?;
        g.pid = child.id();
        g.child = Some(child);
        g.stdin = Some(stdin);
        g.stdout = Some(BufReader::new(stdout));
        g.state = State::Running;
        Ok(())
    }

    pub async fn status(&self) -> StatusDto {
        let g = self.0.lock().await;
        StatusDto {
            state: match g.state {
                State::Stopped => "stopped",
                State::Starting => "starting",
                State::Running => "running",
                State::Crashed => "crashed",
            }
            .to_string(),
            pid: g.pid,
            cold_start_ms: g.cold_start_ms,
        }
    }

    /// Send a JSON-RPC echo, await one line of response, parse it.
    /// Stamps `cold_start_ms` on the first successful round-trip.
    pub async fn echo(&self, msg: String) -> Result<serde_json::Value, String> {
        let mut g = self.0.lock().await;

        if !matches!(g.state, State::Running) {
            return Err(format!("sidecar not running (state: {:?})", g.state));
        }

        let id = g.next_id;
        g.next_id += 1;

        let req = serde_json::json!({
            "jsonrpc": "2.0",
            "id": id,
            "method": "echo",
            "params": { "msg": msg },
        });
        let line = format!("{}\n", req);

        let stdin = g.stdin.as_mut().ok_or("stdin gone")?;
        stdin
            .write_all(line.as_bytes())
            .await
            .map_err(|e| format!("write: {e}"))?;
        stdin.flush().await.map_err(|e| format!("flush: {e}"))?;

        let stdout = g.stdout.as_mut().ok_or("stdout gone")?;
        let mut buf = String::new();
        let n = stdout
            .read_line(&mut buf)
            .await
            .map_err(|e| format!("read: {e}"))?;
        if n == 0 {
            g.state = State::Crashed;
            return Err("EOF from sidecar".into());
        }

        let resp: serde_json::Value =
            serde_json::from_str(buf.trim()).map_err(|e| format!("parse: {e} :: {buf:?}"))?;

        // First successful echo -> stamp cold-start.
        if g.cold_start_ms.is_none() {
            if let Some(t0) = g.spawn_started {
                let dt = t0.elapsed();
                let ms = dt.as_secs_f64() * 1000.0;
                g.cold_start_ms = Some(ms);
                eprintln!("[sidecar-spike] cold-start (setup -> first echo): {ms:.1} ms");
            }
        }

        Ok(resp)
    }

    /// Best-effort: drop stdin handle so Node sees EOF and exits.
    pub async fn shutdown(&self) {
        let mut g = self.0.lock().await;
        // Closing stdin is the cheapest graceful-shutdown signal Node honours
        // (`rl.on("close")` -> `process.exit(0)`). The full implementation
        // sends a JSON-RPC shutdown first; the spike skips that for brevity.
        let _ = g.stdin.take();
        if let Some(mut child) = g.child.take() {
            // give Node ~250 ms to exit cleanly, then SIGKILL
            let waited = tokio::time::timeout(
                std::time::Duration::from_millis(250),
                child.wait(),
            )
            .await;
            if waited.is_err() {
                let _ = child.start_kill();
                let _ = child.wait().await;
            }
        }
        g.state = State::Stopped;
        g.pid = None;
    }
}

impl Default for SpikeManager {
    fn default() -> Self {
        Self::new()
    }
}

// ---------------------------------------------------------------------------
// Tauri IPC commands
// ---------------------------------------------------------------------------

#[tauri::command]
async fn sidecar_status(mgr: tauri::State<'_, SpikeManager>) -> Result<StatusDto, String> {
    Ok(mgr.status().await)
}

#[tauri::command]
async fn sidecar_echo(
    msg: String,
    mgr: tauri::State<'_, SpikeManager>,
) -> Result<serde_json::Value, String> {
    mgr.echo(msg).await
}

// ---------------------------------------------------------------------------
// Resource path resolution — Q-2 of the ADR
// ---------------------------------------------------------------------------

/// Resolve `sidecar/index.js`:
///   * Bundled (release): `app.path().resolve_resource("../sidecar/index.js")`
///     which Tauri rewrites to `<bundle>.app/Contents/Resources/_up_/sidecar/index.js`
///     on macOS.
///   * Dev: fall back to walking up from the manifest dir.
fn resolve_sidecar(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    // Tauri 2.x: `bundle.resources` entries keep their relative path layout
    // under Resources/. Our entry is `../sidecar/index.js`, so the relative
    // path inside the resource dir is `_up_/sidecar/index.js`.
    let resource_dir = app
        .path()
        .resource_dir()
        .map_err(|e| format!("resource_dir: {e}"))?;
    let bundled = resource_dir.join("_up_").join("sidecar").join("index.js");
    if bundled.exists() {
        return Ok(bundled);
    }
    let alt = resource_dir.join("sidecar").join("index.js");
    if alt.exists() {
        return Ok(alt);
    }

    // Dev fallback: src-tauri/target/debug/<bin> -> ../../sidecar/index.js
    let manifest_dir = std::path::PathBuf::from(env!("CARGO_MANIFEST_DIR"));
    let dev = manifest_dir.parent().unwrap_or(&manifest_dir).join("sidecar/index.js");
    if dev.exists() {
        return Ok(dev);
    }

    Err(format!(
        "could not locate sidecar/index.js (tried {:?}, {:?}, {:?})",
        bundled, alt, dev
    ))
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let mgr = SpikeManager::new();

    tauri::Builder::default()
        .manage(mgr.clone())
        .setup(move |app| {
            let app_handle = app.handle().clone();
            let mgr_clone = mgr.clone();
            tauri::async_runtime::spawn(async move {
                match resolve_sidecar(&app_handle) {
                    Ok(path) => {
                        eprintln!("[sidecar-spike] resolved sidecar at: {}", path.display());
                        if let Err(e) = mgr_clone.spawn(path).await {
                            eprintln!("[sidecar-spike] spawn error: {e}");
                        }
                    }
                    Err(e) => eprintln!("[sidecar-spike] resolve error: {e}"),
                }
            });
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![sidecar_status, sidecar_echo])
        .build(tauri::generate_context!())
        .expect("error while building tauri application")
        .run(move |app_handle, event| {
            if let RunEvent::ExitRequested { .. } = event {
                if let Some(mgr) = app_handle.try_state::<SpikeManager>() {
                    let mgr = mgr.inner().clone();
                    // Block briefly so Node observes EOF before the process tree dies.
                    let rt = tokio::runtime::Builder::new_current_thread()
                        .enable_all()
                        .build()
                        .expect("rt");
                    rt.block_on(async move { mgr.shutdown().await });
                }
            }
        });
}
