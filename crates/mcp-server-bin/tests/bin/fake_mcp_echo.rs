//! Test-only fake upstream MCP server.
//!
//! Compiled as a separate `[[bin]]` so the integration test in
//! `tests/proxy_roundtrip.rs` can spawn it as a stdio upstream and
//! verify the standalone binary's pool aggregates + proxies its tools.
//!
//! Implements exactly what the round-trip test exercises:
//!
//!   * `initialize`               — returns a stub capabilities frame.
//!   * `notifications/initialized` — no-op.
//!   * `tools/list`               — one tool, `echo`.
//!   * `tools/call("echo", ...)`  — echoes the `message` arg back as
//!     `{content: [{type:"text", text: ...}]}`.
//!
//! Anything else gets a `method not found` reply.

use std::io::{BufRead, BufReader, Write};

#[allow(clippy::too_many_lines)]
fn main() {
    let stdin = std::io::stdin();
    let stdout = std::io::stdout();
    let mut reader = BufReader::new(stdin.lock());
    let mut out = stdout.lock();
    let mut buf = String::new();
    loop {
        buf.clear();
        let Ok(n) = reader.read_line(&mut buf) else {
            return;
        };
        if n == 0 {
            return;
        }
        let line = buf.trim();
        if line.is_empty() {
            continue;
        }
        let req: serde_json::Value = match serde_json::from_str(line) {
            Ok(v) => v,
            Err(_) => continue,
        };
        let id = req.get("id").cloned();
        let method = req
            .get("method")
            .and_then(|m| m.as_str())
            .unwrap_or("")
            .to_owned();

        let response = match method.as_str() {
            "initialize" => Some(serde_json::json!({
                "jsonrpc": "2.0",
                "id": id,
                "result": {
                    "protocolVersion": "2024-11-05",
                    "capabilities": { "tools": {} },
                    "serverInfo": { "name": "fake-mcp-echo", "version": "0.0.0" }
                }
            })),
            "notifications/initialized" => None,
            "tools/list" => Some(serde_json::json!({
                "jsonrpc": "2.0",
                "id": id,
                "result": {
                    "tools": [{
                        "name": "echo",
                        "description": "Echo back the message argument.",
                        "inputSchema": {
                            "type": "object",
                            "properties": { "message": { "type": "string" } },
                            "required": ["message"]
                        }
                    }]
                }
            })),
            "tools/call" => {
                let name = req
                    .pointer("/params/name")
                    .and_then(|v| v.as_str())
                    .unwrap_or("");
                let message = req
                    .pointer("/params/arguments/message")
                    .and_then(|v| v.as_str())
                    .unwrap_or("");
                if name == "echo" {
                    Some(serde_json::json!({
                        "jsonrpc": "2.0",
                        "id": id,
                        "result": {
                            "content": [{ "type": "text", "text": message }],
                            "isError": false
                        }
                    }))
                } else {
                    Some(serde_json::json!({
                        "jsonrpc": "2.0",
                        "id": id,
                        "error": { "code": -32601, "message": format!("unknown tool {name}") }
                    }))
                }
            }
            _ => {
                if id.is_some() {
                    Some(serde_json::json!({
                        "jsonrpc": "2.0",
                        "id": id,
                        "error": { "code": -32601, "message": format!("method not found: {method}") }
                    }))
                } else {
                    None
                }
            }
        };

        if let Some(frame) = response {
            let body = serde_json::to_string(&frame).expect("serialize");
            if writeln!(out, "{body}").is_err() {
                return;
            }
            if out.flush().is_err() {
                return;
            }
        }
    }
}
