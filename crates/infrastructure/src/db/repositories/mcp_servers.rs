//! MCP servers repository — CRUD on the `mcp_servers` table and the
//! `mcp_server_tools` join.
//!
//! Schema: `013_mcp_servers.sql` (ADR-0007 registry-only mode). The
//! row encodes connection metadata only; auth secrets are stored
//! externally (OS keychain or env var) and `auth_json` carries a
//! reference to where they live, never the secret value itself. The
//! reference-shape guard runs at the application layer
//! (`crates/application/src/mcp_servers.rs`) — this module is purely
//! storage-mechanical.

use rusqlite::{params, Connection, OptionalExtension, Row};

use super::util::{new_id, now_millis};
use crate::db::pool::DbError;

/// Wire value for the `transport` column. Mirrors
/// `catique_domain::Transport` but lives here to keep the repository
/// crate independent of the domain enum derives. The `as_str` /
/// `from_str` pair is the only conversion site.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum TransportKind {
    Stdio,
    Http,
    Sse,
}

impl TransportKind {
    /// Wire value as stored in the DB.
    #[must_use]
    pub const fn as_str(self) -> &'static str {
        match self {
            Self::Stdio => "stdio",
            Self::Http => "http",
            Self::Sse => "sse",
        }
    }

    /// Parse a wire value from the DB. The CHECK constraint guarantees
    /// only the three known strings reach this function on a healthy
    /// row, so we treat anything else as a corrupt-DB programmer error
    /// and surface a typed [`DbError::Sqlite`] (via
    /// [`rusqlite::Error::FromSqlConversionFailure`]).
    fn parse(s: &str) -> Result<Self, rusqlite::Error> {
        match s {
            "stdio" => Ok(Self::Stdio),
            "http" => Ok(Self::Http),
            "sse" => Ok(Self::Sse),
            other => Err(rusqlite::Error::FromSqlConversionFailure(
                0,
                rusqlite::types::Type::Text,
                Box::new(std::io::Error::new(
                    std::io::ErrorKind::InvalidData,
                    format!("unknown transport `{other}`"),
                )),
            )),
        }
    }
}

/// One row of the `mcp_servers` table.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct McpServerRow {
    pub id: String,
    pub name: String,
    pub transport: TransportKind,
    pub url: Option<String>,
    pub command: Option<String>,
    pub auth_json: Option<String>,
    pub enabled: bool,
    pub created_at: i64,
    pub updated_at: i64,
}

impl McpServerRow {
    fn from_row(row: &Row<'_>) -> rusqlite::Result<Self> {
        let transport_str: String = row.get("transport")?;
        let enabled_int: i64 = row.get("enabled")?;
        Ok(Self {
            id: row.get("id")?,
            name: row.get("name")?,
            transport: TransportKind::parse(&transport_str)?,
            url: row.get("url")?,
            command: row.get("command")?,
            auth_json: row.get("auth_json")?,
            enabled: enabled_int != 0,
            created_at: row.get("created_at")?,
            updated_at: row.get("updated_at")?,
        })
    }
}

/// Draft for inserting a new MCP server.
///
/// The url/command split MUST satisfy the row-level invariant that the
/// CHECK in `013_mcp_servers.sql` enforces:
///
/// * `transport == Stdio` → `command.is_some() && url.is_none()`;
/// * `transport ∈ {Http, Sse}` → `url.is_some() && command.is_none()`.
///
/// Violations surface as a constraint error from SQLite. The
/// application layer is the natural place to pre-check (so the user
/// gets [`crate::db::pool::DbError`]→`AppError::BadRequest` rather than
/// a generic `TransactionRolledBack`), but the DB is the ultimate guard.
#[derive(Debug, Clone)]
pub struct McpServerDraft {
    pub name: String,
    pub transport: TransportKind,
    pub url: Option<String>,
    pub command: Option<String>,
    pub auth_json: Option<String>,
    pub enabled: bool,
}

/// Partial update payload. `None` means "do not change". For nullable
/// `Option<String>` fields, `Some(None)` means "set to NULL".
#[derive(Debug, Clone, Default)]
pub struct McpServerPatch {
    pub name: Option<String>,
    pub transport: Option<TransportKind>,
    pub url: Option<Option<String>>,
    pub command: Option<Option<String>>,
    pub auth_json: Option<Option<String>>,
    pub enabled: Option<bool>,
}

/// `SELECT … FROM mcp_servers ORDER BY name ASC`.
///
/// # Errors
///
/// Surfaces rusqlite errors.
pub fn list_all(conn: &Connection) -> Result<Vec<McpServerRow>, DbError> {
    let mut stmt = conn.prepare(
        "SELECT id, name, transport, url, command, auth_json, enabled, created_at, updated_at \
         FROM mcp_servers ORDER BY name ASC, id ASC",
    )?;
    let rows = stmt.query_map([], McpServerRow::from_row)?;
    let mut out = Vec::new();
    for row in rows {
        out.push(row?);
    }
    Ok(out)
}

/// `SELECT … FROM mcp_servers WHERE enabled = 1 ORDER BY name ASC`.
///
/// Used by ctq-126 (sidecar MCP surface) so disabled servers never
/// reach the calling agent.
///
/// # Errors
///
/// Surfaces rusqlite errors.
pub fn list_by_enabled(conn: &Connection) -> Result<Vec<McpServerRow>, DbError> {
    let mut stmt = conn.prepare(
        "SELECT id, name, transport, url, command, auth_json, enabled, created_at, updated_at \
         FROM mcp_servers WHERE enabled = 1 ORDER BY name ASC, id ASC",
    )?;
    let rows = stmt.query_map([], McpServerRow::from_row)?;
    let mut out = Vec::new();
    for row in rows {
        out.push(row?);
    }
    Ok(out)
}

/// Lookup by primary key.
///
/// # Errors
///
/// Surfaces rusqlite errors.
pub fn get_by_id(conn: &Connection, id: &str) -> Result<Option<McpServerRow>, DbError> {
    let mut stmt = conn.prepare(
        "SELECT id, name, transport, url, command, auth_json, enabled, created_at, updated_at \
         FROM mcp_servers WHERE id = ?1",
    )?;
    Ok(stmt
        .query_row(params![id], McpServerRow::from_row)
        .optional()?)
}

/// Fetch a server together with the IDs of every `mcp_tools` row
/// it advertises (via the `mcp_server_tools` join). Returns `None`
/// when the server itself does not exist.
///
/// # Errors
///
/// Surfaces rusqlite errors.
pub fn get_with_tools(
    conn: &Connection,
    id: &str,
) -> Result<Option<(McpServerRow, Vec<String>)>, DbError> {
    let Some(row) = get_by_id(conn, id)? else {
        return Ok(None);
    };
    let mut stmt = conn.prepare(
        "SELECT mcp_tool_id FROM mcp_server_tools \
         WHERE server_id = ?1 ORDER BY mcp_tool_id ASC",
    )?;
    let rows = stmt.query_map(params![id], |r| r.get::<_, String>(0))?;
    let mut tool_ids = Vec::new();
    for r in rows {
        tool_ids.push(r?);
    }
    Ok(Some((row, tool_ids)))
}

/// Insert one MCP server. Generates id, stamps timestamps.
///
/// # Errors
///
/// CHECK violations (transport/url/command split) surface as
/// [`DbError::Sqlite`] with the constraint code.
pub fn insert(conn: &Connection, draft: &McpServerDraft) -> Result<McpServerRow, DbError> {
    let id = new_id();
    let now = now_millis();
    conn.execute(
        "INSERT INTO mcp_servers \
         (id, name, transport, url, command, auth_json, enabled, created_at, updated_at) \
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?8)",
        params![
            id,
            draft.name,
            draft.transport.as_str(),
            draft.url,
            draft.command,
            draft.auth_json,
            i64::from(draft.enabled),
            now,
        ],
    )?;
    Ok(McpServerRow {
        id,
        name: draft.name.clone(),
        transport: draft.transport,
        url: draft.url.clone(),
        command: draft.command.clone(),
        auth_json: draft.auth_json.clone(),
        enabled: draft.enabled,
        created_at: now,
        updated_at: now,
    })
}

/// Partial update. Bumps `updated_at` regardless.
///
/// The patch is applied as a single `UPDATE` so the row-level CHECK
/// constraint sees the post-update state — callers that flip
/// `transport` from `stdio` to `http` MUST also clear `command` and
/// set `url` in the same patch (or the CHECK fires).
///
/// # Errors
///
/// Surfaces rusqlite errors. CHECK violations come back as
/// [`DbError::Sqlite`] with the constraint code.
pub fn update(
    conn: &Connection,
    id: &str,
    patch: &McpServerPatch,
) -> Result<Option<McpServerRow>, DbError> {
    let now = now_millis();

    let mut clause_parts: Vec<String> = Vec::new();

    if patch.name.is_some() {
        clause_parts.push("name = COALESCE(?2, name)".into());
    }
    if patch.transport.is_some() {
        clause_parts.push("transport = COALESCE(?3, transport)".into());
    }
    if patch.url.is_some() {
        clause_parts.push("url = ?4".into());
    }
    if patch.command.is_some() {
        clause_parts.push("command = ?5".into());
    }
    if patch.auth_json.is_some() {
        clause_parts.push("auth_json = ?6".into());
    }
    if patch.enabled.is_some() {
        clause_parts.push("enabled = COALESCE(?7, enabled)".into());
    }

    let set_clause = if clause_parts.is_empty() {
        "updated_at = ?1".to_owned()
    } else {
        let mut all = clause_parts;
        all.push("updated_at = ?1".into());
        all.join(", ")
    };

    let sql = format!("UPDATE mcp_servers SET {set_clause} WHERE id = ?8");

    let url_val: Option<String> = patch.url.as_ref().and_then(Clone::clone);
    let command_val: Option<String> = patch.command.as_ref().and_then(Clone::clone);
    let auth_val: Option<String> = patch.auth_json.as_ref().and_then(Clone::clone);
    let transport_str: Option<&'static str> = patch.transport.map(TransportKind::as_str);
    let enabled_int: Option<i64> = patch.enabled.map(i64::from);

    let updated = conn.execute(
        &sql,
        params![
            now,
            patch.name,
            transport_str,
            url_val,
            command_val,
            auth_val,
            enabled_int,
            id,
        ],
    )?;
    if updated == 0 {
        return Ok(None);
    }
    get_by_id(conn, id)
}

/// Delete one MCP server by id. Cascades to `mcp_server_tools` via
/// `ON DELETE CASCADE`.
///
/// # Errors
///
/// Surfaces rusqlite errors.
pub fn delete(conn: &Connection, id: &str) -> Result<bool, DbError> {
    let n = conn.execute("DELETE FROM mcp_servers WHERE id = ?1", params![id])?;
    Ok(n > 0)
}

/// Replace the set of `mcp_tool_id`s linked to a server. Idempotent —
/// calling with the same set twice is a no-op (modulo a transaction).
///
/// # Errors
///
/// Surfaces rusqlite errors. FK violations on a missing
/// `mcp_tool_id` come back as [`DbError::Sqlite`].
pub fn set_tools(conn: &Connection, server_id: &str, tool_ids: &[String]) -> Result<(), DbError> {
    conn.execute(
        "DELETE FROM mcp_server_tools WHERE server_id = ?1",
        params![server_id],
    )?;
    if tool_ids.is_empty() {
        return Ok(());
    }
    let mut stmt = conn
        .prepare("INSERT INTO mcp_server_tools (server_id, mcp_tool_id) VALUES (?1, ?2)")?;
    for tool_id in tool_ids {
        stmt.execute(params![server_id, tool_id])?;
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db::runner::run_pending;

    fn fresh_db() -> Connection {
        let mut conn = Connection::open_in_memory().unwrap();
        conn.execute_batch("PRAGMA foreign_keys = ON;").unwrap();
        run_pending(&mut conn).expect("migrations");
        conn
    }

    fn stdio_draft(name: &str) -> McpServerDraft {
        McpServerDraft {
            name: name.into(),
            transport: TransportKind::Stdio,
            url: None,
            command: Some("node sidecar.js".into()),
            auth_json: None,
            enabled: true,
        }
    }

    fn http_draft(name: &str) -> McpServerDraft {
        McpServerDraft {
            name: name.into(),
            transport: TransportKind::Http,
            url: Some("https://api.example.com/mcp".into()),
            command: None,
            auth_json: None,
            enabled: true,
        }
    }

    #[test]
    fn insert_then_get_stdio() {
        let conn = fresh_db();
        let row = insert(&conn, &stdio_draft("local-fs")).unwrap();
        let got = get_by_id(&conn, &row.id).unwrap().unwrap();
        assert_eq!(row, got);
        assert_eq!(got.transport, TransportKind::Stdio);
        assert_eq!(got.command.as_deref(), Some("node sidecar.js"));
        assert!(got.url.is_none());
    }

    #[test]
    fn insert_then_get_http() {
        let conn = fresh_db();
        let row = insert(&conn, &http_draft("github")).unwrap();
        let got = get_by_id(&conn, &row.id).unwrap().unwrap();
        assert_eq!(row, got);
        assert_eq!(got.transport, TransportKind::Http);
        assert_eq!(got.url.as_deref(), Some("https://api.example.com/mcp"));
        assert!(got.command.is_none());
    }

    #[test]
    fn insert_rejects_stdio_with_url_and_command() {
        // CHECK invariant: stdio MUST NOT carry a url.
        let conn = fresh_db();
        let bad = McpServerDraft {
            name: "broken".into(),
            transport: TransportKind::Stdio,
            url: Some("https://nope".into()),
            command: Some("node sidecar.js".into()),
            auth_json: None,
            enabled: true,
        };
        let err = insert(&conn, &bad).expect_err("CHECK fires");
        match err {
            DbError::Sqlite(rusqlite::Error::SqliteFailure(code, _)) => {
                assert_eq!(code.code, rusqlite::ErrorCode::ConstraintViolation);
            }
            other => panic!("got {other:?}"),
        }
    }

    #[test]
    fn insert_rejects_http_with_no_url_and_no_command() {
        // CHECK invariant: http MUST carry a url.
        let conn = fresh_db();
        let bad = McpServerDraft {
            name: "broken".into(),
            transport: TransportKind::Http,
            url: None,
            command: None,
            auth_json: None,
            enabled: true,
        };
        let err = insert(&conn, &bad).expect_err("CHECK fires");
        match err {
            DbError::Sqlite(rusqlite::Error::SqliteFailure(code, _)) => {
                assert_eq!(code.code, rusqlite::ErrorCode::ConstraintViolation);
            }
            other => panic!("got {other:?}"),
        }
    }

    #[test]
    fn insert_rejects_unknown_transport_via_check() {
        // Direct SQL — bypassing the typed enum — must still be rejected
        // by the CHECK constraint.
        let conn = fresh_db();
        let err = conn
            .execute(
                "INSERT INTO mcp_servers \
                 (id, name, transport, url, command, auth_json, enabled, created_at, updated_at) \
                 VALUES ('x','x','grpc','u',NULL,NULL,1,0,0)",
                [],
            )
            .expect_err("CHECK fires");
        match err {
            rusqlite::Error::SqliteFailure(code, _) => {
                assert_eq!(code.code, rusqlite::ErrorCode::ConstraintViolation);
            }
            other => panic!("got {other:?}"),
        }
    }

    #[test]
    fn list_all_orders_by_name() {
        let conn = fresh_db();
        insert(&conn, &http_draft("zeta")).unwrap();
        insert(&conn, &http_draft("alpha")).unwrap();
        let rows = list_all(&conn).unwrap();
        assert_eq!(rows.len(), 2);
        assert_eq!(rows[0].name, "alpha");
        assert_eq!(rows[1].name, "zeta");
    }

    #[test]
    fn list_by_enabled_filters_disabled() {
        let conn = fresh_db();
        insert(&conn, &http_draft("on")).unwrap();
        let off = McpServerDraft {
            enabled: false,
            ..http_draft("off")
        };
        insert(&conn, &off).unwrap();
        let rows = list_by_enabled(&conn).unwrap();
        assert_eq!(rows.len(), 1);
        assert_eq!(rows[0].name, "on");
    }

    #[test]
    fn update_partial_fields() {
        let conn = fresh_db();
        let row = insert(&conn, &http_draft("a")).unwrap();
        let updated = update(
            &conn,
            &row.id,
            &McpServerPatch {
                name: Some("b".into()),
                enabled: Some(false),
                ..McpServerPatch::default()
            },
        )
        .unwrap()
        .unwrap();
        assert_eq!(updated.name, "b");
        assert!(!updated.enabled);
    }

    #[test]
    fn update_returns_none_for_missing_id() {
        let conn = fresh_db();
        assert!(update(&conn, "ghost", &McpServerPatch::default())
            .unwrap()
            .is_none());
    }

    #[test]
    fn delete_returns_true_then_false() {
        let conn = fresh_db();
        let row = insert(&conn, &http_draft("a")).unwrap();
        assert!(delete(&conn, &row.id).unwrap());
        assert!(!delete(&conn, &row.id).unwrap());
    }

    #[test]
    fn delete_cascades_to_mcp_server_tools() {
        let conn = fresh_db();
        let server = insert(&conn, &http_draft("a")).unwrap();

        // Seed an mcp_tool row using the existing repository helper.
        let tool = super::super::mcp_tools::insert(
            &conn,
            &super::super::mcp_tools::McpToolDraft {
                name: "search".into(),
                description: None,
                schema_json: "{}".into(),
                color: None,
                position: 0.0,
            },
        )
        .unwrap();

        set_tools(&conn, &server.id, std::slice::from_ref(&tool.id)).unwrap();

        let before: i64 = conn
            .query_row(
                "SELECT COUNT(*) FROM mcp_server_tools WHERE server_id = ?1",
                params![server.id],
                |r| r.get(0),
            )
            .unwrap();
        assert_eq!(before, 1);

        assert!(delete(&conn, &server.id).unwrap());

        let after: i64 = conn
            .query_row(
                "SELECT COUNT(*) FROM mcp_server_tools WHERE server_id = ?1",
                params![server.id],
                |r| r.get(0),
            )
            .unwrap();
        assert_eq!(after, 0, "join row must cascade-delete with its server");
    }

    #[test]
    fn delete_mcp_tool_cascades_to_join() {
        let conn = fresh_db();
        let server = insert(&conn, &http_draft("a")).unwrap();
        let tool = super::super::mcp_tools::insert(
            &conn,
            &super::super::mcp_tools::McpToolDraft {
                name: "search".into(),
                description: None,
                schema_json: "{}".into(),
                color: None,
                position: 0.0,
            },
        )
        .unwrap();
        set_tools(&conn, &server.id, std::slice::from_ref(&tool.id)).unwrap();

        super::super::mcp_tools::delete(&conn, &tool.id).unwrap();

        let after: i64 = conn
            .query_row(
                "SELECT COUNT(*) FROM mcp_server_tools WHERE mcp_tool_id = ?1",
                params![tool.id],
                |r| r.get(0),
            )
            .unwrap();
        assert_eq!(after, 0, "join row must cascade-delete with its tool");
    }

    #[test]
    fn get_with_tools_returns_linked_ids() {
        let conn = fresh_db();
        let server = insert(&conn, &http_draft("a")).unwrap();
        let tool = super::super::mcp_tools::insert(
            &conn,
            &super::super::mcp_tools::McpToolDraft {
                name: "search".into(),
                description: None,
                schema_json: "{}".into(),
                color: None,
                position: 0.0,
            },
        )
        .unwrap();
        set_tools(&conn, &server.id, std::slice::from_ref(&tool.id)).unwrap();

        let (got_row, tool_ids) = get_with_tools(&conn, &server.id).unwrap().unwrap();
        assert_eq!(got_row.id, server.id);
        assert_eq!(tool_ids, vec![tool.id]);
    }

    #[test]
    fn get_with_tools_returns_none_for_missing_server() {
        let conn = fresh_db();
        assert!(get_with_tools(&conn, "ghost").unwrap().is_none());
    }
}
