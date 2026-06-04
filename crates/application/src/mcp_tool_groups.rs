//! MCP-tool-groups use case — the MCP mirror of [`crate::prompt_groups`].
//!
//! CRUD on `mcp_tool_groups` + member management, plus group-as-live-unit
//! attachment at role / board / task scope. Member edits and group delete
//! re-materialise/clear `task_mcp_tools` everywhere the group is attached,
//! all inside one `IMMEDIATE` transaction.

use catique_domain::McpToolGroup;
use catique_infrastructure::db::{
    pool::{acquire, Pool},
    repositories::{
        mcp_tool_group_attachments::{self as mtg_attach, McpGroupAttachScope},
        mcp_tool_groups::{self as repo, McpToolGroupDraft, McpToolGroupPatch, McpToolGroupRow},
    },
};
use rusqlite::TransactionBehavior;

use crate::{
    error::AppError,
    error_map::{map_db_err, validate_non_empty, validate_optional_color},
};

/// MCP-tool-groups use case.
pub struct McpToolGroupsUseCase<'a> {
    pool: &'a Pool,
}

impl<'a> McpToolGroupsUseCase<'a> {
    /// Constructor.
    #[must_use]
    pub fn new(pool: &'a Pool) -> Self {
        Self { pool }
    }

    /// List every group, ordered by position then name.
    ///
    /// # Errors
    ///
    /// Forwards storage-layer errors.
    pub fn list(&self) -> Result<Vec<McpToolGroup>, AppError> {
        let conn = acquire(self.pool).map_err(map_db_err)?;
        let rows = repo::list(&conn).map_err(map_db_err)?;
        Ok(rows.into_iter().map(row_to_group).collect())
    }

    /// Look up a group by id.
    ///
    /// # Errors
    ///
    /// `AppError::NotFound` if the id is absent.
    pub fn get(&self, id: &str) -> Result<McpToolGroup, AppError> {
        let conn = acquire(self.pool).map_err(map_db_err)?;
        match repo::get(&conn, id).map_err(map_db_err)? {
            Some(row) => Ok(row_to_group(row)),
            None => Err(AppError::NotFound {
                entity: "mcp_tool_group".into(),
                id: id.to_owned(),
            }),
        }
    }

    /// Create a group. `position` defaults to `0` when `None`.
    ///
    /// # Errors
    ///
    /// `AppError::Validation` for empty name or bad colour.
    #[allow(clippy::needless_pass_by_value)]
    pub fn create(
        &self,
        name: String,
        color: Option<String>,
        icon: Option<String>,
        position: Option<i64>,
    ) -> Result<McpToolGroup, AppError> {
        let trimmed = validate_non_empty("name", &name)?;
        validate_optional_color("color", color.as_deref())?;
        let conn = acquire(self.pool).map_err(map_db_err)?;
        let row = repo::insert(
            &conn,
            &McpToolGroupDraft {
                name: trimmed,
                color,
                icon,
                position: position.unwrap_or(0),
            },
        )
        .map_err(map_db_err)?;
        Ok(row_to_group(row))
    }

    /// Partial update.
    ///
    /// # Errors
    ///
    /// `AppError::NotFound` if the id is absent; `AppError::Validation`
    /// for empty name or bad colour.
    #[allow(clippy::needless_pass_by_value)]
    pub fn update(
        &self,
        id: String,
        name: Option<String>,
        color: Option<Option<String>>,
        icon: Option<Option<String>>,
        position: Option<i64>,
    ) -> Result<McpToolGroup, AppError> {
        if let Some(n) = name.as_deref() {
            validate_non_empty("name", n)?;
        }
        if let Some(Some(c)) = color.as_ref() {
            validate_optional_color("color", Some(c))?;
        }
        let conn = acquire(self.pool).map_err(map_db_err)?;
        let patch = McpToolGroupPatch {
            name: name.map(|n| n.trim().to_owned()),
            color,
            icon,
            position,
        };
        match repo::update(&conn, &id, &patch).map_err(map_db_err)? {
            Some(row) => Ok(row_to_group(row)),
            None => Err(AppError::NotFound {
                entity: "mcp_tool_group".into(),
                id,
            }),
        }
    }

    /// Delete a group. Clears its materialised rows + recomputes counts
    /// before dropping the row (the on-delete trigger sweeps rows
    /// defensively but leaves counts stale).
    ///
    /// # Errors
    ///
    /// `AppError::NotFound` if the id is absent.
    pub fn delete(&self, id: &str) -> Result<(), AppError> {
        let mut conn = acquire(self.pool).map_err(map_db_err)?;
        let tx = conn
            .transaction_with_behavior(TransactionBehavior::Immediate)
            .map_err(|e| map_db_err(e.into()))?;
        mtg_attach::clear_group_everywhere(&tx, id).map_err(map_db_err)?;
        let removed = repo::delete(&tx, id).map_err(map_db_err)?;
        if !removed {
            return Err(AppError::NotFound {
                entity: "mcp_tool_group".into(),
                id: id.to_owned(),
            });
        }
        tx.commit().map_err(|e| map_db_err(e.into()))?;
        Ok(())
    }

    // ------------------------------------------------------------------
    // Member management (re-materialise on every change — live link)
    // ------------------------------------------------------------------

    /// Return ordered MCP-tool ids for a group.
    ///
    /// # Errors
    ///
    /// Forwards storage-layer errors.
    pub fn list_members(&self, group_id: &str) -> Result<Vec<String>, AppError> {
        let conn = acquire(self.pool).map_err(map_db_err)?;
        repo::list_members(&conn, group_id).map_err(map_db_err)
    }

    /// Add an MCP tool to a group; re-materialise everywhere attached.
    ///
    /// # Errors
    ///
    /// `AppError::TransactionRolledBack` on FK violation.
    #[allow(clippy::needless_pass_by_value)]
    pub fn add_member(
        &self,
        group_id: String,
        mcp_tool_id: String,
        position: i64,
    ) -> Result<(), AppError> {
        let mut conn = acquire(self.pool).map_err(map_db_err)?;
        let tx = conn
            .transaction_with_behavior(TransactionBehavior::Immediate)
            .map_err(|e| map_db_err(e.into()))?;
        repo::add_member(&tx, &group_id, &mcp_tool_id, position).map_err(map_db_err)?;
        mtg_attach::rematerialize_mcp_tool_group(&tx, &group_id).map_err(map_db_err)?;
        tx.commit().map_err(|e| map_db_err(e.into()))?;
        Ok(())
    }

    /// Remove an MCP tool from a group; re-materialise everywhere attached.
    ///
    /// # Errors
    ///
    /// `AppError::NotFound` if no row matched.
    #[allow(clippy::needless_pass_by_value)]
    pub fn remove_member(&self, group_id: String, mcp_tool_id: String) -> Result<(), AppError> {
        let mut conn = acquire(self.pool).map_err(map_db_err)?;
        let tx = conn
            .transaction_with_behavior(TransactionBehavior::Immediate)
            .map_err(|e| map_db_err(e.into()))?;
        let removed = repo::remove_member(&tx, &group_id, &mcp_tool_id).map_err(map_db_err)?;
        if !removed {
            return Err(AppError::NotFound {
                entity: "mcp_tool_group_member".into(),
                id: format!("{group_id}|{mcp_tool_id}"),
            });
        }
        mtg_attach::rematerialize_mcp_tool_group(&tx, &group_id).map_err(map_db_err)?;
        tx.commit().map_err(|e| map_db_err(e.into()))?;
        Ok(())
    }

    /// Atomically replace the member list; re-materialise everywhere.
    ///
    /// # Errors
    ///
    /// `AppError::TransactionRolledBack` on FK violation.
    #[allow(clippy::needless_pass_by_value)]
    pub fn set_members(
        &self,
        group_id: String,
        ordered_tool_ids: Vec<String>,
    ) -> Result<(), AppError> {
        let mut conn = acquire(self.pool).map_err(map_db_err)?;
        let tx = conn
            .transaction_with_behavior(TransactionBehavior::Immediate)
            .map_err(|e| map_db_err(e.into()))?;
        repo::set_members(&tx, &group_id, &ordered_tool_ids).map_err(map_db_err)?;
        mtg_attach::rematerialize_mcp_tool_group(&tx, &group_id).map_err(map_db_err)?;
        tx.commit().map_err(|e| map_db_err(e.into()))?;
        Ok(())
    }

    // ------------------------------------------------------------------
    // Group attachment (group as a live unit at role / board / task)
    // ------------------------------------------------------------------

    #[allow(clippy::needless_pass_by_value)]
    fn set_groups_at(
        &self,
        scope: McpGroupAttachScope,
        group_ids: Vec<String>,
    ) -> Result<(), AppError> {
        let mut conn = acquire(self.pool).map_err(map_db_err)?;
        let tx = conn
            .transaction_with_behavior(TransactionBehavior::Immediate)
            .map_err(|e| map_db_err(e.into()))?;
        mtg_attach::set_groups_at(&tx, &scope, &group_ids).map_err(map_db_err)?;
        tx.commit().map_err(|e| map_db_err(e.into()))?;
        Ok(())
    }

    /// Set the MCP-tool groups attached to a role.
    ///
    /// # Errors
    ///
    /// Surfaces storage-layer errors.
    #[allow(clippy::needless_pass_by_value)]
    pub fn set_role_groups(&self, role_id: String, group_ids: Vec<String>) -> Result<(), AppError> {
        self.set_groups_at(McpGroupAttachScope::Role(role_id), group_ids)
    }

    /// Set the MCP-tool groups attached to a board.
    ///
    /// # Errors
    ///
    /// Surfaces storage-layer errors.
    #[allow(clippy::needless_pass_by_value)]
    pub fn set_board_groups(
        &self,
        board_id: String,
        group_ids: Vec<String>,
    ) -> Result<(), AppError> {
        self.set_groups_at(McpGroupAttachScope::Board(board_id), group_ids)
    }

    /// Set the MCP-tool groups attached directly to a task.
    ///
    /// # Errors
    ///
    /// Surfaces storage-layer errors.
    #[allow(clippy::needless_pass_by_value)]
    pub fn set_task_groups(&self, task_id: String, group_ids: Vec<String>) -> Result<(), AppError> {
        self.set_groups_at(McpGroupAttachScope::Task(task_id), group_ids)
    }

    /// List the MCP-tool groups attached at a role.
    ///
    /// # Errors
    ///
    /// Surfaces storage-layer errors.
    pub fn list_role_groups(&self, role_id: &str) -> Result<Vec<String>, AppError> {
        let conn = acquire(self.pool).map_err(map_db_err)?;
        mtg_attach::list_groups_at(&conn, &McpGroupAttachScope::Role(role_id.to_owned()))
            .map_err(map_db_err)
    }

    /// List the MCP-tool groups attached at a board.
    ///
    /// # Errors
    ///
    /// Surfaces storage-layer errors.
    pub fn list_board_groups(&self, board_id: &str) -> Result<Vec<String>, AppError> {
        let conn = acquire(self.pool).map_err(map_db_err)?;
        mtg_attach::list_groups_at(&conn, &McpGroupAttachScope::Board(board_id.to_owned()))
            .map_err(map_db_err)
    }

    /// List the MCP-tool groups attached directly to a task.
    ///
    /// # Errors
    ///
    /// Surfaces storage-layer errors.
    pub fn list_task_groups(&self, task_id: &str) -> Result<Vec<String>, AppError> {
        let conn = acquire(self.pool).map_err(map_db_err)?;
        mtg_attach::list_groups_at(&conn, &McpGroupAttachScope::Task(task_id.to_owned()))
            .map_err(map_db_err)
    }
}

fn row_to_group(row: McpToolGroupRow) -> McpToolGroup {
    McpToolGroup {
        id: row.id,
        name: row.name,
        color: row.color,
        icon: row.icon,
        position: row.position,
        created_at: row.created_at,
        updated_at: row.updated_at,
    }
}
