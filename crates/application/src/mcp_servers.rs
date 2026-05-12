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

use catique_domain::{McpServer, McpTool, McpToolSource, Transport};
use catique_infrastructure::db::{
    pool::{acquire, Pool},
    repositories::{
        mcp_call_log as call_log_repo,
        mcp_servers::{
            self as repo, McpServerDraft, McpServerPatch, McpServerRow, TransportKind,
        },
        mcp_tools as tools_repo,
        pre_mint_id,
    },
};
use serde::Serialize;
use serde_json::Value;
use ts_rs::TS;

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

/// Server metadata embedded into each [`ProxiedTool`] entry. Lets the
/// Node side derive its `serversById` map in one pass over the
/// `list_proxied_tools` reply (no extra round-trip).
#[derive(TS, Serialize, Clone, Debug, PartialEq, Eq)]
#[ts(export, export_to = "../../../bindings/", rename_all = "camelCase")]
#[serde(rename_all = "camelCase")]
pub struct ProxiedServerMeta {
    pub id: String,
    pub name: String,
    pub transport: Transport,
    pub url: Option<String>,
    pub command: Option<String>,
}

/// One row of the proxied-tools registry the Node sidecar consumes at
/// startup (`list_proxied_tools` over the supervisor channel).
///
/// `qualified_name` is `{server_name}.{upstream_name}` and what the
/// external MCP client sees in `tools/list`. `input_schema` ships as
/// a JSON-string here (the upstream's `inputSchema` field is opaque
/// to us); the Node side hands it back unchanged.
#[derive(TS, Serialize, Clone, Debug, PartialEq)]
#[ts(export, export_to = "../../../bindings/", rename_all = "camelCase")]
#[serde(rename_all = "camelCase")]
pub struct ProxiedTool {
    pub qualified_name: String,
    pub server_id: String,
    pub upstream_name: String,
    /// JSON Schema for the tool args, as the upstream MCP server
    /// advertised it. Opaque to us; the Node side passes it through
    /// to the external agent verbatim.
    #[ts(type = "Record<string, unknown>")]
    pub input_schema: Value,
    pub description: Option<String>,
    pub server: ProxiedServerMeta,
}

/// Live health-and-counts read returned by
/// [`McpServersUseCase::status`]. Backs the green/red dot in the MCP
/// server group view (PROXY-S6).
#[derive(TS, Serialize, Clone, Debug, PartialEq, Eq)]
#[ts(export, export_to = "../../../bindings/", rename_all = "camelCase")]
#[serde(rename_all = "camelCase")]
pub struct McpServerStatus {
    pub server_id: String,
    pub state: McpServerHealthState,
    /// Max `mcp_tools.last_synced_at` for upstream tools belonging to
    /// this server. `None` means "never introspected" (the server row
    /// exists but no `tools/list` has ever completed).
    pub last_synced_at: Option<i64>,
    /// Count of live upstream tools (source = upstream AND
    /// last_synced_at IS NOT NULL).
    pub tool_count: i64,
    /// `started_at` of the most recent `mcp_call_log` row for this
    /// server. `None` means "never called".
    pub last_call_started_at: Option<i64>,
    /// Outcome of that last call. `None` if `last_call_started_at` is
    /// `None`; `Some(true)` for success; `Some(false)` for any error
    /// path.
    pub last_call_success: Option<bool>,
}

/// Coarse-grained health state. Round-1 derives `Unreachable` purely
/// from "no upstream tools ever materialised". Round-2 (when
/// introspection lands in PROXY-S4 round 2) tightens it with last-call
/// outcome + per-server failure counter for `Degraded`.
#[derive(TS, Serialize, Clone, Copy, Debug, PartialEq, Eq)]
#[ts(export, export_to = "../../../bindings/", rename_all = "lowercase")]
#[serde(rename_all = "lowercase")]
pub enum McpServerHealthState {
    /// At least one upstream tool was successfully introspected AND
    /// the most recent call (if any) succeeded.
    Healthy,
    /// Most recent call failed; tool inventory may still be present.
    Degraded,
    /// No upstream tool has ever materialised against this server,
    /// OR the server is disabled.
    Unreachable,
}

/// One tool declaration the upstream MCP server advertised in its
/// `tools/list` response. Plumbed across the supervisor channel; the
/// application layer persists rows into `mcp_tools`.
#[derive(Debug, Clone, serde::Deserialize, PartialEq)]
pub struct UpstreamToolDecl {
    pub name: String,
    pub description: Option<String>,
    /// JSON-encoded `inputSchema` — opaque to us; persisted into
    /// `mcp_tools.schema_json` and rendered back to the external
    /// agent verbatim on `tools/list`.
    pub input_schema: serde_json::Value,
}

/// Result of one `introspect_and_persist` / `refresh` run. Backs the
/// "what changed?" toast / log entry the UI will surface after the
/// user clicks "Refresh".
#[derive(TS, Serialize, Clone, Debug, Default, PartialEq, Eq)]
#[ts(export, export_to = "../../../bindings/", rename_all = "camelCase")]
#[serde(rename_all = "camelCase")]
pub struct RefreshReport {
    /// Tool names that were not in the previous inventory.
    pub added: i64,
    /// Tools whose schema_json differs from the previous inventory.
    pub schema_changed: i64,
    /// Tools whose schema is identical; `last_synced_at` was bumped.
    pub still_present: i64,
    /// Tools that were in the previous inventory but missing in the
    /// fresh `tools/list` — soft-deleted (`last_synced_at` cleared).
    pub soft_deleted: i64,
}

/// Wire transport for one server's connection metadata. The
/// `SidecarUpstream` adapter passes this inline so the Node side
/// can open or reuse the upstream client without a round-trip back
/// to Rust for the server row.
#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
pub struct ServerWireMeta {
    pub id: String,
    pub name: String,
    pub transport: Transport,
    pub url: Option<String>,
    pub command: Option<String>,
}

/// Abstraction over the wire that fetches an upstream server's
/// `tools/list`. The production implementation lives in
/// `crates/api/src/mcp_bridge/mod.rs` (paired with the
/// `UpstreamCaller` impl).
pub trait UpstreamIntrospector: Send + Sync {
    fn list_tools(
        &self,
        meta: &ServerWireMeta,
    ) -> impl std::future::Future<Output = Result<Vec<UpstreamToolDecl>, crate::mcp_proxy::UpstreamError>>
           + Send;
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

    /// Materialise the proxied-tools registry the Node sidecar
    /// consumes at startup. PROXY-S4 round 1.
    ///
    /// Rows that satisfy ALL of:
    ///   * `mcp_servers.enabled = 1`
    ///   * `mcp_tools.source    = 'upstream'`
    ///   * `mcp_tools.last_synced_at IS NOT NULL` (excludes
    ///     soft-deleted-after-refresh rows)
    /// are mapped to one [`ProxiedTool`]. `qualified_name` is built
    /// from `{server.name}.{tool.upstream_name}`; `input_schema` is
    /// parsed back from the stored JSON string (defensive against a
    /// row that smuggled in malformed JSON — those entries are
    /// skipped with a log line, not propagated as errors, so one
    /// bad row cannot break the whole registry).
    ///
    /// # Errors
    ///
    /// Forwards DB errors.
    pub fn list_proxied_tools(&self) -> Result<Vec<ProxiedTool>, AppError> {
        let conn = acquire(self.pool).map_err(map_db_err)?;
        let mut stmt = conn
            .prepare(
                "SELECT s.id           AS server_id, \
                        s.name         AS server_name, \
                        s.transport    AS server_transport, \
                        s.url          AS server_url, \
                        s.command      AS server_command, \
                        t.name         AS tool_name, \
                        t.description  AS tool_description, \
                        t.schema_json  AS tool_schema_json, \
                        t.upstream_name AS tool_upstream_name \
                 FROM mcp_servers s \
                 JOIN mcp_tools t ON t.server_id = s.id \
                 WHERE s.enabled = 1 \
                   AND t.source = 'upstream' \
                   AND t.last_synced_at IS NOT NULL \
                 ORDER BY s.name, t.upstream_name",
            )
            .map_err(|e| map_db_err(e.into()))?;
        let rows = stmt
            .query_map([], |row| {
                let server_id: String = row.get("server_id")?;
                let server_name: String = row.get("server_name")?;
                let transport_text: String = row.get("server_transport")?;
                let url: Option<String> = row.get("server_url")?;
                let command: Option<String> = row.get("server_command")?;
                let tool_name: Option<String> = row.get("tool_name")?;
                let description: Option<String> = row.get("tool_description")?;
                let schema_json: String = row.get("tool_schema_json")?;
                let upstream_name: Option<String> = row.get("tool_upstream_name")?;
                Ok((
                    server_id,
                    server_name,
                    transport_text,
                    url,
                    command,
                    tool_name,
                    description,
                    schema_json,
                    upstream_name,
                ))
            })
            .map_err(|e| map_db_err(e.into()))?;

        let mut out = Vec::new();
        for r in rows {
            let (
                server_id,
                server_name,
                transport_text,
                url,
                command,
                tool_name,
                description,
                schema_json,
                upstream_name,
            ) = r.map_err(|e| map_db_err(e.into()))?;
            // `upstream_name` is the wire-side name; fall back to
            // `tool_name` for legacy rows that pre-date migration 023.
            // The qualified form uses the explicit upstream name so
            // refreshes stay stable across local renames.
            let upstream = match upstream_name.clone().or(tool_name.clone()) {
                Some(n) => n,
                None => continue,
            };
            let transport = match transport_text.as_str() {
                "stdio" => Transport::Stdio,
                "http" => Transport::Http,
                "sse" => Transport::Sse,
                _ => continue, // schema CHECK catches this; defensive
            };
            let input_schema: Value = match serde_json::from_str(&schema_json) {
                Ok(v) => v,
                Err(_) => {
                    // Malformed schema row: skip rather than poison
                    // the whole registry. PROXY-S4 round 2 will
                    // surface this in the refresh report.
                    continue;
                }
            };
            out.push(ProxiedTool {
                qualified_name: format!("{server_name}.{upstream}"),
                server_id: server_id.clone(),
                upstream_name: upstream,
                input_schema,
                description,
                server: ProxiedServerMeta {
                    id: server_id,
                    name: server_name,
                    transport,
                    url,
                    command,
                },
            });
        }
        Ok(out)
    }

    /// Run `tools/list` against the upstream server, reconcile the
    /// result against the `mcp_tools` table, return a
    /// [`RefreshReport`] summarising what changed.
    ///
    /// Reconciliation rules (closed):
    /// * Upstream tool name not in DB → INSERT (source = upstream,
    ///   last_synced_at = now).
    /// * Upstream tool name in DB, schema_json different →
    ///   UPDATE schema_json + last_synced_at + description. Counts as
    ///   `schema_changed`.
    /// * Upstream tool name in DB, schema_json identical → UPDATE
    ///   last_synced_at + description only. Counts as `still_present`.
    /// * DB row (source = upstream) whose upstream_name is NOT in the
    ///   fresh list → UPDATE last_synced_at = NULL (soft-delete).
    ///
    /// Failure of the upstream call does NOT roll back any state.
    /// The caller decides whether to surface the error (refresh:
    /// surface) or swallow it (create-time best-effort).
    ///
    /// ADR-0008 / PROXY-S4 round 2.
    ///
    /// # Errors
    ///
    /// `AppError::NotFound` if the server id is unknown; otherwise
    /// `AppError::Upstream` carrying the introspector's failure;
    /// `AppError::TransactionRolledBack` if the DB write fails.
    pub async fn introspect_and_persist<I: UpstreamIntrospector>(
        &self,
        server_id: &str,
        introspector: &I,
    ) -> Result<RefreshReport, AppError> {
        let meta = {
            let conn = acquire(self.pool).map_err(map_db_err)?;
            let server = repo::get_by_id(&conn, server_id)
                .map_err(map_db_err)?
                .ok_or_else(|| AppError::NotFound {
                    entity: "mcp_server".into(),
                    id: server_id.to_owned(),
                })?;
            ServerWireMeta {
                id: server.id.clone(),
                name: server.name.clone(),
                transport: kind_to_transport(server.transport),
                url: server.url.clone(),
                command: server.command.clone(),
            }
        };
        // Wire call — async, no DB connection held.
        let upstream_tools = introspector
            .list_tools(&meta)
            .await
            .map_err(|err| AppError::Upstream {
                kind: match err {
                    crate::mcp_proxy::UpstreamError::Transport(_) => "transport".into(),
                    crate::mcp_proxy::UpstreamError::UpstreamIsError(_) => "isError".into(),
                    crate::mcp_proxy::UpstreamError::Timeout => "timeout".into(),
                },
                message: err.to_string(),
            })?;
        // Reconcile in a fresh connection. Persistence is best-effort
        // per-row to keep one bad tool from blocking the rest.
        let conn = acquire(self.pool).map_err(map_db_err)?;
        reconcile_tools(&conn, server_id, &upstream_tools)
    }

    /// Public alias around [`Self::introspect_and_persist`]. Provided
    /// because the UI's user-facing affordance is labelled "Refresh".
    pub async fn refresh<I: UpstreamIntrospector>(
        &self,
        server_id: &str,
        introspector: &I,
    ) -> Result<RefreshReport, AppError> {
        self.introspect_and_persist(server_id, introspector).await
    }

    /// List the `mcp_tools` rows linked to one MCP server, ordered by
    /// `position ASC, name ASC`. Returns both `Upstream` and any
    /// `Manual` rows tagged with this server id. Soft-deleted upstream
    /// rows (`last_synced_at IS NULL`) are returned so the UI can
    /// strike them through; new attachments should filter them out.
    ///
    /// ADR-0008 / PROXY-S4 round 1.
    ///
    /// # Errors
    ///
    /// `AppError::NotFound` when the server id is unknown.
    pub fn list_tools_by_server(&self, server_id: &str) -> Result<Vec<McpTool>, AppError> {
        let conn = acquire(self.pool).map_err(map_db_err)?;
        let exists = repo::get_by_id(&conn, server_id)
            .map_err(map_db_err)?
            .is_some();
        if !exists {
            return Err(AppError::NotFound {
                entity: "mcp_server".into(),
                id: server_id.to_owned(),
            });
        }
        let rows = tools_repo::list_for_server(&conn, server_id).map_err(map_db_err)?;
        Ok(rows.into_iter().map(row_to_mcp_tool).collect())
    }

    /// Live status read for one MCP server. Backs the green/red dot in
    /// the UI (PROXY-S6). Round-1 derivation:
    ///
    ///   * `Unreachable` if the server is disabled OR no upstream
    ///     tool ever materialised (`tool_count == 0`).
    ///   * `Degraded` if the most recent call failed.
    ///   * `Healthy` otherwise.
    ///
    /// # Errors
    ///
    /// `AppError::NotFound` if the server id is unknown.
    pub fn status(&self, server_id: &str) -> Result<McpServerStatus, AppError> {
        let conn = acquire(self.pool).map_err(map_db_err)?;
        let server = repo::get_by_id(&conn, server_id)
            .map_err(map_db_err)?
            .ok_or_else(|| AppError::NotFound {
                entity: "mcp_server".into(),
                id: server_id.to_owned(),
            })?;

        // tool_count + last_synced_at in one row.
        let (tool_count, last_synced_at): (i64, Option<i64>) = conn
            .query_row(
                "SELECT COUNT(*) AS n, MAX(last_synced_at) AS ts \
                 FROM mcp_tools \
                 WHERE server_id = ?1 \
                   AND source = 'upstream' \
                   AND last_synced_at IS NOT NULL",
                rusqlite::params![server_id],
                |row| Ok((row.get::<_, i64>("n")?, row.get::<_, Option<i64>>("ts")?)),
            )
            .map_err(|e| map_db_err(e.into()))?;

        let last_call = call_log_repo::latest_for_server(&conn, server_id).map_err(map_db_err)?;

        let state = if !server.enabled || tool_count == 0 {
            McpServerHealthState::Unreachable
        } else if matches!(last_call.as_ref().and_then(|c| c.success), Some(false)) {
            McpServerHealthState::Degraded
        } else {
            McpServerHealthState::Healthy
        };

        Ok(McpServerStatus {
            server_id: server_id.to_owned(),
            state,
            last_synced_at,
            tool_count,
            last_call_started_at: last_call.as_ref().map(|c| c.started_at),
            last_call_success: last_call.as_ref().and_then(|c| c.success),
        })
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

/// Reconcile a fresh `tools/list` against the persisted inventory for
/// `server_id`. See [`McpServersUseCase::introspect_and_persist`] for
/// the rule set; this is the private worker that operates on a
/// borrowed connection.
fn reconcile_tools(
    conn: &rusqlite::Connection,
    server_id: &str,
    upstream_tools: &[UpstreamToolDecl],
) -> Result<RefreshReport, AppError> {
    use std::collections::HashMap;

    // Existing upstream rows for this server, by upstream_name.
    let existing = tools_repo::list_for_server(conn, server_id).map_err(map_db_err)?;
    let mut existing_by_upstream: HashMap<String, tools_repo::McpToolRow> = HashMap::new();
    for row in existing {
        if matches!(row.source, tools_repo::McpToolSourceRow::Upstream) {
            if let Some(name) = row.upstream_name.clone() {
                existing_by_upstream.insert(name, row);
            }
        }
    }

    let mut report = RefreshReport::default();
    let mut seen_upstream_names: std::collections::HashSet<String> = std::collections::HashSet::new();

    for decl in upstream_tools {
        let schema_str = serde_json::to_string(&decl.input_schema).unwrap_or_else(|_| "{}".into());
        seen_upstream_names.insert(decl.name.clone());

        match existing_by_upstream.get(&decl.name) {
            Some(row) => {
                let same_schema = row.schema_json == schema_str;
                let updated = tools_repo::mark_upstream_synced(
                    conn,
                    &row.id,
                    decl.description.as_deref(),
                    &schema_str,
                    now_millis(),
                )
                .map_err(map_db_err)?;
                if updated {
                    if same_schema {
                        report.still_present += 1;
                    } else {
                        report.schema_changed += 1;
                    }
                }
            }
            None => {
                let draft = tools_repo::McpToolDraft {
                    name: decl.name.clone(),
                    description: decl.description.clone(),
                    schema_json: schema_str,
                    color: None,
                    position: 0.0,
                    server_id: Some(server_id.to_owned()),
                    upstream_name: Some(decl.name.clone()),
                    source: tools_repo::McpToolSourceRow::Upstream,
                    last_synced_at: Some(now_millis()),
                };
                tools_repo::insert(conn, &draft).map_err(map_db_err)?;
                report.added += 1;
            }
        }
    }

    // Soft-delete: rows that exist in DB but not in the fresh list.
    for (upstream_name, row) in &existing_by_upstream {
        if !seen_upstream_names.contains(upstream_name)
            && row.last_synced_at.is_some()
        {
            let deleted = tools_repo::soft_delete_upstream(conn, &row.id).map_err(map_db_err)?;
            if deleted {
                report.soft_deleted += 1;
            }
        }
    }

    Ok(report)
}

fn now_millis() -> i64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .ok()
        .and_then(|d| i64::try_from(d.as_millis()).ok())
        .unwrap_or(0)
}

fn row_to_mcp_tool(row: tools_repo::McpToolRow) -> McpTool {
    McpTool {
        id: row.id,
        name: row.name,
        description: row.description,
        schema_json: row.schema_json,
        color: row.color,
        position: row.position,
        server_id: row.server_id,
        upstream_name: row.upstream_name,
        source: match row.source {
            tools_repo::McpToolSourceRow::Upstream => McpToolSource::Upstream,
            tools_repo::McpToolSourceRow::Manual => McpToolSource::Manual,
        },
        last_synced_at: row.last_synced_at,
        created_at: row.created_at,
        updated_at: row.updated_at,
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

    // ---- PROXY-S4 round 1 — list_proxied_tools + status + list_tools_by_server

    fn seed_upstream_tool(
        pool: &Pool,
        server_id: &str,
        upstream: &str,
        schema: &str,
        synced: Option<i64>,
    ) {
        let conn = acquire(pool).unwrap();
        let draft = tools_repo::McpToolDraft {
            name: format!("alpha.{upstream}"),
            description: Some(format!("desc for {upstream}")),
            schema_json: schema.into(),
            color: None,
            position: 0.0,
            server_id: Some(server_id.into()),
            upstream_name: Some(upstream.into()),
            source: tools_repo::McpToolSourceRow::Upstream,
            last_synced_at: synced,
        };
        tools_repo::insert(&conn, &draft).unwrap();
    }

    #[test]
    fn list_proxied_tools_returns_qualified_names_with_server_meta() {
        let pool = fresh_pool();
        let uc = McpServersUseCase::new(&pool);
        let server = uc
            .create(
                "alpha".into(),
                Transport::Http,
                Some("https://example.invalid/mcp".into()),
                None,
                None,
                true,
            )
            .unwrap();
        seed_upstream_tool(&pool, &server.id, "create_issue", "{}", Some(1));

        let tools = uc.list_proxied_tools().unwrap();
        assert_eq!(tools.len(), 1);
        assert_eq!(tools[0].qualified_name, "alpha.create_issue");
        assert_eq!(tools[0].upstream_name, "create_issue");
        assert_eq!(tools[0].server.id, server.id);
        assert_eq!(tools[0].server.name, "alpha");
    }

    #[test]
    fn list_proxied_tools_excludes_disabled_and_soft_deleted() {
        let pool = fresh_pool();
        let uc = McpServersUseCase::new(&pool);
        let disabled = uc
            .create(
                "off".into(),
                Transport::Http,
                Some("https://example.invalid/off".into()),
                None,
                None,
                false,
            )
            .unwrap();
        let enabled = uc
            .create(
                "on".into(),
                Transport::Http,
                Some("https://example.invalid/on".into()),
                None,
                None,
                true,
            )
            .unwrap();
        // Disabled server's live tool — excluded.
        seed_upstream_tool(&pool, &disabled.id, "x", "{}", Some(1));
        // Enabled server's soft-deleted tool — excluded.
        seed_upstream_tool(&pool, &enabled.id, "soft", "{}", None);
        // Enabled server's live tool — included.
        seed_upstream_tool(&pool, &enabled.id, "live", "{}", Some(2));

        let tools = uc.list_proxied_tools().unwrap();
        assert_eq!(tools.len(), 1);
        assert_eq!(tools[0].upstream_name, "live");
        assert_eq!(tools[0].server.id, enabled.id);
    }

    #[test]
    fn list_proxied_tools_skips_malformed_input_schema_rows() {
        let pool = fresh_pool();
        let uc = McpServersUseCase::new(&pool);
        let server = uc
            .create(
                "alpha".into(),
                Transport::Http,
                Some("https://example.invalid/mcp".into()),
                None,
                None,
                true,
            )
            .unwrap();
        seed_upstream_tool(&pool, &server.id, "ok", "{}", Some(1));
        seed_upstream_tool(&pool, &server.id, "bad", "not-json", Some(2));

        let tools = uc.list_proxied_tools().unwrap();
        assert_eq!(tools.len(), 1, "malformed schema row is skipped, not propagated");
        assert_eq!(tools[0].upstream_name, "ok");
    }

    #[test]
    fn status_unreachable_when_no_upstream_tools_yet() {
        let pool = fresh_pool();
        let uc = McpServersUseCase::new(&pool);
        let server = uc
            .create(
                "alpha".into(),
                Transport::Http,
                Some("https://example.invalid/mcp".into()),
                None,
                None,
                true,
            )
            .unwrap();
        let status = uc.status(&server.id).unwrap();
        assert_eq!(status.state, McpServerHealthState::Unreachable);
        assert_eq!(status.tool_count, 0);
        assert!(status.last_synced_at.is_none());
    }

    #[test]
    fn status_healthy_after_introspection_no_calls_yet() {
        let pool = fresh_pool();
        let uc = McpServersUseCase::new(&pool);
        let server = uc
            .create(
                "alpha".into(),
                Transport::Http,
                Some("https://example.invalid/mcp".into()),
                None,
                None,
                true,
            )
            .unwrap();
        seed_upstream_tool(&pool, &server.id, "x", "{}", Some(123));

        let status = uc.status(&server.id).unwrap();
        assert_eq!(status.state, McpServerHealthState::Healthy);
        assert_eq!(status.tool_count, 1);
        assert_eq!(status.last_synced_at, Some(123));
        assert!(status.last_call_started_at.is_none());
    }

    #[test]
    fn status_disabled_server_is_unreachable_even_with_tools() {
        let pool = fresh_pool();
        let uc = McpServersUseCase::new(&pool);
        let server = uc
            .create(
                "alpha".into(),
                Transport::Http,
                Some("https://example.invalid/mcp".into()),
                None,
                None,
                false,
            )
            .unwrap();
        seed_upstream_tool(&pool, &server.id, "x", "{}", Some(123));

        let status = uc.status(&server.id).unwrap();
        assert_eq!(status.state, McpServerHealthState::Unreachable);
    }

    #[test]
    fn list_tools_by_server_returns_notfound_for_ghost_id() {
        let pool = fresh_pool();
        let uc = McpServersUseCase::new(&pool);
        let err = uc.list_tools_by_server("ghost").expect_err("nf");
        assert!(matches!(err, AppError::NotFound { .. }));
    }

    // ---- PROXY-S4 round 2 — introspect_and_persist reconciliation

    struct StubIntrospector {
        result: std::sync::Mutex<Result<Vec<UpstreamToolDecl>, crate::mcp_proxy::UpstreamError>>,
    }

    impl StubIntrospector {
        fn ok(tools: Vec<UpstreamToolDecl>) -> Self {
            Self {
                result: std::sync::Mutex::new(Ok(tools)),
            }
        }
        fn err(msg: &str) -> Self {
            Self {
                result: std::sync::Mutex::new(Err(crate::mcp_proxy::UpstreamError::Transport(
                    msg.into(),
                ))),
            }
        }
    }

    impl UpstreamIntrospector for StubIntrospector {
        async fn list_tools(
            &self,
            _meta: &ServerWireMeta,
        ) -> Result<Vec<UpstreamToolDecl>, crate::mcp_proxy::UpstreamError> {
            match &*self.result.lock().unwrap() {
                Ok(v) => Ok(v.clone()),
                Err(_) => Err(crate::mcp_proxy::UpstreamError::Transport("stub".into())),
            }
        }
    }

    fn decl(name: &str, schema: &str) -> UpstreamToolDecl {
        UpstreamToolDecl {
            name: name.into(),
            description: Some(format!("desc {name}")),
            input_schema: serde_json::from_str(schema).unwrap_or(serde_json::json!({})),
        }
    }

    #[tokio::test]
    async fn introspect_inserts_new_tools_on_first_run() {
        let pool = fresh_pool();
        let uc = McpServersUseCase::new(&pool);
        let server = uc
            .create(
                "alpha".into(),
                Transport::Http,
                Some("https://example.invalid/mcp".into()),
                None,
                None,
                true,
            )
            .unwrap();

        let stub = StubIntrospector::ok(vec![
            decl("create_issue", r#"{"type":"object"}"#),
            decl("list_issues", r#"{"type":"object"}"#),
        ]);
        let report = uc.introspect_and_persist(&server.id, &stub).await.unwrap();
        assert_eq!(report.added, 2);
        assert_eq!(report.still_present, 0);
        assert_eq!(report.schema_changed, 0);
        assert_eq!(report.soft_deleted, 0);

        let tools = uc.list_proxied_tools().unwrap();
        assert_eq!(tools.len(), 2);
    }

    #[tokio::test]
    async fn introspect_marks_unchanged_tools_as_still_present() {
        let pool = fresh_pool();
        let uc = McpServersUseCase::new(&pool);
        let server = uc
            .create(
                "alpha".into(),
                Transport::Http,
                Some("https://example.invalid/mcp".into()),
                None,
                None,
                true,
            )
            .unwrap();

        let stub1 = StubIntrospector::ok(vec![decl("x", r#"{"type":"object"}"#)]);
        uc.introspect_and_persist(&server.id, &stub1).await.unwrap();

        let stub2 = StubIntrospector::ok(vec![decl("x", r#"{"type":"object"}"#)]);
        let report = uc.introspect_and_persist(&server.id, &stub2).await.unwrap();
        assert_eq!(report.added, 0);
        assert_eq!(report.still_present, 1);
        assert_eq!(report.schema_changed, 0);
        assert_eq!(report.soft_deleted, 0);
    }

    #[tokio::test]
    async fn introspect_flags_schema_changes() {
        let pool = fresh_pool();
        let uc = McpServersUseCase::new(&pool);
        let server = uc
            .create(
                "alpha".into(),
                Transport::Http,
                Some("https://example.invalid/mcp".into()),
                None,
                None,
                true,
            )
            .unwrap();

        let stub1 = StubIntrospector::ok(vec![decl("x", r#"{"type":"object"}"#)]);
        uc.introspect_and_persist(&server.id, &stub1).await.unwrap();

        let stub2 = StubIntrospector::ok(vec![decl(
            "x",
            r#"{"type":"object","properties":{"a":{"type":"string"}}}"#,
        )]);
        let report = uc.introspect_and_persist(&server.id, &stub2).await.unwrap();
        assert_eq!(report.added, 0);
        assert_eq!(report.schema_changed, 1);
        assert_eq!(report.still_present, 0);
    }

    #[tokio::test]
    async fn introspect_soft_deletes_removed_tools() {
        let pool = fresh_pool();
        let uc = McpServersUseCase::new(&pool);
        let server = uc
            .create(
                "alpha".into(),
                Transport::Http,
                Some("https://example.invalid/mcp".into()),
                None,
                None,
                true,
            )
            .unwrap();

        let stub1 = StubIntrospector::ok(vec![
            decl("kept", r#"{"type":"object"}"#),
            decl("gone", r#"{"type":"object"}"#),
        ]);
        uc.introspect_and_persist(&server.id, &stub1).await.unwrap();
        assert_eq!(uc.list_proxied_tools().unwrap().len(), 2);

        let stub2 = StubIntrospector::ok(vec![decl("kept", r#"{"type":"object"}"#)]);
        let report = uc.introspect_and_persist(&server.id, &stub2).await.unwrap();
        assert_eq!(report.still_present, 1);
        assert_eq!(report.soft_deleted, 1);

        let live = uc.list_proxied_tools().unwrap();
        assert_eq!(live.len(), 1);
        assert_eq!(live[0].upstream_name, "kept");

        // Soft-deleted row stays in the per-server list.
        let all = uc.list_tools_by_server(&server.id).unwrap();
        assert_eq!(all.len(), 2);
    }

    #[tokio::test]
    async fn introspect_propagates_upstream_failure_without_db_writes() {
        let pool = fresh_pool();
        let uc = McpServersUseCase::new(&pool);
        let server = uc
            .create(
                "alpha".into(),
                Transport::Http,
                Some("https://example.invalid/mcp".into()),
                None,
                None,
                true,
            )
            .unwrap();
        let stub = StubIntrospector::err("pipe broke");
        let err = uc
            .introspect_and_persist(&server.id, &stub)
            .await
            .expect_err("upstream");
        assert!(matches!(err, AppError::Upstream { .. }));
        assert!(uc.list_tools_by_server(&server.id).unwrap().is_empty());
    }

    #[tokio::test]
    async fn introspect_unknown_server_returns_not_found() {
        let pool = fresh_pool();
        let uc = McpServersUseCase::new(&pool);
        let stub = StubIntrospector::ok(vec![]);
        let err = uc
            .introspect_and_persist("ghost", &stub)
            .await
            .expect_err("nf");
        assert!(matches!(err, AppError::NotFound { .. }));
    }

    #[test]
    fn list_tools_by_server_returns_soft_deleted_rows() {
        let pool = fresh_pool();
        let uc = McpServersUseCase::new(&pool);
        let server = uc
            .create(
                "alpha".into(),
                Transport::Http,
                Some("https://example.invalid/mcp".into()),
                None,
                None,
                true,
            )
            .unwrap();
        seed_upstream_tool(&pool, &server.id, "live", "{}", Some(1));
        seed_upstream_tool(&pool, &server.id, "soft", "{}", None);

        let tools = uc.list_tools_by_server(&server.id).unwrap();
        assert_eq!(tools.len(), 2, "UI needs soft-deleted rows for strikethrough");
        let names: Vec<&str> = tools.iter().map(|t| t.name.as_str()).collect();
        assert!(names.contains(&"alpha.live"));
        assert!(names.contains(&"alpha.soft"));
    }
}
