//! Library face of the standalone Catique HUB MCP server binary.
//!
//! W1 rewrite of the Node sidecar pass-through proxy. The Node module
//! `sidecar/upstream-clients.js` is replaced by [`upstream`]; the
//! JSON-RPC framing for both the server-facing stdio surface and the
//! client-facing upstream connections lives in [`jsonrpc`].
//!
//! The `main.rs` binary composes these on top of a fresh DB pool opened
//! at [`catique_infrastructure::paths::db_path`] and exposes a
//! single-endpoint `mcp_proxy_tool` façade — `tools/list` returns
//! exactly one tool, and `tools/call` routes every catique-native +
//! upstream call through the same entry. The per-role list of legal
//! `method` strings is documented in the agent file body (rendered as
//! `<mcp-tool>` blocks by `catique_clients::adapters::common`).
//!
//! ## Why a separate binary?
//!
//! External MCP clients (Claude Desktop, Claude Code, Codex) launch the
//! server directly per their own config files — there is no parent
//! Tauri process, no supervisor channel, no `ipc_call`. The binary
//! therefore owns its own DB pool and its own upstream client pool.
//! SQLite WAL handles the concurrent-reader case if the Tauri UI is
//! also running against the same DB file.

pub mod jsonrpc;
pub mod upstream;
