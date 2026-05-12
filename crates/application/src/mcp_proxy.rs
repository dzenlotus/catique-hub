//! MCP pass-through proxy use case.
//!
//! ADR-0008 / ctq-130 / PROXY-S3. When an external MCP client calls a
//! proxied tool against the Catique HUB sidecar, the Node side
//! dispatches via `ipc_call('proxy_tool_call', ...)` into [`crate::mcp_proxy::McpProxyUseCase::call`].
//! The use case:
//!
//!   1. Looks up the registered upstream MCP server; rejects if the
//!      server is `enabled = 0`.
//!   2. Opens an `mcp_call_log` row (in-flight).
//!   3. Delegates the wire call to an [`UpstreamCaller`] (in production
//!      this is the Node-side outbound client pool reached via
//!      `SidecarManager::call_upstream` — see PROXY-S2 / PROXY-S3
//!      Node-side work).
//!   4. Finalises the log row with the outcome.
//!   5. Returns the upstream payload to the caller, or maps a wire
//!      failure to a structured [`AppError`].
//!
//! ## Secrets
//!
//! The use case does NOT resolve credentials up-front. The Node side
//! issues `resolve_keychain` over the supervisor channel on demand
//! (per call), reads the value from this process, uses it once, and
//! does not cache. The secret never appears in `mcp_call_log.error`
//! or `tool_name` (caller-controlled fields).

use std::time::Duration;

use catique_infrastructure::db::{
    pool::{acquire, Pool},
    repositories::{
        mcp_call_log::{self as log_repo, CallOutcome},
        mcp_servers as servers_repo,
    },
};
use serde_json::Value;

use crate::{error::AppError, error_map::map_db_err};

/// Default upstream-call timeout. The sidecar wire-level call enforces
/// its own timeout via `call_ipc`; this constant is the application
/// layer's outer envelope.
pub const DEFAULT_UPSTREAM_TIMEOUT: Duration = Duration::from_secs(60);

/// Transport-side error from a single upstream call. Strings inside
/// must NOT contain a resolved secret — they end up in
/// `mcp_call_log.error` and (in stringified form) in `AppError`.
#[derive(Debug, thiserror::Error)]
pub enum UpstreamError {
    /// The wire layer failed before reaching the upstream (no Node
    /// sidecar running, write pipe error, etc.).
    #[error("transport: {0}")]
    Transport(String),
    /// The wire layer reached the upstream but the upstream replied
    /// with an `isError: true` content frame.
    #[error("upstream returned isError: {0}")]
    UpstreamIsError(String),
    /// Wall-clock timeout while awaiting the upstream's reply.
    #[error("upstream call timed out")]
    Timeout,
}

/// Abstraction over the wire that reaches the upstream MCP server.
///
/// The production implementation lives behind [`catique_sidecar::SidecarManager::call_upstream`]
/// and gets wrapped in an adapter by the API crate (which depends on
/// both `application` and `sidecar`). Tests use a hand-rolled stub.
///
/// The trait is invoked through a `&dyn UpstreamCaller` to keep the
/// use-case generic-free at the API surface. Rust 1.75+ native async
/// fn in traits is sufficient for our use; the trait is not
/// `dyn`-callable directly, so call sites take a concrete `&C`
/// implementing it.
pub trait UpstreamCaller: Send + Sync {
    fn call_upstream(
        &self,
        server_id: &str,
        tool_name: &str,
        args: Value,
    ) -> impl std::future::Future<Output = Result<Value, UpstreamError>> + Send;
}

/// MCP pass-through proxy use case.
pub struct McpProxyUseCase<'a, C: UpstreamCaller + ?Sized> {
    pool: &'a Pool,
    caller: &'a C,
}

impl<'a, C: UpstreamCaller + ?Sized> McpProxyUseCase<'a, C> {
    #[must_use]
    pub fn new(pool: &'a Pool, caller: &'a C) -> Self {
        Self { pool, caller }
    }

    /// Execute one proxied tool call. See module docs for the flow.
    ///
    /// # Errors
    ///
    /// * `AppError::NotFound` — `server_id` is not registered.
    /// * `AppError::BadRequest` — server exists but is disabled.
    /// * `AppError::Internal` — wire or upstream failure (with the
    ///   structured token surfaced via `mcp_call_log.error`).
    pub async fn call(
        &self,
        server_id: &str,
        tool_name: &str,
        args: Value,
    ) -> Result<Value, AppError> {
        // Step 1: lookup + enabled check.
        let conn = acquire(self.pool).map_err(map_db_err)?;
        let server = servers_repo::get_by_id(&conn, server_id)
            .map_err(map_db_err)?
            .ok_or_else(|| AppError::NotFound {
                entity: "mcp_server".into(),
                id: server_id.into(),
            })?;
        if !server.enabled {
            return Err(AppError::BadRequest {
                reason: format!("mcp_server `{server_id}` is disabled"),
            });
        }

        // Step 2: open in-flight log row.
        let log_id = log_repo::open_call(&conn, server_id, tool_name).map_err(map_db_err)?;
        // Release the connection before the await — we re-acquire for the
        // finalize step. Holding a r2d2 connection across an .await would
        // pin a pool slot for the duration of the upstream call.
        drop(conn);

        // Step 3: delegate to the wire.
        let outcome_in = serde_json::to_vec(&args).ok().map(|b| b.len() as i64);
        let wire_result = self.caller.call_upstream(server_id, tool_name, args).await;

        // Step 4: finalize log + map result.
        let conn = acquire(self.pool).map_err(map_db_err)?;
        match &wire_result {
            Ok(value) => {
                let outcome_out = serde_json::to_vec(value).ok().map(|b| b.len() as i64);
                let _ = log_repo::finalize_call(
                    &conn,
                    &log_id,
                    &CallOutcome {
                        success: true,
                        error: None,
                        bytes_in: outcome_in,
                        bytes_out: outcome_out,
                    },
                );
            }
            Err(err) => {
                let token = error_token(err);
                let _ = log_repo::finalize_call(
                    &conn,
                    &log_id,
                    &CallOutcome {
                        success: false,
                        error: Some(token.into()),
                        bytes_in: outcome_in,
                        bytes_out: None,
                    },
                );
            }
        }

        // Step 5: surface result. Wire failures become AppError::Upstream
        // with the short token (transport/isError/timeout) + full
        // message so callers can group on `kind` without losing detail.
        wire_result.map_err(|err| AppError::Upstream {
            kind: error_token(&err).into(),
            message: err.to_string(),
        })
    }
}

/// Map an [`UpstreamError`] to the short structured token that goes
/// into `mcp_call_log.error`. The set is closed by design — anything
/// new should appear here so the UI/dashboard can group on a stable
/// vocabulary.
fn error_token(err: &UpstreamError) -> &'static str {
    match err {
        UpstreamError::Transport(_) => "transport",
        UpstreamError::UpstreamIsError(_) => "isError",
        UpstreamError::Timeout => "timeout",
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use catique_infrastructure::db::pool::memory_pool_for_tests;
    use catique_infrastructure::db::repositories::mcp_servers::{
        insert as insert_server, McpServerDraft, TransportKind,
    };
    use catique_infrastructure::db::runner::run_pending;
    use std::sync::Mutex;

    fn fresh_pool() -> Pool {
        let pool = memory_pool_for_tests();
        {
            let mut conn = acquire(&pool).unwrap();
            run_pending(&mut conn).expect("migrations");
        }
        pool
    }

    fn seed_server(pool: &Pool, enabled: bool) -> String {
        let conn = acquire(pool).unwrap();
        let row = insert_server(
            &conn,
            &McpServerDraft {
                name: "atlassian".into(),
                transport: TransportKind::Http,
                url: Some("https://example.invalid/mcp".into()),
                command: None,
                auth_json: None,
                enabled,
            },
        )
        .unwrap();
        row.id
    }

    struct StubCaller {
        calls: Mutex<Vec<(String, String, Value)>>,
        result: Mutex<Result<Value, String>>,
    }

    impl StubCaller {
        fn ok(value: Value) -> Self {
            Self {
                calls: Mutex::new(Vec::new()),
                result: Mutex::new(Ok(value)),
            }
        }

        fn err(message: &str) -> Self {
            Self {
                calls: Mutex::new(Vec::new()),
                result: Mutex::new(Err(message.into())),
            }
        }
    }

    impl UpstreamCaller for StubCaller {
        async fn call_upstream(
            &self,
            server_id: &str,
            tool_name: &str,
            args: Value,
        ) -> Result<Value, UpstreamError> {
            self.calls
                .lock()
                .unwrap()
                .push((server_id.into(), tool_name.into(), args));
            match &*self.result.lock().unwrap() {
                Ok(v) => Ok(v.clone()),
                Err(msg) => Err(UpstreamError::Transport(msg.clone())),
            }
        }
    }

    #[tokio::test]
    async fn happy_path_returns_payload_and_logs_success() {
        let pool = fresh_pool();
        let server_id = seed_server(&pool, true);
        let caller = StubCaller::ok(serde_json::json!({"ok": true}));
        let uc = McpProxyUseCase::new(&pool, &caller);

        let value = uc
            .call(&server_id, "atlassian.create_issue", serde_json::json!({"title": "x"}))
            .await
            .unwrap();
        assert_eq!(value, serde_json::json!({"ok": true}));

        // Stub saw exactly one call with the qualified tool name.
        let calls = caller.calls.lock().unwrap();
        assert_eq!(calls.len(), 1);
        assert_eq!(calls[0].1, "atlassian.create_issue");

        // Log row is finalized with success=true.
        let conn = acquire(&pool).unwrap();
        let row = log_repo::latest_for_server(&conn, &server_id)
            .unwrap()
            .unwrap();
        assert_eq!(row.success, Some(true));
        assert!(row.finished_at.is_some());
    }

    #[tokio::test]
    async fn disabled_server_returns_bad_request_without_calling_upstream() {
        let pool = fresh_pool();
        let server_id = seed_server(&pool, false);
        let caller = StubCaller::ok(serde_json::json!({}));
        let uc = McpProxyUseCase::new(&pool, &caller);

        let err = uc
            .call(&server_id, "x", serde_json::json!({}))
            .await
            .expect_err("disabled");
        match err {
            AppError::BadRequest { reason } => {
                assert!(reason.contains("disabled"), "got reason: {reason}");
            }
            other => panic!("expected BadRequest, got {other:?}"),
        }
        assert!(caller.calls.lock().unwrap().is_empty());
    }

    #[tokio::test]
    async fn unknown_server_returns_not_found() {
        let pool = fresh_pool();
        let caller = StubCaller::ok(serde_json::json!({}));
        let uc = McpProxyUseCase::new(&pool, &caller);

        let err = uc.call("ghost", "x", serde_json::json!({})).await.expect_err("nf");
        assert!(matches!(err, AppError::NotFound { .. }));
    }

    #[tokio::test]
    async fn upstream_failure_finalises_log_with_token() {
        let pool = fresh_pool();
        let server_id = seed_server(&pool, true);
        let caller = StubCaller::err("pipe broke");
        let uc = McpProxyUseCase::new(&pool, &caller);

        let err = uc
            .call(&server_id, "x", serde_json::json!({}))
            .await
            .expect_err("upstream");
        match err {
            AppError::Upstream { kind, .. } => assert_eq!(kind, "transport"),
            other => panic!("expected Upstream, got {other:?}"),
        }

        let conn = acquire(&pool).unwrap();
        let row = log_repo::latest_for_server(&conn, &server_id)
            .unwrap()
            .unwrap();
        assert_eq!(row.success, Some(false));
        assert_eq!(row.error.as_deref(), Some("transport"));
    }
}
