//! JSON-RPC 2.0 wire types — shared between the server-facing stdio
//! transport ([`crate::upstream`] callers consume these too).
//!
//! Hand-rolled rather than pulling in `jsonrpsee` or `rmcp`:
//!
//!   * `rmcp` is the official Rust MCP SDK but uses a typed,
//!     manifest-bound tool surface — incompatible with our 147-arm
//!     dynamic dispatch + the dynamically-discovered upstream tools.
//!   * `jsonrpsee` is a full client/server framework with HTTP/WS/IPC
//!     transports and serde-derived method routing; far more surface
//!     than we need and would force the binary into its async-method
//!     dispatch model.
//!
//! The frame surface needed is intentionally small:
//!
//!   * Request  — `{jsonrpc:"2.0", id, method, params?}`. `id` may be
//!     a string, integer, or absent (notification).
//!   * Response — `{jsonrpc:"2.0", id, result | error}`.
//!   * Notification — same as request but `id` is absent (we never
//!     await a reply).
//!
//! Newline-delimited JSON: one frame per line on stdin/stdout. The
//! upstream HTTP/SSE transports re-wrap the same JSON in their own
//! envelope; the in-process Rust types are reused either way.

use serde::{Deserialize, Serialize};
use serde_json::Value;

/// JSON-RPC 2.0 marker. Kept as a constant so a future protocol bump
/// has a single change site.
pub const VERSION: &str = "2.0";

/// Standard error codes from the JSON-RPC 2.0 spec. The MCP layer
/// adds no new codes of its own; transport / upstream errors fold into
/// `INTERNAL_ERROR` with a descriptive `message`.
pub mod error_code {
    /// Invalid JSON was received by the server.
    pub const PARSE_ERROR: i64 = -32700;
    /// The JSON sent is not a valid Request object.
    pub const INVALID_REQUEST: i64 = -32600;
    /// The method does not exist / is not available.
    pub const METHOD_NOT_FOUND: i64 = -32601;
    /// Invalid method parameter(s).
    pub const INVALID_PARAMS: i64 = -32602;
    /// Internal JSON-RPC error.
    pub const INTERNAL_ERROR: i64 = -32603;
}

/// Wire request. `id` is opaque; we treat it as `Value` so callers
/// who send strings keep their string-typed id verbatim in the
/// response.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Request {
    pub jsonrpc: String,
    /// Absent for notifications.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub id: Option<Value>,
    pub method: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub params: Option<Value>,
}

/// Wire response. Exactly one of `result` / `error` is present; we
/// rely on `#[serde(skip_serializing_if = "Option::is_none")]` rather
/// than a discriminated enum because each side of the union needs the
/// full `id` field.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Response {
    pub jsonrpc: String,
    pub id: Value,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub result: Option<Value>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub error: Option<ErrorObject>,
}

/// Wire error body. `data` is a free-form extension slot — we currently
/// only emit `message`, but the field is kept on the deserializer side
/// so future protocol bumps don't break the parser.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ErrorObject {
    pub code: i64,
    pub message: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub data: Option<Value>,
}

impl Response {
    /// Build a success reply for `id`.
    #[must_use]
    pub fn ok(id: Value, result: Value) -> Self {
        Self {
            jsonrpc: VERSION.into(),
            id,
            result: Some(result),
            error: None,
        }
    }

    /// Build a failure reply for `id`.
    #[must_use]
    pub fn err(id: Value, code: i64, message: impl Into<String>) -> Self {
        Self {
            jsonrpc: VERSION.into(),
            id,
            result: None,
            error: Some(ErrorObject {
                code,
                message: message.into(),
                data: None,
            }),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn round_trip_request_serialization() {
        let req = Request {
            jsonrpc: VERSION.into(),
            id: Some(Value::from(7)),
            method: "tools/list".into(),
            params: None,
        };
        let s = serde_json::to_string(&req).unwrap();
        // `params: None` must be elided per JSON-RPC 2.0 — some clients
        // reject `"params": null` outright.
        assert!(!s.contains("\"params\""), "got: {s}");
        let back: Request = serde_json::from_str(&s).unwrap();
        assert_eq!(back.method, "tools/list");
    }

    #[test]
    fn response_success_does_not_carry_error_field() {
        let r = Response::ok(Value::from(1), serde_json::json!({"ok": true}));
        let s = serde_json::to_string(&r).unwrap();
        assert!(!s.contains("\"error\""), "got: {s}");
    }

    #[test]
    fn response_error_does_not_carry_result_field() {
        let r = Response::err(Value::from(1), error_code::METHOD_NOT_FOUND, "missing");
        let s = serde_json::to_string(&r).unwrap();
        assert!(!s.contains("\"result\""), "got: {s}");
        assert!(s.contains("missing"));
    }
}
