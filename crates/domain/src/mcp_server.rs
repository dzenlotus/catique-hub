//! `McpServer` — registered external MCP server. Mirrors `mcp_servers`
//! table.
//!
//! ADR-0007 (registry-only mode). Catique HUB does not relay MCP
//! traffic — it only stores connection metadata so a calling agent
//! (Claude Code, Cursor, Qwen, …) can establish its own session with
//! the upstream server.
//!
//! Auth secrets never live in this struct: the `auth_json` field, when
//! `Some`, is the JSON encoding of either
//! `{"type":"keychain","key":"..."}` or `{"type":"env","key":"..."}` —
//! a *reference* to the secret, never the secret value itself. The
//! application layer enforces the shape on every write; see
//! `crates/application/src/mcp_servers.rs`.

use serde::{Deserialize, Serialize};
use ts_rs::TS;

/// Transport an upstream MCP server speaks.
///
/// The set is closed: extending it requires a paired schema migration
/// (the `mcp_servers.transport` CHECK constraint pins the wire values).
#[derive(TS, Serialize, Deserialize, Clone, Copy, Debug, PartialEq, Eq)]
#[ts(export, export_to = "../../../bindings/", rename_all = "lowercase")]
#[serde(rename_all = "lowercase")]
pub enum Transport {
    /// Local subprocess speaking JSON-RPC over stdio. The server is
    /// addressed by `command` (binary path + args), not `url`.
    Stdio,
    /// Remote endpoint speaking MCP over HTTP. Addressed by `url`.
    Http,
    /// Remote endpoint speaking MCP over Server-Sent Events. Addressed
    /// by `url`.
    Sse,
}

/// One row of the `mcp_servers` registry.
///
/// Field invariants (mirrored by the SQLite CHECK constraint at
/// `crates/infrastructure/src/db/migrations/013_mcp_servers.sql`):
///
/// * `transport == Transport::Stdio` ⇒ `command.is_some() &&
///   url.is_none()`
/// * `transport ∈ {Http, Sse}`       ⇒ `url.is_some() &&
///   command.is_none()`
///
/// `auth_json` is `None` for unauthenticated servers, otherwise the
/// JSON encoding of an auth-reference object. Raw tokens are
/// **never** stored here.
#[derive(TS, Serialize, Deserialize, Clone, Debug, PartialEq, Eq)]
#[ts(export, export_to = "../../../bindings/", rename_all = "camelCase")]
#[serde(rename_all = "camelCase")]
pub struct McpServer {
    pub id: String,
    pub name: String,
    pub transport: Transport,
    /// Endpoint URL for `http` / `sse` transports. `None` for `stdio`.
    pub url: Option<String>,
    /// Subprocess command line for `stdio` transport. `None` for
    /// `http` / `sse`.
    pub command: Option<String>,
    /// Auth-reference JSON (`{"type":"keychain"|"env","key":"..."}`)
    /// or `None` if the server requires no authentication. Raw tokens
    /// MUST NOT appear here — see module docs.
    pub auth_json: Option<String>,
    pub enabled: bool,
    pub created_at: i64,
    pub updated_at: i64,
}
