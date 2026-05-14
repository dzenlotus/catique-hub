//! `McpCallLog` — observability row for one proxied tool call.
//!
//! ADR-0008 / ctq-128 / PROXY-S1. The full retention policy + field
//! semantics live in migration `024_mcp_call_log.sql` (seven-day
//! rolling window, in-flight row gets `success = NULL` until completion).

use serde::{Deserialize, Serialize};
use ts_rs::TS;

/// One proxied tool-call invocation. Backs the per-server health dot
/// (most recent row decides), the future per-server failure counter,
/// and any forthcoming cost/quota dashboard.
#[derive(TS, Serialize, Deserialize, Clone, Debug, PartialEq, Eq)]
#[ts(export, export_to = "../../../bindings/", rename_all = "camelCase")]
#[serde(rename_all = "camelCase")]
pub struct McpCallLog {
    pub id: String,
    pub server_id: String,
    pub tool_name: String,
    pub started_at: i64,
    /// `None` while the call is in flight. Set on completion.
    pub finished_at: Option<i64>,
    /// `None` in flight; `Some(true)` on success; `Some(false)` on any
    /// error path (transport, `isError: true`, keychain resolve, …).
    pub success: Option<bool>,
    /// Short structured token (`upstream_timeout`, `keychain_missing`,
    /// `isError`, …). MUST NOT contain a resolved secret or arbitrary
    /// upstream-supplied content.
    pub error: Option<String>,
    pub bytes_in: Option<i64>,
    pub bytes_out: Option<i64>,
}
