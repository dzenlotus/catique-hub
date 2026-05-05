//! MCP tools use case.
//!
//! Wave-E2.x (Round 6 back-fill). Mirrors `RolesUseCase`. UNIQUE(name)
//! maps to `AppError::Conflict { entity: "mcp_tool", … }`.
//! `schema_json` is validated as parseable JSON on create and update.

use catique_domain::McpTool;
use catique_infrastructure::db::{
    pool::{acquire, Pool},
    repositories::mcp_tools::{self as repo, McpToolDraft, McpToolPatch, McpToolRow},
};

use crate::{
    error::AppError,
    error_map::{map_db_err, map_db_err_unique, validate_non_empty, validate_optional_color},
};

/// MCP tools use case.
pub struct McpToolsUseCase<'a> {
    pool: &'a Pool,
}

impl<'a> McpToolsUseCase<'a> {
    /// Constructor.
    #[must_use]
    pub fn new(pool: &'a Pool) -> Self {
        Self { pool }
    }

    /// List every MCP tool, ordered by position then name.
    ///
    /// # Errors
    ///
    /// Forwards storage-layer errors.
    pub fn list(&self) -> Result<Vec<McpTool>, AppError> {
        let conn = acquire(self.pool).map_err(map_db_err)?;
        let rows = repo::list_all(&conn).map_err(map_db_err)?;
        Ok(rows.into_iter().map(row_to_mcp_tool).collect())
    }

    /// Look up an MCP tool by id.
    ///
    /// # Errors
    ///
    /// `AppError::NotFound` if missing.
    pub fn get(&self, id: &str) -> Result<McpTool, AppError> {
        let conn = acquire(self.pool).map_err(map_db_err)?;
        match repo::get_by_id(&conn, id).map_err(map_db_err)? {
            Some(row) => Ok(row_to_mcp_tool(row)),
            None => Err(AppError::NotFound {
                entity: "mcp_tool".into(),
                id: id.to_owned(),
            }),
        }
    }

    /// Create an MCP tool.
    ///
    /// # Errors
    ///
    /// `AppError::Validation` for empty name / bad colour / invalid JSON;
    /// `AppError::Conflict` for UNIQUE(name) collisions.
    #[allow(clippy::needless_pass_by_value)]
    pub fn create(
        &self,
        name: String,
        description: Option<String>,
        schema_json: String,
        color: Option<String>,
        position: f64,
    ) -> Result<McpTool, AppError> {
        let trimmed = validate_non_empty("name", &name)?;
        validate_optional_color("color", color.as_deref())?;
        validate_schema_json(&schema_json)?;
        let conn = acquire(self.pool).map_err(map_db_err)?;
        let row = repo::insert(
            &conn,
            &McpToolDraft {
                name: trimmed,
                description,
                schema_json,
                color,
                position,
            },
        )
        .map_err(|e| map_db_err_unique(e, "mcp_tool"))?;
        Ok(row_to_mcp_tool(row))
    }

    /// Partial update.
    ///
    /// # Errors
    ///
    /// `AppError::NotFound` if id missing; `AppError::Validation` for
    /// invalid JSON in `schema_json`.
    #[allow(clippy::needless_pass_by_value)]
    pub fn update(
        &self,
        id: String,
        name: Option<String>,
        description: Option<Option<String>>,
        schema_json: Option<String>,
        color: Option<Option<String>>,
        position: Option<f64>,
    ) -> Result<McpTool, AppError> {
        if let Some(n) = name.as_deref() {
            validate_non_empty("name", n)?;
        }
        if let Some(Some(c)) = color.as_ref() {
            validate_optional_color("color", Some(c))?;
        }
        if let Some(ref s) = schema_json {
            validate_schema_json(s)?;
        }
        let conn = acquire(self.pool).map_err(map_db_err)?;
        let patch = McpToolPatch {
            name: name.map(|n| n.trim().to_owned()),
            description,
            schema_json,
            color,
            position,
        };
        match repo::update(&conn, &id, &patch).map_err(|e| map_db_err_unique(e, "mcp_tool"))? {
            Some(row) => Ok(row_to_mcp_tool(row)),
            None => Err(AppError::NotFound {
                entity: "mcp_tool".into(),
                id,
            }),
        }
    }

    /// Delete an MCP tool.
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
                entity: "mcp_tool".into(),
                id: id.to_owned(),
            })
        }
    }

    /// List every MCP tool attached to a role, ordered by
    /// `role_mcp_tools.position`.
    ///
    /// ctq-117.
    ///
    /// # Errors
    ///
    /// Forwards storage-layer errors.
    pub fn list_for_role(&self, role_id: &str) -> Result<Vec<McpTool>, AppError> {
        let conn = acquire(self.pool).map_err(map_db_err)?;
        let rows = repo::list_for_role(&conn, role_id).map_err(map_db_err)?;
        Ok(rows.into_iter().map(row_to_mcp_tool).collect())
    }

    /// List every MCP tool attached to a task, ordered by
    /// `task_mcp_tools.position`.
    ///
    /// ctq-117.
    ///
    /// # Errors
    ///
    /// Forwards storage-layer errors.
    pub fn list_for_task(&self, task_id: &str) -> Result<Vec<McpTool>, AppError> {
        let conn = acquire(self.pool).map_err(map_db_err)?;
        let rows = repo::list_for_task(&conn, task_id).map_err(map_db_err)?;
        Ok(rows.into_iter().map(row_to_mcp_tool).collect())
    }

    /// Attach an MCP tool directly to a task. Idempotent.
    ///
    /// ctq-127.
    ///
    /// # Errors
    ///
    /// `AppError::TransactionRolledBack` on FK violation.
    pub fn add_to_task(
        &self,
        task_id: &str,
        mcp_tool_id: &str,
        position: f64,
    ) -> Result<(), AppError> {
        let conn = acquire(self.pool).map_err(map_db_err)?;
        repo::add_task_mcp_tool(&conn, task_id, mcp_tool_id, position).map_err(map_db_err)
    }

    /// Detach a direct MCP tool from a task. Idempotent — no row matched
    /// is not an error.
    ///
    /// ctq-127.
    ///
    /// # Errors
    ///
    /// Forwards storage-layer errors.
    pub fn remove_from_task(&self, task_id: &str, mcp_tool_id: &str) -> Result<(), AppError> {
        let conn = acquire(self.pool).map_err(map_db_err)?;
        let _ = repo::remove_task_mcp_tool(&conn, task_id, mcp_tool_id).map_err(map_db_err)?;
        Ok(())
    }
}

/// Validate that `s` is parseable JSON. Returns `AppError::Validation`
/// on failure so the application layer rejects garbage before it hits
/// the DB.
fn validate_schema_json(s: &str) -> Result<(), AppError> {
    serde_json::from_str::<serde_json::Value>(s).map_err(|e| AppError::Validation {
        field: "schema_json".into(),
        reason: format!("must be valid JSON: {e}"),
    })?;
    Ok(())
}

fn row_to_mcp_tool(row: McpToolRow) -> McpTool {
    McpTool {
        id: row.id,
        name: row.name,
        description: row.description,
        schema_json: row.schema_json,
        color: row.color,
        position: row.position,
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
    fn create_with_invalid_schema_json_returns_validation() {
        let pool = fresh_pool();
        let uc = McpToolsUseCase::new(&pool);
        match uc
            .create("t".into(), None, "not-json".into(), None, 0.0)
            .expect_err("v")
        {
            AppError::Validation { field, .. } => assert_eq!(field, "schema_json"),
            other => panic!("got {other:?}"),
        }
    }

    #[test]
    fn create_with_empty_name_returns_validation() {
        let pool = fresh_pool();
        let uc = McpToolsUseCase::new(&pool);
        match uc
            .create(String::new(), None, "{}".into(), None, 0.0)
            .expect_err("v")
        {
            AppError::Validation { field, .. } => assert_eq!(field, "name"),
            other => panic!("got {other:?}"),
        }
    }

    #[test]
    fn create_with_bad_color_returns_validation() {
        let pool = fresh_pool();
        let uc = McpToolsUseCase::new(&pool);
        match uc
            .create("t".into(), None, "{}".into(), Some("red".into()), 0.0)
            .expect_err("v")
        {
            AppError::Validation { field, .. } => assert_eq!(field, "color"),
            other => panic!("got {other:?}"),
        }
    }

    #[test]
    fn duplicate_name_returns_conflict() {
        let pool = fresh_pool();
        let uc = McpToolsUseCase::new(&pool);
        uc.create("bash".into(), None, "{}".into(), None, 0.0)
            .unwrap();
        match uc
            .create("bash".into(), None, "{}".into(), None, 1.0)
            .expect_err("c")
        {
            AppError::Conflict { entity, .. } => assert_eq!(entity, "mcp_tool"),
            other => panic!("got {other:?}"),
        }
    }

    #[test]
    fn create_then_list() {
        let pool = fresh_pool();
        let uc = McpToolsUseCase::new(&pool);
        uc.create(
            "bash".into(),
            Some("run commands".into()),
            r#"{"type":"object"}"#.into(),
            Some("#abcdef".into()),
            0.0,
        )
        .unwrap();
        let list = uc.list().unwrap();
        assert_eq!(list.len(), 1);
        assert_eq!(list[0].description, Some("run commands".into()));
    }

    #[test]
    fn delete_returns_not_found_for_missing_id() {
        let pool = fresh_pool();
        let uc = McpToolsUseCase::new(&pool);
        match uc.delete("ghost").expect_err("nf") {
            AppError::NotFound { entity, .. } => assert_eq!(entity, "mcp_tool"),
            other => panic!("got {other:?}"),
        }
    }

    #[test]
    fn update_with_invalid_schema_json_returns_validation() {
        let pool = fresh_pool();
        let uc = McpToolsUseCase::new(&pool);
        let tool = uc
            .create("bash".into(), None, "{}".into(), None, 0.0)
            .unwrap();
        match uc
            .update(tool.id, None, None, Some("bad-json{".into()), None, None)
            .expect_err("v")
        {
            AppError::Validation { field, .. } => assert_eq!(field, "schema_json"),
            other => panic!("got {other:?}"),
        }
    }

    /// ctq-127: idempotent re-add and idempotent remove of a missing row.
    #[test]
    fn add_and_remove_to_task_idempotent() {
        let pool = fresh_pool();
        let conn = pool.get().unwrap();
        conn.execute_batch(
            "INSERT INTO spaces (id, name, prefix, is_default, position, created_at, updated_at) \
                 VALUES ('sp','Space','sp',0,0,0,0); \
             INSERT INTO boards (id, name, space_id, position, created_at, updated_at) \
                 VALUES ('bd','B','sp',0,0,0); \
             INSERT INTO columns (id, board_id, name, position, created_at) \
                 VALUES ('co','bd','C',0,0); \
             INSERT INTO tasks (id, board_id, column_id, slug, title, position, created_at, updated_at) \
                 VALUES ('t1','bd','co','sp-1','T',0,0,0);",
        )
        .unwrap();
        drop(conn);
        let uc = McpToolsUseCase::new(&pool);
        let m = uc
            .create("bash".into(), None, "{}".into(), None, 0.0)
            .unwrap();
        uc.add_to_task("t1", &m.id, 1.0).unwrap();
        uc.add_to_task("t1", &m.id, 999.0).unwrap();
        let list = uc.list_for_task("t1").unwrap();
        assert_eq!(list.len(), 1);
        // Remove twice — second call must succeed silently.
        uc.remove_from_task("t1", &m.id).unwrap();
        uc.remove_from_task("t1", &m.id).unwrap();
    }
}
