//! `catique-hub-mcp` stdio smoke tests.
//!
//! Spawn the compiled binary as a subprocess, send a JSON-RPC frame
//! over stdin, assert the response shape on stdout. Three scenarios
//! exercise the single-endpoint `mcp_proxy_tool` façade:
//!
//!   * `tools/list` returns exactly one tool (`mcp_proxy_tool`) with
//!     the documented `{ method, args }` input schema.
//!   * `tools/call` via the façade dispatches a representative read-
//!     only catique method (`list_spaces`) and returns a
//!     `content[0].text` envelope without an `isError` flag.
//!   * `tools/call` with an unknown bare method surfaces a tool-level
//!     `isError: true` envelope rather than panicking.
//!
//! The dispatch logic itself is unit-tested inside
//! `catique_application::mcp_dispatch` — these tests guard the wire
//! shape and the binary-level glue (manifest embed, DB-open at
//! `db_path()`, JSON-RPC framing).

use std::path::PathBuf;
use std::process::Stdio;
use std::time::Duration;

use serde_json::{json, Value};
use tempfile::TempDir;
use tokio::io::{AsyncBufReadExt, AsyncWriteExt, BufReader};
use tokio::process::Command;
use tokio::time::timeout;

/// Resolve the path to the freshly-built `catique-hub-mcp` binary.
///
/// Cargo sets `CARGO_BIN_EXE_<name>` for any `[[bin]]` target inside
/// the current package; we lean on it so the test never picks up a
/// stale system install.
fn bin_path() -> PathBuf {
    PathBuf::from(env!("CARGO_BIN_EXE_catique-hub-mcp"))
}

/// Spawn the binary with a `XDG_DATA_HOME` / `HOME` override pointing
/// at a fresh temp dir so the migration runner provisions a clean DB
/// instead of touching the developer's working dataset.
fn spawn_with_tmp_home(tmp: &TempDir) -> tokio::process::Child {
    let mut cmd = Command::new(bin_path());
    cmd.stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .env("XDG_DATA_HOME", tmp.path())
        .env("HOME", tmp.path())
        .env("APPDATA", tmp.path())
        .env("LOCALAPPDATA", tmp.path());
    cmd.spawn().expect("spawn catique-hub-mcp")
}

/// One-shot request/response over the binary's stdio pipes.
async fn one_shot(request: Value) -> Value {
    let tmp = TempDir::new().expect("tmp data dir");
    let mut child = spawn_with_tmp_home(&tmp);
    let mut stdin = child.stdin.take().expect("stdin");
    let stdout = child.stdout.take().expect("stdout");

    let line = serde_json::to_string(&request).expect("serialize req");
    stdin
        .write_all(line.as_bytes())
        .await
        .expect("write request");
    stdin.write_all(b"\n").await.expect("write newline");
    stdin.flush().await.expect("flush stdin");

    // Read one response line, with a generous timeout. The binary
    // initialises the DB pool + runs migrations on first launch, which
    // can take a few seconds on a cold workspace.
    let mut reader = BufReader::new(stdout);
    let mut buf = String::new();
    let read_fut = reader.read_line(&mut buf);
    timeout(Duration::from_secs(15), read_fut)
        .await
        .expect("response within 15 s")
        .expect("read response");

    // Drop the child so we don't leak processes between tests. Close
    // stdin first so the binary's `read_line` returns EOF and the
    // process exits cleanly.
    drop(stdin);
    // Best-effort wait — the binary exits on stdin EOF; if it doesn't
    // within 5 s we kill it.
    let _ = timeout(Duration::from_secs(5), child.wait()).await;
    let _ = child.kill().await;

    serde_json::from_str::<Value>(buf.trim()).expect("parse response JSON")
}

#[tokio::test(flavor = "multi_thread")]
async fn tools_list_exposes_native_manifest_plus_proxy_tool() {
    let resp = one_shot(json!({
        "jsonrpc": "2.0",
        "id": 1,
        "method": "tools/list",
    }))
    .await;
    assert_eq!(resp["jsonrpc"], "2.0");
    assert_eq!(resp["id"], 1);
    let tools = resp["result"]["tools"]
        .as_array()
        .expect("tools must be array");
    // Standard MCP exposure: every native tool surfaces under its bare
    // name, plus the single `mcp_proxy_tool` façade for upstream calls.
    assert!(
        tools.len() > 100,
        "expected the embedded manifest + proxy tool, got len={}",
        tools.len()
    );
    let names: Vec<&str> = tools.iter().filter_map(|t| t["name"].as_str()).collect();
    assert!(
        names.contains(&"list_spaces"),
        "native `list_spaces` must be in tools/list"
    );
    assert!(
        names.contains(&"create_task"),
        "native `create_task` must be in tools/list"
    );
    assert!(
        names.contains(&"mcp_proxy_tool"),
        "mcp_proxy_tool façade must be in tools/list"
    );
    let proxy = tools
        .iter()
        .find(|t| t["name"].as_str() == Some("mcp_proxy_tool"))
        .expect("proxy entry");
    assert_eq!(
        proxy["inputSchema"]["properties"]["method"]["type"].as_str(),
        Some("string"),
        "mcp_proxy_tool must declare `method: string`; got: {proxy}"
    );
}

#[tokio::test(flavor = "multi_thread")]
async fn tools_call_list_spaces_directly_returns_array() {
    // Native tools are exposed under their bare name and called
    // directly — `mcp_proxy_tool` is only for upstream traffic.
    let resp = one_shot(json!({
        "jsonrpc": "2.0",
        "id": 7,
        "method": "tools/call",
        "params": {
            "name": "list_spaces",
            "arguments": {}
        },
    }))
    .await;
    assert_eq!(resp["id"], 7);
    let result = &resp["result"];
    assert!(
        result["isError"].as_bool().unwrap_or(false).not(),
        "list_spaces must succeed on a fresh DB: {result}"
    );
    let text = result["content"][0]["text"]
        .as_str()
        .expect("content[0].text must be string");
    let parsed: Value = serde_json::from_str(text).expect("inner text must be JSON");
    assert!(parsed.is_array(), "list_spaces must return a JSON array");
}

#[tokio::test(flavor = "multi_thread")]
async fn unknown_tool_returns_is_error_envelope() {
    let resp = one_shot(json!({
        "jsonrpc": "2.0",
        "id": 9,
        "method": "tools/call",
        "params": {
            "name": "this_tool_does_not_exist",
            "arguments": {}
        },
    }))
    .await;
    assert_eq!(resp["id"], 9);
    let result = &resp["result"];
    assert_eq!(result["isError"], true);
    let text = result["content"][0]["text"]
        .as_str()
        .expect("error text must be string");
    assert!(
        text.contains("Unknown tool"),
        "error message must label the rejection: {text}"
    );
}

trait BoolNot {
    fn not(self) -> bool;
}
impl BoolNot for bool {
    fn not(self) -> bool {
        !self
    }
}
