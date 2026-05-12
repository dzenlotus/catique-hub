//! MCP servers use case (ctq-115).
//!
//! Spec: ADR-0008 (pass-through proxy, supersedes ADR-0007). Catique
//! HUB owns the upstream connection AND the OS-keychain entry that
//! holds the upstream credential. The DB row stores only a reference;
//! the secret never lives in `auth_json`.
//!
//! ## Auth-reference shape guard
//!
//! `auth_json` MUST be either `None` (server is unauthenticated) or
//! the JSON encoding of an *auth reference*:
//!
//! ```json
//! {"type":"keychain","key":"catique.mcp.{server_id}"}
//! {"type":"env","key":"GITHUB_TOKEN"}
//! ```
//!
//! For `type == "keychain"` the `key` MUST equal exactly
//! `catique.mcp.{server_id}` — Catique owns the namespace. This stops
//! one server's `auth_json` from pointing at a different server's
//! secret. `type == "env"` stays as the escape hatch for users who
//! want to reuse a system env var; no namespace check applies there.
//!
//! Any other shape — including the most common foot-gun, an inline
//! `{"raw_token":"..."}` — is rejected at write time with
//! [`AppError::BadRequest`].

use catique_domain::{McpServer, Transport};
use catique_infrastructure::db::{
    pool::{acquire, Pool},
    repositories::{
        mcp_servers::{
            self as repo, McpServerDraft, McpServerPatch, McpServerRow, TransportKind,
        },
        pre_mint_id,
    },
};

use crate::{
    error::AppError,
    error_map::{map_db_err, map_db_err_unique, validate_non_empty},
};

/// MCP servers use case.
pub struct McpServersUseCase<'a> {
    pool: &'a Pool,
}

/// A non-resolving connection hint returned by
/// [`McpServersUseCase::get_connection_hint`].
///
/// The hint carries everything a calling agent needs to establish its
/// own session — the upstream URL or command line, the transport, and
/// (when present) the *reference* to the auth secret. The actual
/// secret value is NEVER resolved here: agents that support keychain
/// or env-var lookup do that themselves; agents that don't can surface
/// a clear error to the user.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ConnectionHint {
    pub id: String,
    pub name: String,
    pub transport: Transport,
    pub url: Option<String>,
    pub command: Option<String>,
    /// JSON encoding of the auth reference, or `None` when the server
    /// declares no authentication. Same string the row stores in
    /// `auth_json` — never the resolved secret.
    pub auth_ref_json: Option<String>,
}

impl<'a> McpServersUseCase<'a> {
    /// Constructor.
    #[must_use]
    pub fn new(pool: &'a Pool) -> Self {
        Self { pool }
    }

    /// List every registered MCP server, ordered by name.
    ///
    /// # Errors
    ///
    /// Forwards storage-layer errors.
    pub fn list(&self) -> Result<Vec<McpServer>, AppError> {
        let conn = acquire(self.pool).map_err(map_db_err)?;
        let rows = repo::list_all(&conn).map_err(map_db_err)?;
        Ok(rows.into_iter().map(row_to_server).collect())
    }

    /// List only the *enabled* registered MCP servers, ordered by name.
    ///
    /// Used by the sidecar MCP surface (ctq-126 — `list_mcp_servers`) so
    /// the calling agent never sees servers the user has temporarily
    /// disabled. Disabled rows still exist for `list` (settings UI) and
    /// `get` (direct lookup), but they are filtered out here.
    ///
    /// # Errors
    ///
    /// Forwards storage-layer errors.
    pub fn list_enabled(&self) -> Result<Vec<McpServer>, AppError> {
        let conn = acquire(self.pool).map_err(map_db_err)?;
        let rows = repo::list_by_enabled(&conn).map_err(map_db_err)?;
        Ok(rows.into_iter().map(row_to_server).collect())
    }

    /// Look up an MCP server by id.
    ///
    /// # Errors
    ///
    /// `AppError::NotFound` if missing.
    pub fn get(&self, id: &str) -> Result<McpServer, AppError> {
        let conn = acquire(self.pool).map_err(map_db_err)?;
        match repo::get_by_id(&conn, id).map_err(map_db_err)? {
            Some(row) => Ok(row_to_server(row)),
            None => Err(AppError::NotFound {
                entity: "mcp_server".into(),
                id: id.to_owned(),
            }),
        }
    }

    /// Build a non-resolving connection hint for a server.
    ///
    /// Returns the URL / command / transport / auth-reference shape
    /// without ever resolving the secret. Same payload the eventual
    /// MCP surface tool `get_mcp_server_connection_hint` (ctq-126)
    /// will expose to calling agents.
    ///
    /// # Errors
    ///
    /// `AppError::NotFound` if the id is unknown.
    pub fn get_connection_hint(&self, id: &str) -> Result<ConnectionHint, AppError> {
        let server = self.get(id)?;
        Ok(ConnectionHint {
            id: server.id,
            name: server.name,
            transport: server.transport,
            url: server.url,
            command: server.command,
            auth_ref_json: server.auth_json,
        })
    }

    /// Create an MCP server.
    ///
    /// Validation:
    ///
    /// * `name` must be non-empty after trimming.
    /// * If `transport == Stdio` then `command.is_some() && url.is_none()`,
    ///   otherwise `url.is_some() && command.is_none()`. Mismatch ⇒
    ///   [`AppError::BadRequest`].
    /// * `auth_json`, when `Some`, must be the JSON encoding of an auth
    ///   reference (allowlist — see module docs).
    ///
    /// # Errors
    ///
    /// `AppError::Validation` for empty name; `AppError::BadRequest`
    /// for transport/url/command mismatch or malformed `auth_json`.
    #[allow(clippy::needless_pass_by_value)]
    pub fn create(
        &self,
        name: String,
        transport: Transport,
        url: Option<String>,
        command: Option<String>,
        auth_json: Option<String>,
        enabled: bool,
    ) -> Result<McpServer, AppError> {
        let trimmed = validate_non_empty("name", &name)?;
        validate_url_command_split(transport, url.as_deref(), command.as_deref())?;
        // ADR-0008: validator needs the server id to enforce the
        // keychain namespace. Pre-mint the id, validate against it,
        // then INSERT with the same id.
        let server_id = pre_mint_id();
        if let Some(ref a) = auth_json {
            validate_auth_ref(a, &server_id)?;
        }
        let conn = acquire(self.pool).map_err(map_db_err)?;
        let row = repo::insert_with_id(
            &conn,
            &server_id,
            &McpServerDraft {
                name: trimmed,
                transport: transport_to_kind(transport),
                url,
                command,
                auth_json,
                enabled,
            },
        )
        .map_err(|e| map_db_err_unique(e, "mcp_server"))?;
        Ok(row_to_server(row))
    }

    /// Partial update of an MCP server.
    ///
    /// The post-update row must satisfy the transport/url/command
    /// invariant. Callers that flip `transport` MUST also pass the
    /// matching `url`/`command` adjustments in the same patch — the
    /// validator runs on the merged shape.
    ///
    /// # Errors
    ///
    /// `AppError::NotFound` if id missing; `AppError::Validation` /
    /// `AppError::BadRequest` for invalid fields.
    #[allow(clippy::needless_pass_by_value, clippy::too_many_arguments)]
    pub fn update(
        &self,
        id: String,
        name: Option<String>,
        transport: Option<Transport>,
        url: Option<Option<String>>,
        command: Option<Option<String>>,
        auth_json: Option<Option<String>>,
        enabled: Option<bool>,
    ) -> Result<McpServer, AppError> {
        if let Some(n) = name.as_deref() {
            validate_non_empty("name", n)?;
        }
        if let Some(Some(a)) = auth_json.as_ref() {
            validate_auth_ref(a, &id)?;
        }

        let conn = acquire(self.pool).map_err(map_db_err)?;

        // Fetch current row so we can validate the post-merge invariant
        // before sending the UPDATE.
        let current = repo::get_by_id(&conn, &id)
            .map_err(map_db_err)?
            .ok_or_else(|| AppError::NotFound {
                entity: "mcp_server".into(),
                id: id.clone(),
            })?;

        let next_transport = transport.unwrap_or(kind_to_transport(current.transport));
        let next_url: Option<String> = match &url {
            Some(v) => v.clone(),
            None => current.url.clone(),
        };
        let next_command: Option<String> = match &command {
            Some(v) => v.clone(),
            None => current.command.clone(),
        };
        validate_url_command_split(next_transport, next_url.as_deref(), next_command.as_deref())?;

        let patch = McpServerPatch {
            name: name.map(|n| n.trim().to_owned()),
            transport: transport.map(transport_to_kind),
            url,
            command,
            auth_json,
            enabled,
        };
        match repo::update(&conn, &id, &patch).map_err(|e| map_db_err_unique(e, "mcp_server"))? {
            Some(row) => Ok(row_to_server(row)),
            None => Err(AppError::NotFound {
                entity: "mcp_server".into(),
                id,
            }),
        }
    }

    /// Delete an MCP server. Cascades through `mcp_server_tools`.
    ///
    /// # Errors
    ///
    /// `AppError::NotFound` if id is unknown.
    pub fn delete(&self, id: &str) -> Result<(), AppError> {
        let conn = acquire(self.pool).map_err(map_db_err)?;
        let removed = repo::delete(&conn, id).map_err(map_db_err)?;
        if removed {
            Ok(())
        } else {
            Err(AppError::NotFound {
                entity: "mcp_server".into(),
                id: id.to_owned(),
            })
        }
    }
}

/// Build the canonical keychain key for a given server id. Single
/// source of truth so callers do not hand-format the string.
pub fn keychain_key_for(server_id: &str) -> String {
    format!("catique.mcp.{server_id}")
}

/// Allowlist validator for the `auth_json` reference shape, plus the
/// ADR-0008 namespace check for `type = keychain`. Returns
/// `AppError::BadRequest` for anything other than the two recognised
/// reference objects (see module docs).
fn validate_auth_ref(s: &str, server_id: &str) -> Result<(), AppError> {
    let value: serde_json::Value = serde_json::from_str(s).map_err(|e| AppError::BadRequest {
        reason: format!("auth_json must be valid JSON: {e}"),
    })?;
    let obj = value.as_object().ok_or_else(|| AppError::BadRequest {
        reason: "auth_json must be a JSON object".into(),
    })?;

    // Allowlist: exactly the keys `type` and `key`, where `type` is
    // one of the two literals and `key` is a non-empty string.
    if obj.len() != 2 || !obj.contains_key("type") || !obj.contains_key("key") {
        return Err(AppError::BadRequest {
            reason: "auth_json must contain exactly the keys `type` and `key`".into(),
        });
    }
    let type_val = obj["type"].as_str().ok_or_else(|| AppError::BadRequest {
        reason: "auth_json `type` must be a string".into(),
    })?;
    if type_val != "keychain" && type_val != "env" {
        return Err(AppError::BadRequest {
            reason: format!("auth_json `type` must be `keychain` or `env`, got `{type_val}`"),
        });
    }
    let key_val = obj["key"].as_str().ok_or_else(|| AppError::BadRequest {
        reason: "auth_json `key` must be a string".into(),
    })?;
    if key_val.is_empty() {
        return Err(AppError::BadRequest {
            reason: "auth_json `key` must be a non-empty string".into(),
        });
    }
    // ADR-0008 namespace check: keychain keys must point at the row's
    // own slot under Catique's namespace. `env` refs are exempt.
    if type_val == "keychain" {
        let expected = keychain_key_for(server_id);
        if key_val != expected {
            return Err(AppError::BadRequest {
                reason: format!(
                    "auth_json keychain `key` must equal `{expected}` (ADR-0008 namespace)"
                ),
            });
        }
    }
    Ok(())
}

/// Validate the transport/url/command invariant. Mirrors the SQLite
/// CHECK constraint, but emits a typed [`AppError::BadRequest`] instead
/// of letting the constraint violation bubble up as
/// `TransactionRolledBack`.
fn validate_url_command_split(
    transport: Transport,
    url: Option<&str>,
    command: Option<&str>,
) -> Result<(), AppError> {
    match transport {
        Transport::Stdio => {
            if command.is_none() {
                return Err(AppError::BadRequest {
                    reason: "stdio transport requires `command`".into(),
                });
            }
            if url.is_some() {
                return Err(AppError::BadRequest {
                    reason: "stdio transport must not carry `url`".into(),
                });
            }
        }
        Transport::Http | Transport::Sse => {
            if url.is_none() {
                return Err(AppError::BadRequest {
                    reason: "http/sse transports require `url`".into(),
                });
            }
            if command.is_some() {
                return Err(AppError::BadRequest {
                    reason: "http/sse transports must not carry `command`".into(),
                });
            }
        }
    }
    Ok(())
}

fn transport_to_kind(t: Transport) -> TransportKind {
    match t {
        Transport::Stdio => TransportKind::Stdio,
        Transport::Http => TransportKind::Http,
        Transport::Sse => TransportKind::Sse,
    }
}

fn kind_to_transport(k: TransportKind) -> Transport {
    match k {
        TransportKind::Stdio => Transport::Stdio,
        TransportKind::Http => Transport::Http,
        TransportKind::Sse => Transport::Sse,
    }
}

fn row_to_server(row: McpServerRow) -> McpServer {
    McpServer {
        id: row.id,
        name: row.name,
        transport: kind_to_transport(row.transport),
        url: row.url,
        command: row.command,
        auth_json: row.auth_json,
        enabled: row.enabled,
        created_at: row.created_at,
        updated_at: row.updated_at,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use catique_infrastructure::db::pool::memory_pool_for_tests;
    use catique_infrastructure::db::runner::run_pending;

    fn fresh_pool() -> Pool {
        let pool = memory_pool_for_tests();
        let mut conn = pool.get().unwrap();
        run_pending(&mut conn).unwrap();
        drop(conn);
        pool
    }

    #[test]
    fn create_stdio_round_trip() {
        let pool = fresh_pool();
        let uc = McpServersUseCase::new(&pool);
        let server = uc
            .create(
                "local-fs".into(),
                Transport::Stdio,
                None,
                Some("node sidecar.js".into()),
                None,
                true,
            )
            .unwrap();
        let got = uc.get(&server.id).unwrap();
        assert_eq!(got, server);
        assert_eq!(got.transport, Transport::Stdio);
        assert_eq!(got.command.as_deref(), Some("node sidecar.js"));
        assert!(got.url.is_none());
    }

    #[test]
    fn create_http_round_trip() {
        let pool = fresh_pool();
        let uc = McpServersUseCase::new(&pool);
        let server = uc
            .create(
                "github".into(),
                Transport::Http,
                Some("https://api.example.com/mcp".into()),
                None,
                None,
                true,
            )
            .unwrap();
        let got = uc.get(&server.id).unwrap();
        assert_eq!(got, server);
        assert_eq!(got.transport, Transport::Http);
        assert_eq!(got.url.as_deref(), Some("https://api.example.com/mcp"));
        assert!(got.command.is_none());
    }

    #[test]
    fn create_stdio_with_url_returns_bad_request() {
        let pool = fresh_pool();
        let uc = McpServersUseCase::new(&pool);
        match uc
            .create(
                "x".into(),
                Transport::Stdio,
                Some("https://nope".into()),
                Some("node sidecar.js".into()),
                None,
                true,
            )
            .expect_err("br")
        {
            AppError::BadRequest { reason } => {
                assert!(reason.contains("stdio"), "got reason: {reason}");
            }
            other => panic!("got {other:?}"),
        }
    }

    #[test]
    fn create_http_without_url_returns_bad_request() {
        let pool = fresh_pool();
        let uc = McpServersUseCase::new(&pool);
        match uc
            .create("x".into(), Transport::Http, None, None, None, true)
            .expect_err("br")
        {
            AppError::BadRequest { reason } => {
                assert!(reason.contains("require `url`"), "got reason: {reason}");
            }
            other => panic!("got {other:?}"),
        }
    }

    #[test]
    fn create_with_raw_token_in_auth_json_is_rejected() {
        let pool = fresh_pool();
        let uc = McpServersUseCase::new(&pool);
        match uc
            .create(
                "x".into(),
                Transport::Http,
                Some("https://api.example.com/mcp".into()),
                None,
                Some(r#"{"raw_token":"abc"}"#.into()),
                true,
            )
            .expect_err("br")
        {
            AppError::BadRequest { reason } => {
                assert!(reason.contains("`type` and `key`"), "got reason: {reason}");
            }
            other => panic!("got {other:?}"),
        }
    }

    #[test]
    fn create_with_wrong_namespace_keychain_ref_is_rejected() {
        // ADR-0008: keychain refs MUST point at `catique.mcp.{server_id}`.
        // The user-facing create() pre-mints the id internally, so the
        // caller cannot know it ahead of time — the keychain wire-up
        // (PROXY-S3) writes the secret to the right slot and assembles
        // auth_json from the same id. Any caller still trying to set
        // auth_json directly with a hand-chosen keychain key must fail
        // here so the rule is impossible to subvert.
        let pool = fresh_pool();
        let uc = McpServersUseCase::new(&pool);
        let err = uc
            .create(
                "github".into(),
                Transport::Http,
                Some("https://api.example.com/mcp".into()),
                None,
                Some(r#"{"type":"keychain","key":"my-personal-vault"}"#.into()),
                true,
            )
            .expect_err("namespace mismatch must be rejected");
        match err {
            AppError::BadRequest { reason } => {
                assert!(
                    reason.contains("catique.mcp."),
                    "error must explain the namespace, got: {reason}"
                );
            }
            other => panic!("expected BadRequest, got {other:?}"),
        }
    }

    #[test]
    fn validate_auth_ref_accepts_matching_namespace() {
        // Direct unit test on the validator — the integration-level
        // create() will exercise this same path once PROXY-S3 wires
        // keychain auth-input through the use-case.
        let server_id = "abc123";
        let raw = format!(r#"{{"type":"keychain","key":"catique.mcp.{server_id}"}}"#);
        assert!(super::validate_auth_ref(&raw, server_id).is_ok());
    }

    #[test]
    fn create_with_env_auth_ref_is_accepted() {
        let pool = fresh_pool();
        let uc = McpServersUseCase::new(&pool);
        let server = uc
            .create(
                "github".into(),
                Transport::Http,
                Some("https://api.example.com/mcp".into()),
                None,
                Some(r#"{"type":"env","key":"GITHUB_TOKEN"}"#.into()),
                true,
            )
            .unwrap();
        assert!(server.auth_json.is_some());
    }

    #[test]
    fn create_with_extra_auth_keys_is_rejected() {
        let pool = fresh_pool();
        let uc = McpServersUseCase::new(&pool);
        let err = uc
            .create(
                "x".into(),
                Transport::Http,
                Some("https://api.example.com/mcp".into()),
                None,
                Some(r#"{"type":"keychain","key":"k","secret":"oops"}"#.into()),
                true,
            )
            .expect_err("br");
        assert!(matches!(err, AppError::BadRequest { .. }));
    }

    #[test]
    fn create_with_unknown_auth_type_is_rejected() {
        let pool = fresh_pool();
        let uc = McpServersUseCase::new(&pool);
        let err = uc
            .create(
                "x".into(),
                Transport::Http,
                Some("https://api.example.com/mcp".into()),
                None,
                Some(r#"{"type":"vault","key":"k"}"#.into()),
                true,
            )
            .expect_err("br");
        assert!(matches!(err, AppError::BadRequest { .. }));
    }

    #[test]
    fn create_with_empty_name_returns_validation() {
        let pool = fresh_pool();
        let uc = McpServersUseCase::new(&pool);
        match uc
            .create(
                "  ".into(),
                Transport::Http,
                Some("https://api.example.com/mcp".into()),
                None,
                None,
                true,
            )
            .expect_err("v")
        {
            AppError::Validation { field, .. } => assert_eq!(field, "name"),
            other => panic!("got {other:?}"),
        }
    }

    #[test]
    fn get_returns_not_found_for_missing_id() {
        let pool = fresh_pool();
        let uc = McpServersUseCase::new(&pool);
        match uc.get("ghost").expect_err("nf") {
            AppError::NotFound { entity, .. } => assert_eq!(entity, "mcp_server"),
            other => panic!("got {other:?}"),
        }
    }

    #[test]
    fn delete_returns_not_found_for_missing_id() {
        let pool = fresh_pool();
        let uc = McpServersUseCase::new(&pool);
        match uc.delete("ghost").expect_err("nf") {
            AppError::NotFound { entity, .. } => assert_eq!(entity, "mcp_server"),
            other => panic!("got {other:?}"),
        }
    }

    #[test]
    fn update_partial_fields() {
        let pool = fresh_pool();
        let uc = McpServersUseCase::new(&pool);
        let server = uc
            .create(
                "github".into(),
                Transport::Http,
                Some("https://api.example.com/mcp".into()),
                None,
                None,
                true,
            )
            .unwrap();
        let updated = uc
            .update(
                server.id.clone(),
                Some("renamed".into()),
                None,
                None,
                None,
                None,
                Some(false),
            )
            .unwrap();
        assert_eq!(updated.name, "renamed");
        assert!(!updated.enabled);
    }

    #[test]
    fn update_transport_flip_requires_matching_url_and_command() {
        let pool = fresh_pool();
        let uc = McpServersUseCase::new(&pool);
        let server = uc
            .create(
                "github".into(),
                Transport::Http,
                Some("https://api.example.com/mcp".into()),
                None,
                None,
                true,
            )
            .unwrap();
        // Flipping to stdio without supplying a command MUST be rejected.
        let err = uc
            .update(
                server.id.clone(),
                None,
                Some(Transport::Stdio),
                None,
                None,
                None,
                None,
            )
            .expect_err("br");
        assert!(matches!(err, AppError::BadRequest { .. }));
    }

    #[test]
    fn update_with_invalid_auth_json_returns_bad_request() {
        let pool = fresh_pool();
        let uc = McpServersUseCase::new(&pool);
        let server = uc
            .create(
                "github".into(),
                Transport::Http,
                Some("https://api.example.com/mcp".into()),
                None,
                None,
                true,
            )
            .unwrap();
        let err = uc
            .update(
                server.id,
                None,
                None,
                None,
                None,
                Some(Some(r#"{"raw_token":"abc"}"#.into())),
                None,
            )
            .expect_err("br");
        assert!(matches!(err, AppError::BadRequest { .. }));
    }

    #[test]
    fn get_connection_hint_returns_metadata_only() {
        // Server created without auth_json (the keychain-ref happy path
        // moved to a direct validator test under ADR-0008 — the
        // public create() no longer lets the caller hand-pick the
        // keychain key). Hint must still surface metadata.
        let pool = fresh_pool();
        let uc = McpServersUseCase::new(&pool);
        let server = uc
            .create(
                "github".into(),
                Transport::Http,
                Some("https://api.example.com/mcp".into()),
                None,
                None,
                true,
            )
            .unwrap();
        let hint = uc.get_connection_hint(&server.id).unwrap();
        assert_eq!(hint.id, server.id);
        assert_eq!(hint.transport, Transport::Http);
        assert_eq!(hint.url.as_deref(), Some("https://api.example.com/mcp"));
        assert!(hint.command.is_none());
        assert!(hint.auth_ref_json.is_none());
    }

    #[test]
    fn list_returns_created_servers() {
        let pool = fresh_pool();
        let uc = McpServersUseCase::new(&pool);
        uc.create(
            "github".into(),
            Transport::Http,
            Some("https://a".into()),
            None,
            None,
            true,
        )
        .unwrap();
        uc.create(
            "fs".into(),
            Transport::Stdio,
            None,
            Some("node sidecar.js".into()),
            None,
            true,
        )
        .unwrap();
        let list = uc.list().unwrap();
        assert_eq!(list.len(), 2);
    }

    #[test]
    fn list_enabled_filters_out_disabled_servers() {
        // ctq-126 contract: the sidecar MCP surface only exposes
        // *enabled* servers to the calling agent. Disabled rows must
        // never reach `list_mcp_servers` / `get_mcp_server_connection_hint`
        // consumers — this test pins that filter at the use-case layer.
        let pool = fresh_pool();
        let uc = McpServersUseCase::new(&pool);
        uc.create(
            "alpha-on".into(),
            Transport::Http,
            Some("https://alpha.example.com/mcp".into()),
            None,
            None,
            true,
        )
        .unwrap();
        uc.create(
            "zeta-off".into(),
            Transport::Http,
            Some("https://zeta.example.com/mcp".into()),
            None,
            None,
            false,
        )
        .unwrap();

        let all = uc.list().unwrap();
        assert_eq!(all.len(), 2, "list() returns enabled + disabled");

        let enabled_only = uc.list_enabled().unwrap();
        assert_eq!(enabled_only.len(), 1);
        assert_eq!(enabled_only[0].name, "alpha-on");
        assert!(enabled_only[0].enabled);
    }
}
