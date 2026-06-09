//! End-to-end round-trip tests for the single-endpoint `mcp_proxy_tool`
//! façade.
//!
//! Spawns the production [`catique-hub-mcp`] binary with a temp DB and
//! drives it via stdio. Asserts the new wire shape:
//!
//!   1. `tools/list` exposes exactly one tool (`mcp_proxy_tool`) with
//!      the documented `{ method, args }` input schema. No per-tool
//!      manifest leakage.
//!   2. `mcp_proxy_tool({ method: "{upstream}.echo", args: {message: ...} })`
//!      forwards to the upstream MCP server (`fake-mcp-echo` shim) and
//!      returns the upstream echo payload verbatim.
//!   3. `mcp_proxy_tool({ method: "list_spaces", args: {} })` dispatches
//!      through the native arm and returns a JSON array envelope.
//!   4. `mcp_proxy_tool({ method: "this_tool_does_not_exist", args: {} })`
//!      returns a tool-level `isError: true` envelope (no JSON-RPC
//!      error, no panic).
//!   5. Calling `tools/call` with `name != "mcp_proxy_tool"` returns a
//!      structured `isError` envelope that references `mcp_proxy_tool`
//!      and instructs the caller to route through it.
//!
//! Mirrors the manual handshake script the Node-era smoke test used.

use std::io::{BufRead, BufReader, Write};
use std::path::PathBuf;
use std::process::{Command, Stdio};
use std::time::Duration;

use catique_infrastructure::db::pool::acquire;
use catique_infrastructure::db::repositories::mcp_servers::{
    insert as insert_server, McpServerDraft, TransportKind,
};
use catique_infrastructure::db::runner::run_pending;

fn server_bin() -> PathBuf {
    PathBuf::from(env!("CARGO_BIN_EXE_catique-hub-mcp"))
}

fn fake_bin() -> PathBuf {
    PathBuf::from(env!("CARGO_BIN_EXE_fake-mcp-echo"))
}

/// Seed a temp DB with one enabled MCP server row pointing at the
/// `fake-mcp-echo` shim and return its row id. Migrations are run
/// once on the freshly-opened pool.
fn seed_db_with_fake_upstream(db_path: &std::path::Path, fake: &std::path::Path) -> String {
    let pool = catique_infrastructure::db::open_pool(db_path).expect("open db");
    {
        let mut conn = acquire(&pool).expect("acquire");
        run_pending(&mut conn).expect("migrations");
    }
    let conn = acquire(&pool).expect("acquire");
    let row = insert_server(
        &conn,
        &McpServerDraft {
            name: "echo-shim".into(),
            transport: TransportKind::Stdio,
            url: None,
            command: Some(fake.to_string_lossy().into_owned()),
            auth_json: None,
            enabled: true,
        },
    )
    .expect("insert server");
    row.id
}

/// Open a temp DB and run migrations without seeding any upstream
/// server. Used by the native-only sub-tests.
fn fresh_db(db_path: &std::path::Path) {
    let pool = catique_infrastructure::db::open_pool(db_path).expect("open db");
    let mut conn = acquire(&pool).expect("acquire");
    run_pending(&mut conn).expect("migrations");
}

/// Send one JSON-RPC frame on stdin and return the first response
/// whose `id` matches `request_id`. Notifications and unrelated frames
/// are skipped.
fn round_trip(
    stdin: &mut impl Write,
    stdout: &mut impl BufRead,
    frame: &serde_json::Value,
    request_id: i64,
) -> serde_json::Value {
    let body = serde_json::to_string(frame).expect("serialize");
    writeln!(stdin, "{body}").expect("write stdin");
    stdin.flush().expect("flush stdin");
    let mut buf = String::new();
    loop {
        buf.clear();
        let n = stdout.read_line(&mut buf).expect("read stdout");
        assert!(n > 0, "binary closed stdout before reply");
        let line = buf.trim();
        if line.is_empty() {
            continue;
        }
        let v: serde_json::Value = serde_json::from_str(line).expect("parse stdout");
        if v.get("id").and_then(serde_json::Value::as_i64) == Some(request_id) {
            return v;
        }
    }
}

/// Drive the initial handshake. Sends `initialize` + the matching
/// `notifications/initialized` notification.
fn handshake(stdin: &mut impl Write, stdout: &mut impl BufRead) {
    let init_reply = round_trip(
        stdin,
        stdout,
        &serde_json::json!({
            "jsonrpc": "2.0",
            "id": 1,
            "method": "initialize",
            "params": {
                "protocolVersion": "2024-11-05",
                "capabilities": {},
                "clientInfo": { "name": "harness", "version": "0.0" }
            }
        }),
        1,
    );
    assert!(
        init_reply.get("result").is_some(),
        "initialize reply missing result: {init_reply}"
    );
    let body = serde_json::to_string(&serde_json::json!({
        "jsonrpc": "2.0",
        "method": "notifications/initialized",
        "params": {}
    }))
    .unwrap();
    writeln!(stdin, "{body}").unwrap();
    stdin.flush().unwrap();
}

/// Spawn the production binary with `CATIQUE_HUB_MCP_DB` pointing at
/// `db_path`.
fn spawn_server(db_path: &std::path::Path) -> std::process::Child {
    Command::new(server_bin())
        .env("CATIQUE_HUB_MCP_DB", db_path)
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::inherit())
        .spawn()
        .expect("spawn standalone binary")
}

/// Pick a unique temp dir for a test run. Avoids pulling in `tempfile`
/// across crates because `TempDir`'s destructor would race with the
/// spawned child on Windows.
fn pick_tmp(tag: &str) -> PathBuf {
    let nanos = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map_or(0, |d| d.subsec_nanos());
    let tmp = std::env::temp_dir().join(format!("catique-mcp-{tag}-{nanos}"));
    std::fs::create_dir_all(&tmp).expect("create tmp");
    tmp
}

#[test]
fn tools_list_exposes_entity_tools_plus_proxy_facade() {
    let tmp = pick_tmp("toolslist");
    let db_path = tmp.join("db.sqlite");
    fresh_db(&db_path);

    let mut child = spawn_server(&db_path);
    let mut stdin = child.stdin.take().expect("stdin");
    let stdout = child.stdout.take().expect("stdout");
    let mut stdout = BufReader::new(stdout);

    handshake(&mut stdin, &mut stdout);

    let list_reply = round_trip(
        &mut stdin,
        &mut stdout,
        &serde_json::json!({
            "jsonrpc": "2.0",
            "id": 2,
            "method": "tools/list"
        }),
        2,
    );
    let tools = list_reply
        .pointer("/result/tools")
        .and_then(serde_json::Value::as_array)
        .cloned()
        .unwrap_or_default();
    // Post-consolidation: 18 entity-level tools (incl. catique-2
    // `project_file` + catique-1 `task_template`) + 2 cross-cutting
    // top-level tools + 1 `mcp_proxy_tool` façade = 21. The legacy flat
    // method names (`create_task`, `list_spaces`, …) remain callable via
    // `tools/call` for backward compat but are NOT advertised here.
    assert_eq!(
        tools.len(),
        21,
        "expected the 18 entity tools + 2 cross-cutting tools + proxy façade, got len={}",
        tools.len()
    );
    let names: Vec<&str> = tools
        .iter()
        .filter_map(|t| t.get("name").and_then(serde_json::Value::as_str))
        .collect();
    for entity in ["task", "role", "board", "space", "prompt", "setting"] {
        assert!(
            names.contains(&entity),
            "entity tool `{entity}` must be advertised in tools/list",
        );
    }
    assert!(
        names.contains(&"search_all"),
        "`search_all` must remain advertised as a top-level tool",
    );
    assert!(
        names.contains(&"mcp_proxy_tool"),
        "mcp_proxy_tool façade must be in tools/list",
    );
    // Legacy flat names must NOT be advertised — that's the point of
    // the consolidation.
    assert!(
        !names.contains(&"create_task"),
        "legacy flat name `create_task` must not be advertised — only `task` is",
    );
    assert!(
        !names.contains(&"list_spaces"),
        "legacy flat name `list_spaces` must not be advertised — only `space` is",
    );

    drop(stdin);
    child.wait_timeout_or_kill();
    let _ = std::fs::remove_dir_all(&tmp);
}

#[test]
#[allow(clippy::too_many_lines)]
fn proxy_tool_round_trips_upstream_call_verbatim() {
    let tmp = pick_tmp("upstream");
    let db_path = tmp.join("db.sqlite");

    let _server_id = seed_db_with_fake_upstream(&db_path, &fake_bin());

    let mut child = spawn_server(&db_path);
    let mut stdin = child.stdin.take().expect("stdin");
    let stdout = child.stdout.take().expect("stdout");
    let mut stdout = BufReader::new(stdout);

    handshake(&mut stdin, &mut stdout);

    // Calling `mcp_proxy_tool` with a dot-qualified `method` forwards
    // to the registered upstream MCP server and returns the upstream
    // echo payload verbatim.
    let call_reply = round_trip(
        &mut stdin,
        &mut stdout,
        &serde_json::json!({
            "jsonrpc": "2.0",
            "id": 3,
            "method": "tools/call",
            "params": {
                "name": "mcp_proxy_tool",
                "arguments": {
                    "method": "echo-shim.echo",
                    "args": { "message": "hi" }
                }
            }
        }),
        3,
    );
    let content = call_reply
        .pointer("/result/content")
        .and_then(serde_json::Value::as_array)
        .cloned()
        .unwrap_or_default();
    assert_eq!(content.len(), 1, "expected one content frame: {call_reply}");
    assert_eq!(
        content[0].get("text").and_then(serde_json::Value::as_str),
        Some("hi"),
        "echo did not return the message verbatim: {call_reply}"
    );
    assert_eq!(
        call_reply.pointer("/result/isError"),
        Some(&serde_json::Value::from(false)),
        "echo must not surface isError: {call_reply}"
    );

    drop(stdin);
    child.wait_timeout_or_kill();
    let _ = std::fs::remove_dir_all(&tmp);
}

#[test]
fn native_tool_called_directly_returns_spaces_array() {
    let tmp = pick_tmp("native");
    let db_path = tmp.join("db.sqlite");
    fresh_db(&db_path);

    let mut child = spawn_server(&db_path);
    let mut stdin = child.stdin.take().expect("stdin");
    let stdout = child.stdout.take().expect("stdout");
    let mut stdout = BufReader::new(stdout);

    handshake(&mut stdin, &mut stdout);

    // Native catique tools surface under their bare name and are
    // invoked directly — `mcp_proxy_tool` is only for upstream traffic.
    let call_reply = round_trip(
        &mut stdin,
        &mut stdout,
        &serde_json::json!({
            "jsonrpc": "2.0",
            "id": 4,
            "method": "tools/call",
            "params": {
                "name": "list_spaces",
                "arguments": {}
            }
        }),
        4,
    );
    // Native success envelopes omit `isError` (vs the upstream proxy
    // path which forwards the upstream's explicit `false`). Treat both
    // shapes as success.
    let is_error_flag = call_reply
        .pointer("/result/isError")
        .and_then(serde_json::Value::as_bool)
        .unwrap_or(false);
    assert!(
        !is_error_flag,
        "list_spaces must succeed on a fresh DB: {call_reply}"
    );
    let text = call_reply
        .pointer("/result/content/0/text")
        .and_then(serde_json::Value::as_str)
        .expect("content[0].text must be a string");
    let parsed: serde_json::Value = serde_json::from_str(text).expect("inner text must be JSON");
    assert!(
        parsed.is_array(),
        "list_spaces must return a JSON array, got: {text}"
    );

    drop(stdin);
    child.wait_timeout_or_kill();
    let _ = std::fs::remove_dir_all(&tmp);
}

#[test]
fn proxy_tool_with_bare_method_returns_redirect_error() {
    // Calling `mcp_proxy_tool` with a non-qualified `method` (i.e. no
    // dot — looks like a native tool name) must surface `isError: true`
    // and tell the agent to call the native tool directly.
    let tmp = pick_tmp("bare-method");
    let db_path = tmp.join("db.sqlite");
    fresh_db(&db_path);

    let mut child = spawn_server(&db_path);
    let mut stdin = child.stdin.take().expect("stdin");
    let stdout = child.stdout.take().expect("stdout");
    let mut stdout = BufReader::new(stdout);

    handshake(&mut stdin, &mut stdout);

    let call_reply = round_trip(
        &mut stdin,
        &mut stdout,
        &serde_json::json!({
            "jsonrpc": "2.0",
            "id": 5,
            "method": "tools/call",
            "params": {
                "name": "mcp_proxy_tool",
                "arguments": {
                    "method": "list_spaces",
                    "args": {}
                }
            }
        }),
        5,
    );
    assert!(
        call_reply.get("error").is_none(),
        "redirect must surface inside the content envelope: {call_reply}"
    );
    assert_eq!(
        call_reply.pointer("/result/isError"),
        Some(&serde_json::Value::from(true)),
        "bare-method proxy call must surface isError: true; got: {call_reply}"
    );
    let text = call_reply
        .pointer("/result/content/0/text")
        .and_then(serde_json::Value::as_str)
        .expect("content[0].text must be a string");
    assert!(
        text.contains("server.tool") || text.contains("qualified"),
        "redirect message must explain the `server.tool` shape; got: {text}"
    );

    drop(stdin);
    child.wait_timeout_or_kill();
    let _ = std::fs::remove_dir_all(&tmp);
}

#[test]
fn unknown_native_tool_returns_is_error() {
    let tmp = pick_tmp("unknown");
    let db_path = tmp.join("db.sqlite");
    fresh_db(&db_path);

    let mut child = spawn_server(&db_path);
    let mut stdin = child.stdin.take().expect("stdin");
    let stdout = child.stdout.take().expect("stdout");
    let mut stdout = BufReader::new(stdout);

    handshake(&mut stdin, &mut stdout);

    // Calling a non-existent tool name (no dot, not in manifest) must
    // surface `isError: true` with an instructional message.
    let call_reply = round_trip(
        &mut stdin,
        &mut stdout,
        &serde_json::json!({
            "jsonrpc": "2.0",
            "id": 6,
            "method": "tools/call",
            "params": {
                "name": "this_tool_does_not_exist",
                "arguments": {}
            }
        }),
        6,
    );
    assert!(
        call_reply.get("error").is_none(),
        "rejection must surface inside the content envelope, not as a JSON-RPC error: {call_reply}"
    );
    assert_eq!(
        call_reply.pointer("/result/isError"),
        Some(&serde_json::Value::from(true)),
        "unknown tool must surface isError: true; got: {call_reply}"
    );
    let text = call_reply
        .pointer("/result/content/0/text")
        .and_then(serde_json::Value::as_str)
        .expect("content[0].text must be a string");
    assert!(
        text.contains("Unknown tool"),
        "error message must label the rejection; got: {text}"
    );

    drop(stdin);
    child.wait_timeout_or_kill();
    let _ = std::fs::remove_dir_all(&tmp);
}

trait WaitTimeoutOrKill {
    fn wait_timeout_or_kill(&mut self);
}

impl WaitTimeoutOrKill for std::process::Child {
    fn wait_timeout_or_kill(&mut self) {
        // Poll for up to 5 s; SIGKILL if the binary hasn't exited.
        let deadline = std::time::Instant::now() + Duration::from_secs(5);
        while std::time::Instant::now() < deadline {
            match self.try_wait() {
                Ok(Some(_)) | Err(_) => return,
                Ok(None) => std::thread::sleep(Duration::from_millis(50)),
            }
        }
        let _ = self.kill();
        let _ = self.wait();
    }
}
