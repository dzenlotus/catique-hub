//! Tasks use case.
//!
//! Wave-E2.4 (Olga). Slug generation lives in the repository
//! (`<space-prefix>-<sequential-int>`, per-space, MAX+1 — see
//! `repositories::tasks`). The use case validates inputs and pre-checks
//! parent existence so `NotFound` is typed.

use catique_domain::{
    McpTool, McpToolWithOrigin, OriginRef, Prompt, PromptWithOrigin, Role, Skill, SkillWithOrigin,
    Task, TaskBundle, TaskRating,
};
use catique_infrastructure::db::{
    pool::{acquire, Pool},
    repositories::mcp_tools::{self as mcp_tools_repo, McpToolRow},
    repositories::prompts::{self as prompts_repo, PromptRow},
    repositories::roles::RoleRow,
    repositories::skills::{self as skills_repo, SkillRow},
    repositories::task_overrides_v2::{self as overrides_v2_repo},
    repositories::task_ratings::{self as ratings_repo, TaskRatingRow},
    repositories::tasks::{
        self as repo, ResolvedMcpToolRow, ResolvedPromptRow, ResolvedSkillRow, TaskDraft,
        TaskPatch, TaskRow,
    },
};
use rusqlite::params;

use crate::{
    error::AppError,
    error_map::{map_db_err, validate_non_empty},
};

/// Tasks use case.
pub struct TasksUseCase<'a> {
    pool: &'a Pool,
}

impl<'a> TasksUseCase<'a> {
    /// Constructor.
    #[must_use]
    pub fn new(pool: &'a Pool) -> Self {
        Self { pool }
    }

    /// List every task.
    ///
    /// # Errors
    ///
    /// Forwards storage-layer errors.
    pub fn list(&self) -> Result<Vec<Task>, AppError> {
        let conn = acquire(self.pool).map_err(map_db_err)?;
        let rows = repo::list_all(&conn).map_err(map_db_err)?;
        Ok(rows.into_iter().map(row_to_task).collect())
    }

    /// Look up a task by id.
    ///
    /// # Errors
    ///
    /// `AppError::NotFound` if missing.
    pub fn get(&self, id: &str) -> Result<Task, AppError> {
        let conn = acquire(self.pool).map_err(map_db_err)?;
        match repo::get_by_id(&conn, id).map_err(map_db_err)? {
            Some(row) => Ok(row_to_task(row)),
            None => Err(AppError::NotFound {
                entity: "task".into(),
                id: id.to_owned(),
            }),
        }
    }

    /// Create a task.
    ///
    /// # Errors
    ///
    /// `AppError::Validation` for empty title; `AppError::NotFound` for
    /// missing `board_id` / `column_id`.
    #[allow(clippy::needless_pass_by_value)]
    pub fn create(
        &self,
        board_id: String,
        column_id: String,
        title: String,
        description: Option<String>,
        position: f64,
        role_id: Option<String>,
    ) -> Result<Task, AppError> {
        let trimmed = validate_non_empty("title", &title)?;
        let conn = acquire(self.pool).map_err(map_db_err)?;
        // Pre-check parents so NotFound is typed (the schema would
        // raise a generic FK error otherwise).
        let board_exists: bool = conn
            .query_row(
                "SELECT 1 FROM boards WHERE id = ?1",
                params![board_id],
                |_| Ok(()),
            )
            .map(|()| true)
            .or_else(|e| match e {
                rusqlite::Error::QueryReturnedNoRows => Ok(false),
                other => Err(other),
            })
            .map_err(|e| map_db_err(catique_infrastructure::db::pool::DbError::Sqlite(e)))?;
        if !board_exists {
            return Err(AppError::NotFound {
                entity: "board".into(),
                id: board_id,
            });
        }
        let column_exists: bool = conn
            .query_row(
                "SELECT 1 FROM columns WHERE id = ?1 AND board_id = ?2",
                params![column_id, board_id],
                |_| Ok(()),
            )
            .map(|()| true)
            .or_else(|e| match e {
                rusqlite::Error::QueryReturnedNoRows => Ok(false),
                other => Err(other),
            })
            .map_err(|e| map_db_err(catique_infrastructure::db::pool::DbError::Sqlite(e)))?;
        if !column_exists {
            return Err(AppError::NotFound {
                entity: "column".into(),
                id: column_id,
            });
        }
        let row = repo::insert(
            &conn,
            &TaskDraft {
                board_id,
                column_id,
                title: trimmed,
                description,
                position,
                role_id,
            },
        )
        .map_err(map_db_err)?;
        Ok(row_to_task(row))
    }

    /// Partial update.
    ///
    /// # Errors
    ///
    /// `AppError::NotFound` if id missing.
    #[allow(clippy::needless_pass_by_value)]
    pub fn update(
        &self,
        id: String,
        title: Option<String>,
        description: Option<Option<String>>,
        column_id: Option<String>,
        position: Option<f64>,
        role_id: Option<Option<String>>,
    ) -> Result<Task, AppError> {
        if let Some(t) = title.as_deref() {
            validate_non_empty("title", t)?;
        }
        let conn = acquire(self.pool).map_err(map_db_err)?;
        let patch = TaskPatch {
            title: title.map(|t| t.trim().to_owned()),
            description,
            column_id,
            position,
            role_id,
        };
        match repo::update(&conn, &id, &patch).map_err(map_db_err)? {
            Some(row) => Ok(row_to_task(row)),
            None => Err(AppError::NotFound {
                entity: "task".into(),
                id,
            }),
        }
    }

    /// Promptery-compat shape: move a task to `column_id`, optionally
    /// repositioning it. Mirrors Promptery's MCP `move_task(task_id,
    /// column_id, position)` so agents written against that catalogue
    /// land here without a wire-shape translation step.
    ///
    /// Within a single board this is a thin wrapper around `update`.
    /// Across boards, the destination column may live on a different
    /// `board_id` than the task's current row — `update` only patches
    /// `column_id`, leaving `tasks.board_id` stale (audit F-10 / ctq-107).
    /// We resolve the new column's owning `board_id` up-front and patch
    /// it in the same connection so the row stays internally consistent.
    ///
    /// **Preserved across the move:** `task.role_id` (task-level role
    /// stays put), every direct `task_prompts` row (`origin = 'direct'`
    /// is independent of column/board scope). Inherited `task_prompts`
    /// rows (board/column origin) are *not* re-cascaded here — that's
    /// resolver-internals territory (ctq-98) and lies outside this
    /// alias's contract; the brief explicitly scopes the guarantee to
    /// task-level role + direct prompts.
    ///
    /// # Errors
    ///
    /// * `AppError::NotFound` — `task_id` or `column_id` does not exist.
    /// * Storage-layer errors as usual.
    #[allow(clippy::needless_pass_by_value)]
    pub fn move_task(
        &self,
        task_id: String,
        column_id: String,
        position: Option<f64>,
    ) -> Result<Task, AppError> {
        let conn = acquire(self.pool).map_err(map_db_err)?;

        // Resolve the destination column → typed NotFound for missing
        // columns (the FK on `tasks.column_id` would otherwise produce
        // a generic constraint error mapped to TransactionRolledBack).
        let column_board_id: Option<String> = conn
            .query_row(
                "SELECT board_id FROM columns WHERE id = ?1",
                params![column_id],
                |r| r.get::<_, String>(0),
            )
            .map(Some)
            .or_else(|e| match e {
                rusqlite::Error::QueryReturnedNoRows => Ok(None),
                other => Err(other),
            })
            .map_err(|e| map_db_err(catique_infrastructure::db::pool::DbError::Sqlite(e)))?;
        let new_board_id = column_board_id.ok_or_else(|| AppError::NotFound {
            entity: "column".into(),
            id: column_id.clone(),
        })?;

        // Pre-check the task itself so a missing row surfaces as a
        // typed NotFound rather than letting `repo::update` return
        // Ok(None) (which we would also map to NotFound, but doing the
        // SELECT here keeps the path linear).
        let existing = repo::get_by_id(&conn, &task_id)
            .map_err(map_db_err)?
            .ok_or_else(|| AppError::NotFound {
                entity: "task".into(),
                id: task_id.clone(),
            })?;

        // Cross-board move: patch board_id directly. `TaskPatch` does
        // not expose `board_id` (intentional — most callers shouldn't
        // mutate it). Doing the UPDATE here keeps the special case
        // local to `move_task` and avoids widening the patch surface.
        if existing.board_id != new_board_id {
            conn.execute(
                "UPDATE tasks SET board_id = ?1 WHERE id = ?2",
                params![new_board_id, task_id],
            )
            .map_err(|e| map_db_err(catique_infrastructure::db::pool::DbError::Sqlite(e)))?;
        }

        let patch = TaskPatch {
            title: None,
            description: None,
            column_id: Some(column_id),
            position,
            role_id: None,
        };
        match repo::update(&conn, &task_id, &patch).map_err(map_db_err)? {
            Some(row) => Ok(row_to_task(row)),
            None => Err(AppError::NotFound {
                entity: "task".into(),
                id: task_id,
            }),
        }
    }

    /// Route a task to a target board, dropping it into the board's
    /// default column. D-006 (migration
    /// `016_default_board_naming_and_constraints.sql`): every board
    /// carries exactly one `is_default = 1` column, so cross-board
    /// kanban drag-drop can always land somewhere without the caller
    /// having to resolve the destination column up-front.
    ///
    /// Position defaults to `0.0` — the front of the destination
    /// column. The caller can re-position via a follow-up `move_task`
    /// if a more specific slot matters.
    ///
    /// **Preserved across the route:** task-level `role_id`, every
    /// direct `task_prompts` row (`origin = 'direct'`). Inherited
    /// rows (board/column origin) are not re-cascaded — same contract
    /// as `move_task`.
    ///
    /// # Errors
    ///
    /// * `AppError::NotFound` — `task_id` or `target_board_id` does
    ///   not exist, or the target board has no default column (a
    ///   data-corruption signal — migration 016 guarantees one exists).
    /// * Storage-layer errors as usual.
    #[allow(clippy::needless_pass_by_value)]
    pub fn route_task_to_board(
        &self,
        task_id: String,
        target_board_id: String,
    ) -> Result<Task, AppError> {
        let conn = acquire(self.pool).map_err(map_db_err)?;

        // Resolve the destination board's default column. Pre-check
        // the board itself so a missing target surfaces as a typed
        // `NotFound { entity: "board" }` rather than the more cryptic
        // "no default column" branch below.
        let board_exists: bool = conn
            .query_row(
                "SELECT 1 FROM boards WHERE id = ?1",
                params![target_board_id],
                |_| Ok(()),
            )
            .map(|()| true)
            .or_else(|e| match e {
                rusqlite::Error::QueryReturnedNoRows => Ok(false),
                other => Err(other),
            })
            .map_err(|e| map_db_err(catique_infrastructure::db::pool::DbError::Sqlite(e)))?;
        if !board_exists {
            return Err(AppError::NotFound {
                entity: "board".into(),
                id: target_board_id,
            });
        }

        let default_column_id: String = conn
            .query_row(
                "SELECT id FROM columns WHERE board_id = ?1 AND is_default = 1 \
                 ORDER BY position ASC LIMIT 1",
                params![target_board_id],
                |r| r.get::<_, String>(0),
            )
            .map(Some)
            .or_else(|e| match e {
                rusqlite::Error::QueryReturnedNoRows => Ok(None),
                other => Err(other),
            })
            .map_err(|e| map_db_err(catique_infrastructure::db::pool::DbError::Sqlite(e)))?
            .ok_or_else(|| AppError::NotFound {
                entity: "default_column".into(),
                id: target_board_id.clone(),
            })?;

        // Reuse `move_task` so the cross-board board_id patch and the
        // direct-prompt preservation contract stay one path.
        drop(conn);
        self.move_task(task_id, default_column_id, Some(0.0))
    }

    /// List the prompts attached to a task, ordered by join-table `position`.
    ///
    /// # Errors
    ///
    /// Forwards storage-layer errors.
    pub fn list_task_prompts(&self, task_id: &str) -> Result<Vec<Prompt>, AppError> {
        let conn = acquire(self.pool).map_err(map_db_err)?;
        let rows = repo::list_task_prompts(&conn, task_id).map_err(map_db_err)?;
        Ok(rows.into_iter().map(prompt_row_to_prompt).collect())
    }

    /// Resolve the full agent bundle for one task: the task row, its
    /// active role (task > column > board fallback), and the
    /// deduplicated, origin-tagged prompt set ready for assembly into
    /// the LLM payload.
    ///
    /// This is the head consumer of ADR-0006's write-time materialisation
    /// strategy — every prompt seen here was already INSERTed into
    /// `task_prompts` at attach-time by the corresponding scope's
    /// cascade helper. The hot path is a single index seek on
    /// `idx_task_prompts_task` plus a primary-key join into `prompts`;
    /// the override rule ("direct beats inherited") is applied in Rust
    /// after the fetch so the SQL plan stays trivial.
    ///
    /// # Override semantics
    ///
    /// If the same `prompt_id` appears under multiple origins (e.g. a
    /// prompt was attached directly AND inherited from the role), only
    /// the highest-precedence row is returned. Precedence: `Direct >
    /// Role > Column > Board > Space`.
    ///
    /// # Errors
    ///
    /// `AppError::NotFound` if `task_id` does not exist; storage-layer
    /// errors as usual.
    pub fn resolve_task_bundle(&self, task_id: &str) -> Result<TaskBundle, AppError> {
        let conn = acquire(self.pool).map_err(map_db_err)?;
        let row = repo::get_by_id(&conn, task_id)
            .map_err(map_db_err)?
            .ok_or_else(|| AppError::NotFound {
                entity: "task".into(),
                id: task_id.to_owned(),
            })?;
        let role_row = repo::resolve_active_role(&conn, task_id).map_err(map_db_err)?;
        let prompt_rows = repo::resolve_task_prompts(&conn, task_id).map_err(map_db_err)?;
        let skill_rows = repo::resolve_task_skills(&conn, task_id).map_err(map_db_err)?;
        let mcp_tool_rows = repo::resolve_task_mcp_tools(&conn, task_id).map_err(map_db_err)?;
        // refactor-v3 D-A — read the three override surfaces. We resolve
        // each replacement entity up-front here (one query per kind) so
        // `assemble_bundle` stays a pure data shaper. Suppression rows
        // need no lookup; replacement rows need the substituted entity
        // body to swap into the bundle.
        let prompt_overrides =
            overrides_v2_repo::list_task_prompt_overrides_v2(&conn, task_id).map_err(map_db_err)?;
        let skill_overrides =
            overrides_v2_repo::list_task_skill_overrides_v2(&conn, task_id).map_err(map_db_err)?;
        let mcp_tool_overrides = overrides_v2_repo::list_task_mcp_tool_overrides_v2(&conn, task_id)
            .map_err(map_db_err)?;
        // Hydrate replacement entities in one batch each. The
        // hashmap-based lookup keeps the post-pass O(n) over rows.
        let prompt_replacements = hydrate_prompts(
            &conn,
            prompt_overrides
                .iter()
                .filter_map(|o| o.replacement_prompt_id.as_deref()),
        )?;
        let skill_replacements = hydrate_skills(
            &conn,
            skill_overrides
                .iter()
                .filter_map(|o| o.replacement_skill_id.as_deref()),
        )?;
        let mcp_tool_replacements = hydrate_mcp_tools(
            &conn,
            mcp_tool_overrides
                .iter()
                .filter_map(|o| o.replacement_tool_id.as_deref()),
        )?;
        Ok(assemble_bundle(
            row,
            role_row,
            prompt_rows,
            skill_rows,
            mcp_tool_rows,
            &BundleOverrides {
                prompts: prompt_overrides,
                skills: skill_overrides,
                mcp_tools: mcp_tool_overrides,
                prompt_replacements,
                skill_replacements,
                mcp_tool_replacements,
            },
        ))
    }

    /// Set a per-task prompt override (refactor-v3 D-A).
    ///
    /// `replacement_prompt_id = None` suppresses the inherited prompt;
    /// `Some(id)` substitutes it with the named prompt at read time. The
    /// underlying UPSERT means calling this twice for the same
    /// `(task_id, source_prompt_id)` flips suppress ↔ replace atomically.
    ///
    /// Pre-checks task existence so the typed error path is consistent
    /// across the override surface.
    ///
    /// # Errors
    ///
    /// * `AppError::NotFound` — `task_id` does not exist.
    /// * `AppError::TransactionRolledBack` — FK violation on
    ///   `source_prompt_id` / `replacement_prompt_id`.
    pub fn set_task_prompt_override_v2(
        &self,
        task_id: &str,
        source_prompt_id: &str,
        replacement_prompt_id: Option<&str>,
    ) -> Result<(), AppError> {
        let conn = acquire(self.pool).map_err(map_db_err)?;
        Self::guard_task_exists(&conn, task_id)?;
        overrides_v2_repo::set_task_prompt_override_v2(
            &conn,
            task_id,
            source_prompt_id,
            replacement_prompt_id,
        )
        .map_err(map_db_err)?;
        // Refactor-v3 D-B: a suppress override decrements the prompt
        // counter, a replace leaves it unchanged. The recompute helper
        // applies both rules from one source of truth.
        repo::recompute_effective_counts(&conn, task_id).map_err(map_db_err)?;
        Ok(())
    }

    /// Clear a per-task prompt override (refactor-v3 D-A).
    ///
    /// # Errors
    ///
    /// * `AppError::NotFound` — no override existed for the
    ///   `(task_id, source_prompt_id)` pair.
    pub fn clear_task_prompt_override_v2(
        &self,
        task_id: &str,
        source_prompt_id: &str,
    ) -> Result<(), AppError> {
        let conn = acquire(self.pool).map_err(map_db_err)?;
        let cleared =
            overrides_v2_repo::clear_task_prompt_override_v2(&conn, task_id, source_prompt_id)
                .map_err(map_db_err)?;
        if cleared {
            // D-B: clearing a suppress override re-enables the inherited
            // prompt, bumping the count back up. Replace overrides also
            // route through here, but their cardinality contribution
            // was zero, so the recompute is a no-op for them.
            repo::recompute_effective_counts(&conn, task_id).map_err(map_db_err)?;
            Ok(())
        } else {
            Err(AppError::NotFound {
                entity: "task_prompt_override_v2".into(),
                id: format!("{task_id}|{source_prompt_id}"),
            })
        }
    }

    /// Set a per-task skill override (refactor-v3 D-A). Mirror of
    /// [`Self::set_task_prompt_override_v2`].
    ///
    /// # Errors
    ///
    /// See [`Self::set_task_prompt_override_v2`].
    pub fn set_task_skill_override_v2(
        &self,
        task_id: &str,
        source_skill_id: &str,
        replacement_skill_id: Option<&str>,
    ) -> Result<(), AppError> {
        let conn = acquire(self.pool).map_err(map_db_err)?;
        Self::guard_task_exists(&conn, task_id)?;
        overrides_v2_repo::set_task_skill_override_v2(
            &conn,
            task_id,
            source_skill_id,
            replacement_skill_id,
        )
        .map_err(map_db_err)?;
        repo::recompute_effective_counts(&conn, task_id).map_err(map_db_err)?;
        Ok(())
    }

    /// Clear a per-task skill override (refactor-v3 D-A).
    ///
    /// # Errors
    ///
    /// `AppError::NotFound` if no row matched.
    pub fn clear_task_skill_override_v2(
        &self,
        task_id: &str,
        source_skill_id: &str,
    ) -> Result<(), AppError> {
        let conn = acquire(self.pool).map_err(map_db_err)?;
        let cleared =
            overrides_v2_repo::clear_task_skill_override_v2(&conn, task_id, source_skill_id)
                .map_err(map_db_err)?;
        if cleared {
            repo::recompute_effective_counts(&conn, task_id).map_err(map_db_err)?;
            Ok(())
        } else {
            Err(AppError::NotFound {
                entity: "task_skill_override_v2".into(),
                id: format!("{task_id}|{source_skill_id}"),
            })
        }
    }

    /// Set a per-task mcp-tool override (refactor-v3 D-A). Mirror of
    /// [`Self::set_task_prompt_override_v2`].
    ///
    /// # Errors
    ///
    /// See [`Self::set_task_prompt_override_v2`].
    pub fn set_task_mcp_tool_override_v2(
        &self,
        task_id: &str,
        source_tool_id: &str,
        replacement_tool_id: Option<&str>,
    ) -> Result<(), AppError> {
        let conn = acquire(self.pool).map_err(map_db_err)?;
        Self::guard_task_exists(&conn, task_id)?;
        overrides_v2_repo::set_task_mcp_tool_override_v2(
            &conn,
            task_id,
            source_tool_id,
            replacement_tool_id,
        )
        .map_err(map_db_err)?;
        repo::recompute_effective_counts(&conn, task_id).map_err(map_db_err)?;
        Ok(())
    }

    /// Clear a per-task mcp-tool override (refactor-v3 D-A).
    ///
    /// # Errors
    ///
    /// `AppError::NotFound` if no row matched.
    pub fn clear_task_mcp_tool_override_v2(
        &self,
        task_id: &str,
        source_tool_id: &str,
    ) -> Result<(), AppError> {
        let conn = acquire(self.pool).map_err(map_db_err)?;
        let cleared =
            overrides_v2_repo::clear_task_mcp_tool_override_v2(&conn, task_id, source_tool_id)
                .map_err(map_db_err)?;
        if cleared {
            repo::recompute_effective_counts(&conn, task_id).map_err(map_db_err)?;
            Ok(())
        } else {
            Err(AppError::NotFound {
                entity: "task_mcp_tool_override_v2".into(),
                id: format!("{task_id}|{source_tool_id}"),
            })
        }
    }

    /// Pre-check helper for the override-v2 setters — surfaces a typed
    /// `NotFound { entity: "task" }` instead of an FK constraint error.
    /// Associated function (no `self`) because the pool is already
    /// dereferenced into a `Connection` by the caller.
    fn guard_task_exists(conn: &rusqlite::Connection, task_id: &str) -> Result<(), AppError> {
        if repo::get_by_id(conn, task_id)
            .map_err(map_db_err)?
            .is_none()
        {
            return Err(AppError::NotFound {
                entity: "task".into(),
                id: task_id.to_owned(),
            });
        }
        Ok(())
    }

    /// Delete a task.
    ///
    /// **Metadata-only.** `task_attachments` rows are cascaded by the
    /// `ON DELETE CASCADE` clause on the FK (`001_initial.sql:292`), but
    /// the on-disk directory `<app_data>/attachments/<task_id>/` is
    /// *not* touched. Use [`TasksUseCase::delete_with_attachments`] from
    /// the IPC layer so blobs are reaped in lock-step with the cascade.
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
                entity: "task".into(),
                id: id.to_owned(),
            })
        }
    }

    /// Read the urgency level for a task. catique-8 — returned as a
    /// plain string ('none' | 'low' | 'medium' | 'high'). Useful for
    /// the IPC + MCP read path until urgency lands on `Task` proper.
    ///
    /// # Errors
    ///
    /// `AppError::NotFound` if the task id is unknown.
    pub fn get_urgency(&self, id: &str) -> Result<String, AppError> {
        let conn = acquire(self.pool).map_err(map_db_err)?;
        repo::get_urgency(&conn, id)
            .map_err(map_db_err)?
            .ok_or_else(|| AppError::NotFound {
                entity: "task".into(),
                id: id.to_owned(),
            })
    }

    /// Set the urgency level for a task. catique-8 — validates the
    /// urgency string up front so the typed error path is consistent
    /// with the rest of the surface; the SQL CHECK at the storage
    /// layer is a defence-in-depth backstop.
    ///
    /// # Errors
    ///
    /// * `AppError::Validation` — `urgency` is not in the canonical set.
    /// * `AppError::NotFound` — task id is unknown.
    pub fn set_urgency(&self, id: &str, urgency: &str) -> Result<String, AppError> {
        let canonical = match urgency {
            "none" | "low" | "medium" | "high" => urgency,
            _ => {
                return Err(AppError::Validation {
                    field: "urgency".into(),
                    reason: "must be one of: none, low, medium, high".into(),
                });
            }
        };
        let conn = acquire(self.pool).map_err(map_db_err)?;
        let updated = repo::set_urgency(&conn, id, canonical).map_err(map_db_err)?;
        if !updated {
            return Err(AppError::NotFound {
                entity: "task".into(),
                id: id.to_owned(),
            });
        }
        Ok(canonical.to_owned())
    }

    /// Delete a task **and** unlink its on-disk attachment directory.
    ///
    /// `attachments_root` is `$APPLOCALDATA/catique/attachments`. The
    /// per-task subdirectory is `<root>/<task_id>/`. After the row +
    /// FK-cascaded metadata are removed, the on-disk directory is
    /// removed via `std::fs::remove_dir_all` if it exists. Failures
    /// during the directory removal are logged but never bubble — the
    /// row delete is the source of truth and a half-cleaned attachments
    /// dir is the same orphan-state the per-attachment delete handles
    /// via `delete_with_blob`.
    ///
    /// # Errors
    ///
    /// `AppError::NotFound` if id is unknown.
    pub fn delete_with_attachments(
        &self,
        id: &str,
        attachments_root: &std::path::Path,
    ) -> Result<(), AppError> {
        // Order: DB delete first (row + FK cascade) → FS cleanup. If we
        // tried it the other way and the DB delete failed, we'd have an
        // entry that points at a missing directory.
        self.delete(id)?;
        let task_dir = attachments_root.join(id);
        if task_dir.exists() {
            if let Err(e) = std::fs::remove_dir_all(&task_dir) {
                eprintln!(
                    "[catique-hub] delete_task: failed to remove attachment dir {}: {}",
                    task_dir.display(),
                    e
                );
            }
        }
        Ok(())
    }

    /// Append one step-log line to `task_id`. Cat-as-Agent Phase 1 —
    /// the working cat (or sidecar agent) emits a one-line summary
    /// each time it advances the task; lines accumulate until the
    /// task is rated and archived.
    ///
    /// `summary` is validated for length (≤ 50 000 chars per NFR §4.2);
    /// task existence is pre-checked so the caller gets a typed
    /// `NotFound` rather than a silent zero-row UPDATE.
    ///
    /// # Errors
    ///
    /// * `AppError::Validation` — `summary` exceeds the length cap.
    /// * `AppError::NotFound`   — task id does not exist.
    /// * Storage-layer errors as usual.
    #[allow(clippy::needless_pass_by_value)]
    pub fn log_step(&self, task_id: String, summary: String) -> Result<(), AppError> {
        if summary.len() > STEP_LOG_SUMMARY_MAX_LEN {
            return Err(AppError::Validation {
                field: "summary".into(),
                reason: format!("must be at most {STEP_LOG_SUMMARY_MAX_LEN} characters"),
            });
        }
        let conn = acquire(self.pool).map_err(map_db_err)?;
        // Pre-check existence so missing-task surfaces as NotFound
        // rather than as a silent zero-row UPDATE.
        if repo::get_by_id(&conn, &task_id)
            .map_err(map_db_err)?
            .is_none()
        {
            return Err(AppError::NotFound {
                entity: "task".into(),
                id: task_id,
            });
        }
        let now = now_unix_ms();
        repo::append_step_log(&conn, &task_id, &summary, now).map_err(map_db_err)
    }

    /// Set or clear the rating for `task_id`. Three-state quality
    /// signal stored as `Option<i8>` per memo Q4 — see
    /// `task_ratings::set_rating` for the UPSERT semantic.
    ///
    /// Validates `rating ∈ {-1, 0, 1, None}` at the use-case layer
    /// (the schema CHECK is the second line of defence). Pre-checks
    /// task existence so a missing id produces a typed `NotFound`
    /// rather than an FK error.
    ///
    /// # Errors
    ///
    /// * `AppError::Validation` — `rating` is out of range.
    /// * `AppError::NotFound`   — task id does not exist.
    /// * Storage-layer errors as usual.
    #[allow(clippy::needless_pass_by_value)]
    pub fn rate_task(&self, task_id: String, rating: Option<i8>) -> Result<(), AppError> {
        if let Some(v) = rating {
            if !matches!(v, -1..=1) {
                return Err(AppError::Validation {
                    field: "rating".into(),
                    reason: "must be one of -1, 0, +1, or null".into(),
                });
            }
        }
        let conn = acquire(self.pool).map_err(map_db_err)?;
        if repo::get_by_id(&conn, &task_id)
            .map_err(map_db_err)?
            .is_none()
        {
            return Err(AppError::NotFound {
                entity: "task".into(),
                id: task_id,
            });
        }
        ratings_repo::set_rating(&conn, &task_id, rating).map_err(map_db_err)
    }

    /// Look up the rating row for `task_id`. Returns `Ok(None)` for
    /// tasks that have never been rated; the application layer keeps
    /// the unrated/explicit-neutral distinction (memo Q4 / AC-R2).
    ///
    /// # Errors
    ///
    /// Forwards storage-layer errors.
    pub fn get_task_rating(&self, task_id: &str) -> Result<Option<TaskRating>, AppError> {
        let conn = acquire(self.pool).map_err(map_db_err)?;
        Ok(ratings_repo::get_rating(&conn, task_id)
            .map_err(map_db_err)?
            .map(row_to_task_rating))
    }
}

/// Wall-clock unix-ms. Mirrors the repository helper; the use-case
/// layer cannot reach `crate::db::repositories::util::now_millis`
/// because that function is `pub(crate)` (see `util.rs`).
fn now_unix_ms() -> i64 {
    use std::time::{SystemTime, UNIX_EPOCH};
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .ok()
        .and_then(|d| i64::try_from(d.as_millis()).ok())
        .unwrap_or(0)
}

fn prompt_row_to_prompt(row: PromptRow) -> Prompt {
    Prompt {
        id: row.id,
        name: row.name,
        content: row.content,
        color: row.color,
        short_description: row.short_description,
        icon: row.icon,
        examples: row.examples,
        token_count: row.token_count,
        created_at: row.created_at,
        updated_at: row.updated_at,
    }
}

fn skill_row_to_skill(row: SkillRow) -> Skill {
    Skill {
        id: row.id,
        name: row.name,
        description: row.description,
        color: row.color,
        position: row.position,
        created_at: row.created_at,
        updated_at: row.updated_at,
    }
}

fn mcp_tool_row_to_mcp_tool(row: McpToolRow) -> McpTool {
    use catique_domain::McpToolSource;
    use catique_infrastructure::db::repositories::mcp_tools::McpToolSourceRow;
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
            McpToolSourceRow::Upstream => McpToolSource::Upstream,
            McpToolSourceRow::Manual => McpToolSource::Manual,
        },
        last_synced_at: row.last_synced_at,
        created_at: row.created_at,
        updated_at: row.updated_at,
    }
}

fn row_to_task(row: TaskRow) -> Task {
    Task {
        id: row.id,
        board_id: row.board_id,
        column_id: row.column_id,
        slug: row.slug,
        title: row.title,
        description: row.description,
        position: row.position,
        role_id: row.role_id,
        created_at: row.created_at,
        updated_at: row.updated_at,
        step_log: row.step_log,
        // Refactor-v3 D-B: forwarded verbatim. Hot kanban-card read
        // path; computed at write time by application-layer hooks.
        effective_prompt_count: row.effective_prompt_count,
        effective_skill_count: row.effective_skill_count,
        effective_tool_count: row.effective_tool_count,
    }
}

fn row_to_task_rating(row: TaskRatingRow) -> TaskRating {
    TaskRating {
        task_id: row.task_id,
        rating: row.rating,
        rated_at: row.rated_at,
    }
}

fn role_row_to_role(row: RoleRow) -> Role {
    Role {
        id: row.id,
        name: row.name,
        content: row.content,
        color: row.color,
        icon: row.icon,
        created_at: row.created_at,
        updated_at: row.updated_at,
        is_system: row.is_system,
    }
}

/// Resolved override surface for one task (refactor-v3 D-A). Carries
/// the raw rows from the three `_v2` tables plus the hydrated
/// replacement entities indexed by id, so the post-pass can do a
/// constant-time lookup per inherited row without re-querying.
struct BundleOverrides {
    prompts: Vec<overrides_v2_repo::PromptOverrideRow>,
    skills: Vec<overrides_v2_repo::SkillOverrideRow>,
    mcp_tools: Vec<overrides_v2_repo::McpToolOverrideRow>,
    prompt_replacements: std::collections::HashMap<String, Prompt>,
    skill_replacements: std::collections::HashMap<String, Skill>,
    mcp_tool_replacements: std::collections::HashMap<String, McpTool>,
}

/// Assemble a [`TaskBundle`] from the raw rows the resolver returned.
/// Performs the override-rule de-duplication: when the same `prompt_id`
/// appears under multiple origins, the highest-precedence row wins
/// (Direct > Role > Column > Board > Space). Within each origin bucket
/// the relative order from the SQL ORDER BY clause is preserved.
///
/// Refactor-v3 D-A post-pass: after the bundle is built, apply the
/// `task_*_overrides_v2` rows. For each override targeting an entry in
/// the bundle:
///   * `replacement_id IS NULL`     → remove from the bundle and append
///     to the matching `suppressed_*` collection.
///   * `replacement_id IS NOT NULL` → swap the entity body but keep
///     the original `OriginRef`, and flag `overridden = true`.
///
/// Malformed origin strings (the row's `origin` column does not match
/// any known scope) are treated as `Direct` — the only safe fallback
/// that doesn't lose user data; the resolver pre-amble logs the
/// occurrence so debugging is still tractable.
fn assemble_bundle(
    task_row: TaskRow,
    role_row: Option<RoleRow>,
    prompt_rows: Vec<ResolvedPromptRow>,
    skill_rows: Vec<ResolvedSkillRow>,
    mcp_tool_rows: Vec<ResolvedMcpToolRow>,
    overrides: &BundleOverrides,
) -> TaskBundle {
    let prompts = dedup_by_origin_precedence(
        prompt_rows,
        |row| row.prompt.id.clone(),
        |row| (row.origin_raw.clone(), row.position),
        |row, origin, via_group| PromptWithOrigin {
            prompt: prompt_row_to_prompt(row.prompt),
            origin,
            overridden: false,
            via_group,
        },
    );

    let skills = dedup_by_origin_precedence(
        skill_rows,
        |row| row.skill.id.clone(),
        |row| (row.origin_raw.clone(), row.position),
        |row, origin, via_group| SkillWithOrigin {
            skill: skill_row_to_skill(row.skill),
            origin,
            overridden: false,
            via_group,
        },
    );

    let mcp_tools = dedup_by_origin_precedence(
        mcp_tool_rows,
        |row| row.mcp_tool.id.clone(),
        |row| (row.origin_raw.clone(), row.position),
        |row, origin, via_group| McpToolWithOrigin {
            mcp_tool: mcp_tool_row_to_mcp_tool(row.mcp_tool),
            origin,
            overridden: false,
            via_group,
        },
    );

    let (prompts, suppressed_prompts) =
        apply_overrides_prompts(prompts, &overrides.prompts, &overrides.prompt_replacements);
    let (skills, suppressed_skills) =
        apply_overrides_skills(skills, &overrides.skills, &overrides.skill_replacements);
    let (mcp_tools, suppressed_mcp_tools) = apply_overrides_mcp_tools(
        mcp_tools,
        &overrides.mcp_tools,
        &overrides.mcp_tool_replacements,
    );

    TaskBundle {
        task: row_to_task(task_row),
        role: role_row.map(role_row_to_role),
        prompts,
        skills,
        mcp_tools,
        suppressed_prompts,
        suppressed_skills,
        suppressed_mcp_tools,
    }
}

/// Apply prompt overrides to the materialised bundle slice. Returns the
/// new (kept, suppressed) tuple. Direct-origin entries are immune from
/// override semantics (D-A "out of scope" — direct rows are deleted, not
/// overridden).
fn apply_overrides_prompts(
    rows: Vec<PromptWithOrigin>,
    overrides: &[overrides_v2_repo::PromptOverrideRow],
    replacements: &std::collections::HashMap<String, Prompt>,
) -> (Vec<PromptWithOrigin>, Vec<Prompt>) {
    use std::collections::HashMap;
    let by_source: HashMap<&str, &overrides_v2_repo::PromptOverrideRow> = overrides
        .iter()
        .map(|o| (o.source_prompt_id.as_str(), o))
        .collect();

    let mut kept = Vec::with_capacity(rows.len());
    let mut suppressed = Vec::new();
    for entry in rows {
        // Direct rows are not overridable (D-A scope guard).
        if matches!(entry.origin, OriginRef::Direct) {
            kept.push(entry);
            continue;
        }
        match by_source.get(entry.prompt.id.as_str()) {
            None => kept.push(entry),
            Some(o) => match o.replacement_prompt_id.as_deref() {
                None => suppressed.push(entry.prompt),
                Some(repl_id) => match replacements.get(repl_id) {
                    Some(repl) => kept.push(PromptWithOrigin {
                        prompt: repl.clone(),
                        origin: entry.origin,
                        overridden: true,
                        via_group: entry.via_group,
                    }),
                    // Dangling replacement id (the FK should prevent
                    // this, but stay defensive): degrade to suppress.
                    None => suppressed.push(entry.prompt),
                },
            },
        }
    }
    (kept, suppressed)
}

/// Apply skill overrides — mirror of [`apply_overrides_prompts`].
fn apply_overrides_skills(
    rows: Vec<SkillWithOrigin>,
    overrides: &[overrides_v2_repo::SkillOverrideRow],
    replacements: &std::collections::HashMap<String, Skill>,
) -> (Vec<SkillWithOrigin>, Vec<Skill>) {
    use std::collections::HashMap;
    let by_source: HashMap<&str, &overrides_v2_repo::SkillOverrideRow> = overrides
        .iter()
        .map(|o| (o.source_skill_id.as_str(), o))
        .collect();

    let mut kept = Vec::with_capacity(rows.len());
    let mut suppressed = Vec::new();
    for entry in rows {
        if matches!(entry.origin, OriginRef::Direct) {
            kept.push(entry);
            continue;
        }
        match by_source.get(entry.skill.id.as_str()) {
            None => kept.push(entry),
            Some(o) => match o.replacement_skill_id.as_deref() {
                None => suppressed.push(entry.skill),
                Some(repl_id) => match replacements.get(repl_id) {
                    Some(repl) => kept.push(SkillWithOrigin {
                        skill: repl.clone(),
                        origin: entry.origin,
                        overridden: true,
                        via_group: entry.via_group,
                    }),
                    None => suppressed.push(entry.skill),
                },
            },
        }
    }
    (kept, suppressed)
}

/// Apply mcp-tool overrides — mirror of [`apply_overrides_prompts`].
fn apply_overrides_mcp_tools(
    rows: Vec<McpToolWithOrigin>,
    overrides: &[overrides_v2_repo::McpToolOverrideRow],
    replacements: &std::collections::HashMap<String, McpTool>,
) -> (Vec<McpToolWithOrigin>, Vec<McpTool>) {
    use std::collections::HashMap;
    let by_source: HashMap<&str, &overrides_v2_repo::McpToolOverrideRow> = overrides
        .iter()
        .map(|o| (o.source_tool_id.as_str(), o))
        .collect();

    let mut kept = Vec::with_capacity(rows.len());
    let mut suppressed = Vec::new();
    for entry in rows {
        if matches!(entry.origin, OriginRef::Direct) {
            kept.push(entry);
            continue;
        }
        match by_source.get(entry.mcp_tool.id.as_str()) {
            None => kept.push(entry),
            Some(o) => match o.replacement_tool_id.as_deref() {
                None => suppressed.push(entry.mcp_tool),
                Some(repl_id) => match replacements.get(repl_id) {
                    Some(repl) => kept.push(McpToolWithOrigin {
                        mcp_tool: repl.clone(),
                        origin: entry.origin,
                        overridden: true,
                        via_group: entry.via_group,
                    }),
                    None => suppressed.push(entry.mcp_tool),
                },
            },
        }
    }
    (kept, suppressed)
}

/// Batch-resolve replacement prompts by id. Missing ids are silently
/// skipped — the post-pass treats them as suppress. Duplicates collapse
/// in the HashMap, which is fine: a hydrate is cheap and we just need a
/// lookup table.
fn hydrate_prompts<'a, I>(
    conn: &rusqlite::Connection,
    ids: I,
) -> Result<std::collections::HashMap<String, Prompt>, AppError>
where
    I: IntoIterator<Item = &'a str>,
{
    let mut out = std::collections::HashMap::new();
    for id in ids {
        if out.contains_key(id) {
            continue;
        }
        if let Some(row) = prompts_repo::get_by_id(conn, id).map_err(map_db_err)? {
            out.insert(id.to_owned(), prompt_row_to_prompt(row));
        }
    }
    Ok(out)
}

/// Batch-resolve replacement skills by id. See [`hydrate_prompts`].
fn hydrate_skills<'a, I>(
    conn: &rusqlite::Connection,
    ids: I,
) -> Result<std::collections::HashMap<String, Skill>, AppError>
where
    I: IntoIterator<Item = &'a str>,
{
    let mut out = std::collections::HashMap::new();
    for id in ids {
        if out.contains_key(id) {
            continue;
        }
        if let Some(row) = skills_repo::get_by_id(conn, id).map_err(map_db_err)? {
            out.insert(id.to_owned(), skill_row_to_skill(row));
        }
    }
    Ok(out)
}

/// Batch-resolve replacement mcp-tools by id. See [`hydrate_prompts`].
fn hydrate_mcp_tools<'a, I>(
    conn: &rusqlite::Connection,
    ids: I,
) -> Result<std::collections::HashMap<String, McpTool>, AppError>
where
    I: IntoIterator<Item = &'a str>,
{
    let mut out = std::collections::HashMap::new();
    for id in ids {
        if out.contains_key(id) {
            continue;
        }
        if let Some(row) = mcp_tools_repo::get_by_id(conn, id).map_err(map_db_err)? {
            out.insert(id.to_owned(), mcp_tool_row_to_mcp_tool(row));
        }
    }
    Ok(out)
}

/// Effective precedence rank for dedup ordering. Combines the base
/// scope precedence (`Direct > Role > Column > Board > Space`) with an
/// "individual beats group" tiebreak at the *same* scope: a row attached
/// individually outranks one materialised from a group, but any row at a
/// higher scope still outranks a lower one regardless of group-source.
///
/// `rank = precedence * 2 + (1 if individual else 0)` — e.g.
/// `direct` = 11, `direct#group` = 10, `role` = 9, `role#group` = 8, …
fn origin_rank(origin: &OriginRef, via_group: Option<&String>) -> u8 {
    origin.precedence() * 2 + u8::from(via_group.is_none())
}

/// Generic dedup-by-origin-precedence step shared between prompts,
/// skills, and MCP tools. The contract is identical across all three:
///   1. Group rows by `key_of(row)`.
///   2. Keep the row with the highest origin rank per group (scope
///      precedence, then individual-over-group); ties broken by arrival
///      order (first-seen wins).
///   3. Sort the kept rows by `(rank DESC, position ASC)`.
///   4. Project each row through `make_entry` once we know its origin +
///      source group.
///
/// Malformed origin strings (the row's `origin` column does not match
/// any known scope) are treated as `Direct` — the only safe fallback
/// that doesn't lose user data. Composite group origins
/// (`"<scope>:<id>#group:<gid>"`) resolve to their base scope plus the
/// source group id (passed to `make_entry` as `via_group`).
fn dedup_by_origin_precedence<R, T, K, P, M>(
    rows: Vec<R>,
    key_of: K,
    parts_of: P,
    make_entry: M,
) -> Vec<T>
where
    K: Fn(&R) -> String,
    P: Fn(&R) -> (String, f64),
    M: Fn(R, OriginRef, Option<String>) -> T,
{
    use std::collections::HashMap;

    let mut best: HashMap<String, (u8, usize)> = HashMap::new();
    for (idx, row) in rows.iter().enumerate() {
        let (origin_raw, _) = parts_of(row);
        let (origin, via_group) =
            OriginRef::parse_with_group(&origin_raw).unwrap_or((OriginRef::Direct, None));
        let rank = origin_rank(&origin, via_group.as_ref());
        match best.get(&key_of(row)) {
            Some(&(existing_rank, _)) if existing_rank >= rank => {
                // Earlier row wins on (rank, arrival-order) tie.
            }
            _ => {
                best.insert(key_of(row), (rank, idx));
            }
        }
    }

    let mut winners: Vec<(u8, f64, T)> = rows
        .into_iter()
        .enumerate()
        .filter_map(|(idx, row)| {
            let kept_idx = best.get(&key_of(&row))?.1;
            if kept_idx != idx {
                return None;
            }
            let (origin_raw, position) = parts_of(&row);
            let (origin, via_group) =
                OriginRef::parse_with_group(&origin_raw).unwrap_or((OriginRef::Direct, None));
            let rank = origin_rank(&origin, via_group.as_ref());
            Some((rank, position, make_entry(row, origin, via_group)))
        })
        .collect();

    winners.sort_by(|a, b| {
        b.0.cmp(&a.0)
            .then_with(|| a.1.partial_cmp(&b.1).unwrap_or(std::cmp::Ordering::Equal))
    });

    winners.into_iter().map(|(_, _, entry)| entry).collect()
}

/// Hard upper bound on the per-call `summary` length passed to
/// [`TasksUseCase::log_step`]. NFR §4.2 (validation) + the senior
/// engineering bar require an explicit ceiling on every user-supplied
/// string the use-case appends to a persistent buffer; 50 000 chars is
/// the same ceiling the prompt content uses. Each step line is also
/// timestamp-prefixed (~24 chars) — well under SQLite's per-cell
/// 1 GB default.
const STEP_LOG_SUMMARY_MAX_LEN: usize = 50_000;

#[cfg(test)]
mod tests {
    use super::*;
    use catique_infrastructure::db::pool::memory_pool_for_tests;
    use catique_infrastructure::db::runner::run_pending;

    fn fresh_pool() -> Pool {
        let pool = memory_pool_for_tests();
        let mut conn = pool.get().unwrap();
        run_pending(&mut conn).unwrap();
        conn.execute_batch(
            "INSERT INTO spaces (id, name, prefix, is_default, position, created_at, updated_at) \
                 VALUES ('sp1','Space','sp',0,0,0,0); \
             INSERT INTO boards (id, name, space_id, position, created_at, updated_at) \
                 VALUES ('bd1','B','sp1',0,0,0); \
             INSERT INTO columns (id, board_id, name, position, created_at) \
                 VALUES ('c1','bd1','C',0,0);",
        )
        .unwrap();
        drop(conn);
        pool
    }

    #[test]
    fn create_then_get() {
        let pool = fresh_pool();
        let uc = TasksUseCase::new(&pool);
        let t = uc
            .create("bd1".into(), "c1".into(), "Title".into(), None, 1.0, None)
            .unwrap();
        let got = uc.get(&t.id).unwrap();
        assert_eq!(got, t);
    }

    #[test]
    fn create_with_missing_board_returns_not_found() {
        let pool = fresh_pool();
        let uc = TasksUseCase::new(&pool);
        match uc
            .create("ghost".into(), "c1".into(), "T".into(), None, 1.0, None)
            .expect_err("nf")
        {
            AppError::NotFound { entity, .. } => assert_eq!(entity, "board"),
            other => panic!("got {other:?}"),
        }
    }

    #[test]
    fn create_with_missing_column_returns_not_found() {
        let pool = fresh_pool();
        let uc = TasksUseCase::new(&pool);
        match uc
            .create("bd1".into(), "ghost".into(), "T".into(), None, 1.0, None)
            .expect_err("nf")
        {
            AppError::NotFound { entity, .. } => assert_eq!(entity, "column"),
            other => panic!("got {other:?}"),
        }
    }

    #[test]
    fn empty_title_returns_validation() {
        let pool = fresh_pool();
        let uc = TasksUseCase::new(&pool);
        match uc
            .create("bd1".into(), "c1".into(), "  ".into(), None, 1.0, None)
            .expect_err("v")
        {
            AppError::Validation { field, .. } => assert_eq!(field, "title"),
            other => panic!("got {other:?}"),
        }
    }

    #[test]
    fn update_changes_only_supplied_fields() {
        let pool = fresh_pool();
        let uc = TasksUseCase::new(&pool);
        let t = uc
            .create("bd1".into(), "c1".into(), "T".into(), None, 1.0, None)
            .unwrap();
        let updated = uc
            .update(t.id.clone(), Some("New".into()), None, None, None, None)
            .unwrap();
        assert_eq!(updated.title, "New");
        assert!((updated.position - 1.0).abs() < f64::EPSILON);
    }

    #[test]
    fn list_task_prompts_returns_prompts_in_position_order() {
        let pool = fresh_pool();
        // Insert prompts + join rows directly.
        {
            let conn = pool.get().unwrap();
            conn.execute_batch(
                "INSERT INTO prompts (id, name, content, created_at, updated_at) \
                     VALUES ('px','X','',0,0), ('py','Y','',0,0);",
            )
            .unwrap();
        }
        let uc = TasksUseCase::new(&pool);
        let task = uc
            .create("bd1".into(), "c1".into(), "T".into(), None, 1.0, None)
            .unwrap();
        // Attach px at position 5, py at position 1 — py should come first.
        {
            let conn = pool.get().unwrap();
            catique_infrastructure::db::repositories::tasks::add_task_prompt(
                &conn, &task.id, "px", 5.0,
            )
            .unwrap();
            catique_infrastructure::db::repositories::tasks::add_task_prompt(
                &conn, &task.id, "py", 1.0,
            )
            .unwrap();
        }
        let prompts = uc.list_task_prompts(&task.id).unwrap();
        assert_eq!(prompts.len(), 2);
        assert_eq!(prompts[0].id, "py");
        assert_eq!(prompts[1].id, "px");
    }

    #[test]
    fn log_step_appends_three_lines_in_order() {
        let pool = fresh_pool();
        let uc = TasksUseCase::new(&pool);
        let task = uc
            .create("bd1".into(), "c1".into(), "T".into(), None, 1.0, None)
            .unwrap();

        // Three appends with small inter-call sleeps so timestamps
        // are strictly monotonically non-decreasing.
        uc.log_step(task.id.clone(), "first".into()).unwrap();
        std::thread::sleep(std::time::Duration::from_millis(2));
        uc.log_step(task.id.clone(), "second".into()).unwrap();
        std::thread::sleep(std::time::Duration::from_millis(2));
        uc.log_step(task.id.clone(), "third".into()).unwrap();

        let after = uc.get(&task.id).unwrap();
        let lines: Vec<&str> = after.step_log.lines().collect();
        assert_eq!(
            lines.len(),
            3,
            "three appended lines expected, got: {:?}",
            after.step_log
        );
        // Format: `[YYYY-MM-DDTHH:MM:SSZ] {summary}` — timestamp +
        // single-space + summary; ordering matches insertion order.
        assert!(lines[0].starts_with('['), "line lacks timestamp prefix");
        assert!(lines[0].ends_with(" first"));
        assert!(lines[1].ends_with(" second"));
        assert!(lines[2].ends_with(" third"));
        // Final newline is part of the buffer (each append adds `\n`),
        // so the raw step_log ends with '\n'.
        assert!(after.step_log.ends_with('\n'));
    }

    #[test]
    fn log_step_rejects_oversized_summary() {
        let pool = fresh_pool();
        let uc = TasksUseCase::new(&pool);
        let task = uc
            .create("bd1".into(), "c1".into(), "T".into(), None, 1.0, None)
            .unwrap();
        let huge = "x".repeat(50_001);
        match uc.log_step(task.id, huge).expect_err("validation") {
            AppError::Validation { field, .. } => assert_eq!(field, "summary"),
            other => panic!("got {other:?}"),
        }
    }

    #[test]
    fn log_step_returns_not_found_for_missing_task() {
        let pool = fresh_pool();
        let uc = TasksUseCase::new(&pool);
        match uc.log_step("ghost".into(), "x".into()).expect_err("nf") {
            AppError::NotFound { entity, .. } => assert_eq!(entity, "task"),
            other => panic!("got {other:?}"),
        }
    }

    #[test]
    fn rate_task_round_trip_good_then_bad_then_unrate() {
        let pool = fresh_pool();
        let uc = TasksUseCase::new(&pool);
        let task = uc
            .create("bd1".into(), "c1".into(), "T".into(), None, 1.0, None)
            .unwrap();

        // No row before any rating call.
        assert!(uc.get_task_rating(&task.id).unwrap().is_none());

        // Good (+1).
        uc.rate_task(task.id.clone(), Some(1)).unwrap();
        let r = uc.get_task_rating(&task.id).unwrap().expect("row");
        assert_eq!(r.rating, Some(1));

        // Update to bad (-1).
        uc.rate_task(task.id.clone(), Some(-1)).unwrap();
        let r = uc.get_task_rating(&task.id).unwrap().expect("row");
        assert_eq!(r.rating, Some(-1));

        // Unrate (NULL); row stays so rated_at preserves the unrate
        // moment — memo Q4 / AC-R2 distinction.
        uc.rate_task(task.id.clone(), None).unwrap();
        let r = uc.get_task_rating(&task.id).unwrap().expect("row stays");
        assert_eq!(r.rating, None);
    }

    #[test]
    fn rate_task_rejects_out_of_range() {
        let pool = fresh_pool();
        let uc = TasksUseCase::new(&pool);
        let task = uc
            .create("bd1".into(), "c1".into(), "T".into(), None, 1.0, None)
            .unwrap();
        match uc.rate_task(task.id, Some(2)).expect_err("validation") {
            AppError::Validation { field, .. } => assert_eq!(field, "rating"),
            other => panic!("got {other:?}"),
        }
    }

    #[test]
    fn rate_task_returns_not_found_for_missing_task() {
        let pool = fresh_pool();
        let uc = TasksUseCase::new(&pool);
        match uc.rate_task("ghost".into(), Some(1)).expect_err("nf") {
            AppError::NotFound { entity, .. } => assert_eq!(entity, "task"),
            other => panic!("got {other:?}"),
        }
    }

    // -----------------------------------------------------------------
    // ctq-107 — `move_task` Promptery-compat alias.
    // -----------------------------------------------------------------

    #[test]
    fn move_task_within_same_board_swaps_column_and_position() {
        // Same-board move: only column_id (and position) changes; the
        // existing board_id stays put. Direct prompts and the task's
        // role_id survive — that's the whole contract for the alias.
        use catique_infrastructure::db::repositories::tasks as repo;

        let pool = fresh_pool();
        // Add a second column on the same board so we have somewhere
        // to move to.
        {
            let conn = pool.get().unwrap();
            conn.execute(
                "INSERT INTO columns (id, board_id, name, position, created_at) \
                 VALUES ('c2','bd1','Done',1,0)",
                [],
            )
            .unwrap();
            conn.execute_batch(
                "INSERT INTO roles (id, name, content, created_at, updated_at) \
                     VALUES ('rl', 'R', '', 0, 0); \
                 INSERT INTO prompts (id, name, content, created_at, updated_at) \
                     VALUES ('p-direct', 'direct prompt', '', 0, 0);",
            )
            .unwrap();
        }
        let uc = TasksUseCase::new(&pool);
        let task = uc
            .create(
                "bd1".into(),
                "c1".into(),
                "T".into(),
                None,
                1.0,
                Some("rl".into()),
            )
            .unwrap();
        // Attach a direct prompt — it must survive the move.
        {
            let conn = pool.get().unwrap();
            repo::add_task_prompt(&conn, &task.id, "p-direct", 1.0).unwrap();
        }

        let moved = uc
            .move_task(task.id.clone(), "c2".into(), Some(2.0))
            .unwrap();
        assert_eq!(moved.column_id, "c2");
        assert_eq!(moved.board_id, "bd1");
        assert!((moved.position - 2.0).abs() < f64::EPSILON);
        // Task-level role survives.
        assert_eq!(moved.role_id.as_deref(), Some("rl"));

        // Direct prompts survive across the move.
        let prompts = uc.list_task_prompts(&task.id).unwrap();
        assert_eq!(prompts.len(), 1);
        assert_eq!(prompts[0].id, "p-direct");
    }

    #[test]
    fn move_task_across_boards_repoints_board_id() {
        // Cross-board move: destination column lives on a different
        // board. `tasks.board_id` must follow so the row stays
        // internally consistent — that is the bug `update_task` has
        // (audit F-10), and `move_task` is the alias that fixes it.
        use catique_infrastructure::db::repositories::tasks as repo;

        let pool = fresh_pool();
        // Seed a second board with one column on the same space.
        // Migration 016 enforces UNIQUE(space_id, owner_role_id), so bd2
        // gets a distinct owner-role row to coexist with bd1 in `sp1`.
        {
            let conn = pool.get().unwrap();
            conn.execute_batch(
                "INSERT INTO roles (id, name, content, created_at, updated_at) \
                     VALUES ('rl-bd2','Owner of bd2','',0,0); \
                 INSERT INTO boards (id, name, space_id, position, created_at, updated_at, owner_role_id) \
                     VALUES ('bd2','B2','sp1',1,0,0,'rl-bd2'); \
                 INSERT INTO columns (id, board_id, name, position, created_at) \
                     VALUES ('cb2','bd2','Backlog',0,0); \
                 INSERT INTO prompts (id, name, content, created_at, updated_at) \
                     VALUES ('p-d','direct','',0,0);",
            )
            .unwrap();
        }
        let uc = TasksUseCase::new(&pool);
        let task = uc
            .create("bd1".into(), "c1".into(), "T".into(), None, 1.0, None)
            .unwrap();
        {
            let conn = pool.get().unwrap();
            repo::add_task_prompt(&conn, &task.id, "p-d", 1.0).unwrap();
        }

        let moved = uc.move_task(task.id.clone(), "cb2".into(), None).unwrap();
        assert_eq!(moved.board_id, "bd2", "board_id must follow column");
        assert_eq!(moved.column_id, "cb2");

        // Direct prompt survived the cross-board move.
        let prompts = uc.list_task_prompts(&task.id).unwrap();
        assert_eq!(prompts.len(), 1);
        assert_eq!(prompts[0].id, "p-d");
    }

    // -----------------------------------------------------------------
    // D-006 — `route_task_to_board` cross-board drop onto default column.
    // -----------------------------------------------------------------

    #[test]
    fn route_task_to_board_lands_on_default_column() {
        // Seed a second board with one default column on the same space.
        // Migration 016 enforces UNIQUE(space_id, owner_role_id), so the
        // new board points at its own role.
        let pool = fresh_pool();
        {
            let conn = pool.get().unwrap();
            conn.execute_batch(
                "INSERT INTO roles (id, name, content, created_at, updated_at) \
                     VALUES ('rl-bd2','Owner of bd2','',0,0); \
                 INSERT INTO boards (id, name, space_id, position, created_at, updated_at, owner_role_id) \
                     VALUES ('bd2','B2','sp1',1,0,0,'rl-bd2'); \
                 INSERT INTO columns (id, board_id, name, position, role_id, is_default, created_at) VALUES \
                     ('cb2-default','bd2','Owner',0,NULL,1,0), \
                     ('cb2-other','bd2','Backlog',1,NULL,0,0);",
            )
            .unwrap();
        }
        let uc = TasksUseCase::new(&pool);
        let task = uc
            .create("bd1".into(), "c1".into(), "T".into(), None, 1.0, None)
            .unwrap();

        let routed = uc
            .route_task_to_board(task.id.clone(), "bd2".into())
            .unwrap();
        assert_eq!(routed.board_id, "bd2");
        assert_eq!(
            routed.column_id, "cb2-default",
            "must land on the destination board's default column"
        );
    }

    #[test]
    fn route_task_to_board_returns_not_found_for_missing_board() {
        let pool = fresh_pool();
        let uc = TasksUseCase::new(&pool);
        let task = uc
            .create("bd1".into(), "c1".into(), "T".into(), None, 1.0, None)
            .unwrap();
        match uc
            .route_task_to_board(task.id, "ghost".into())
            .expect_err("nf")
        {
            AppError::NotFound { entity, id } => {
                assert_eq!(entity, "board");
                assert_eq!(id, "ghost");
            }
            other => panic!("expected NotFound, got {other:?}"),
        }
    }

    #[test]
    fn route_task_to_board_returns_not_found_when_board_lacks_default_column() {
        // The board exists but has no `is_default = 1` column. This is
        // a data-corruption signal — migration 016 guarantees one
        // exists. The use case surfaces it as a typed NotFound rather
        // than panicking.
        let pool = fresh_pool();
        {
            let conn = pool.get().unwrap();
            conn.execute_batch(
                "INSERT INTO roles (id, name, content, created_at, updated_at) \
                     VALUES ('rl-bd3','Owner of bd3','',0,0); \
                 INSERT INTO boards (id, name, space_id, position, created_at, updated_at, owner_role_id) \
                     VALUES ('bd3','B3','sp1',2,0,0,'rl-bd3');",
            )
            .unwrap();
        }
        let uc = TasksUseCase::new(&pool);
        let task = uc
            .create("bd1".into(), "c1".into(), "T".into(), None, 1.0, None)
            .unwrap();
        match uc
            .route_task_to_board(task.id, "bd3".into())
            .expect_err("nf")
        {
            AppError::NotFound { entity, .. } => assert_eq!(entity, "default_column"),
            other => panic!("expected NotFound, got {other:?}"),
        }
    }

    #[test]
    fn move_task_returns_not_found_for_missing_task() {
        let pool = fresh_pool();
        let uc = TasksUseCase::new(&pool);
        match uc
            .move_task("ghost".into(), "c1".into(), None)
            .expect_err("nf")
        {
            AppError::NotFound { entity, .. } => assert_eq!(entity, "task"),
            other => panic!("expected NotFound, got {other:?}"),
        }
    }

    #[test]
    fn move_task_returns_not_found_for_missing_column() {
        let pool = fresh_pool();
        let uc = TasksUseCase::new(&pool);
        let task = uc
            .create("bd1".into(), "c1".into(), "T".into(), None, 1.0, None)
            .unwrap();
        match uc.move_task(task.id, "ghost".into(), None).expect_err("nf") {
            AppError::NotFound { entity, id } => {
                assert_eq!(entity, "column");
                assert_eq!(id, "ghost");
            }
            other => panic!("expected NotFound, got {other:?}"),
        }
    }

    #[test]
    fn create_with_role_id_persists_it() {
        let pool = fresh_pool();
        // Insert a role so the FK constraint is satisfied.
        {
            let conn = pool.get().unwrap();
            conn.execute(
                "INSERT INTO roles (id, name, content, created_at, updated_at) \
                 VALUES ('rl-x','Reviewer','',0,0)",
                [],
            )
            .unwrap();
        }
        let uc = TasksUseCase::new(&pool);
        let task = uc
            .create(
                "bd1".into(),
                "c1".into(),
                "With Role".into(),
                None,
                1.0,
                Some("rl-x".into()),
            )
            .unwrap();
        assert_eq!(task.role_id.as_deref(), Some("rl-x"));
        // Round-trip: get should return the same role_id.
        let got = uc.get(&task.id).unwrap();
        assert_eq!(got.role_id.as_deref(), Some("rl-x"));
    }

    #[test]
    fn delete_task_removes_attachment_directory() {
        // Cascade contract: deleting a task must remove the
        // `<root>/<task_id>/` directory and everything inside it.
        let pool = fresh_pool();
        let uc = TasksUseCase::new(&pool);
        let task = uc
            .create("bd1".into(), "c1".into(), "T".into(), None, 1.0, None)
            .unwrap();
        let attachments_root = tempfile::tempdir().unwrap();
        let task_dir = attachments_root.path().join(&task.id);
        std::fs::create_dir_all(&task_dir).unwrap();
        let blob_path = task_dir.join("file.bin");
        std::fs::write(&blob_path, b"x").unwrap();

        uc.delete_with_attachments(&task.id, attachments_root.path())
            .unwrap();

        assert!(!task_dir.exists(), "task attachment dir should be gone");
        match uc.get(&task.id).expect_err("nf") {
            AppError::NotFound { entity, .. } => assert_eq!(entity, "task"),
            other => panic!("got {other:?}"),
        }
    }

    #[test]
    fn delete_task_succeeds_when_attachment_dir_missing() {
        // Idempotency: a task that never had attachments (no directory
        // on disk) must still delete cleanly.
        let pool = fresh_pool();
        let uc = TasksUseCase::new(&pool);
        let task = uc
            .create("bd1".into(), "c1".into(), "T".into(), None, 1.0, None)
            .unwrap();
        let attachments_root = tempfile::tempdir().unwrap();
        let task_dir = attachments_root.path().join(&task.id);
        assert!(!task_dir.exists(), "precondition: dir absent");

        uc.delete_with_attachments(&task.id, attachments_root.path())
            .expect("delete should succeed when dir is missing");

        match uc.get(&task.id).expect_err("nf") {
            AppError::NotFound { entity, .. } => assert_eq!(entity, "task"),
            other => panic!("got {other:?}"),
        }
    }

    // -----------------------------------------------------------------
    // ADR-0006 — `resolve_task_bundle` use-case wiring.
    // -----------------------------------------------------------------

    #[test]
    fn resolve_task_bundle_returns_not_found_for_missing_task() {
        let pool = fresh_pool();
        let uc = TasksUseCase::new(&pool);
        match uc.resolve_task_bundle("ghost").expect_err("nf") {
            AppError::NotFound { entity, .. } => assert_eq!(entity, "task"),
            other => panic!("got {other:?}"),
        }
    }

    #[test]
    fn resolve_task_bundle_includes_role_when_task_has_role() {
        let pool = fresh_pool();
        {
            let conn = pool.get().unwrap();
            conn.execute(
                "INSERT INTO roles (id, name, content, created_at, updated_at) \
                 VALUES ('rl', 'My Role', '', 0, 0)",
                [],
            )
            .unwrap();
        }
        let uc = TasksUseCase::new(&pool);
        let task = uc
            .create(
                "bd1".into(),
                "c1".into(),
                "T".into(),
                None,
                1.0,
                Some("rl".into()),
            )
            .unwrap();

        let bundle = uc.resolve_task_bundle(&task.id).unwrap();
        assert_eq!(bundle.task.id, task.id);
        let role = bundle.role.expect("active role resolved");
        assert_eq!(role.id, "rl");
        assert!(bundle.prompts.is_empty(), "no prompts attached yet");
    }

    #[test]
    fn resolve_task_bundle_dedups_direct_over_inherited() {
        // ADR-0006 AC-5: when a prompt is both attached directly to a
        // task and inherited from its role, the bundle returns it once
        // tagged `Direct`.
        use catique_domain::OriginRef;
        use catique_infrastructure::db::repositories::tasks as repo;

        let pool = fresh_pool();
        {
            let conn = pool.get().unwrap();
            conn.execute_batch(
                "INSERT INTO roles (id, name, content, created_at, updated_at) \
                     VALUES ('rl', 'R', '', 0, 0); \
                 INSERT INTO prompts (id, name, content, created_at, updated_at) \
                     VALUES ('p-shared', 'shared', '', 0, 0);",
            )
            .unwrap();
        }
        let uc = TasksUseCase::new(&pool);
        let task = uc
            .create(
                "bd1".into(),
                "c1".into(),
                "T".into(),
                None,
                1.0,
                Some("rl".into()),
            )
            .unwrap();

        // Direct attachment first.
        {
            let conn = pool.get().unwrap();
            repo::add_task_prompt(&conn, &task.id, "p-shared", 1.0).unwrap();
            // Then a role-cascade for the same prompt — must NOT
            // overwrite the direct row (the cascade uses ON CONFLICT
            // DO NOTHING).
            repo::cascade_prompt_attachment(
                &conn,
                &repo::AttachScope::Role("rl".into()),
                "p-shared",
                2.0,
            )
            .unwrap();
        }

        let bundle = uc.resolve_task_bundle(&task.id).unwrap();
        assert_eq!(bundle.prompts.len(), 1, "direct + role dedup to one");
        assert_eq!(bundle.prompts[0].origin, OriginRef::Direct);
        assert_eq!(bundle.prompts[0].prompt.id, "p-shared");
    }

    // ---------------------------------------------------------------
    // ctq-119 — bundle now carries skills + mcp_tools.
    // ---------------------------------------------------------------

    /// Helper that wires the bare bones onto the existing pool fixture
    /// (one task on `rl` plus a pair of skills and a pair of mcp_tools).
    /// Returns the task id so the asserts can target it.
    fn seed_bundle_skills_fixture(pool: &Pool) -> String {
        {
            let conn = pool.get().unwrap();
            conn.execute_batch(
                "INSERT INTO roles (id, name, content, created_at, updated_at) \
                     VALUES ('rl','R','',0,0); \
                 INSERT INTO skills (id, name, content, created_at, updated_at) \
                     VALUES ('sk1','Skill One','',0,0), ('sk2','Skill Two','',0,0); \
                 INSERT INTO mcp_tools (id, name, content, created_at, updated_at) \
                     VALUES ('mt1','Tool One','',0,0), ('mt2','Tool Two','',0,0);",
            )
            .unwrap();
        }
        let uc = TasksUseCase::new(pool);
        uc.create(
            "bd1".into(),
            "c1".into(),
            "T".into(),
            None,
            1.0,
            Some("rl".into()),
        )
        .unwrap()
        .id
    }

    #[test]
    fn resolve_task_bundle_includes_skill_inherited_from_role() {
        // Skills attached to a cat (role) must surface on every task
        // sitting under a role-bearing column with that role active.
        // We cascade via the role-level repo helper directly — the
        // ctq-121 cascade hooks in the IPC layer use the same path.
        use catique_infrastructure::db::repositories::inheritance::cascade_skill_attachment;
        use catique_infrastructure::db::repositories::roles as roles_repo;
        use catique_infrastructure::db::repositories::tasks::AttachScope;

        let pool = fresh_pool();
        let task_id = seed_bundle_skills_fixture(&pool);
        // Attach + cascade in lockstep so the resolver finds the rows.
        {
            let conn = pool.get().unwrap();
            roles_repo::add_role_skill(&conn, "rl", "sk1", 1.0).unwrap();
            cascade_skill_attachment(&conn, &AttachScope::Role("rl".into()), "sk1", 1.0).unwrap();
        }

        let uc = TasksUseCase::new(&pool);
        let bundle = uc.resolve_task_bundle(&task_id).unwrap();
        assert_eq!(bundle.skills.len(), 1);
        assert_eq!(bundle.skills[0].skill.id, "sk1");
        assert_eq!(bundle.skills[0].origin, OriginRef::Role("rl".into()));
        assert!(bundle.mcp_tools.is_empty());
    }

    #[test]
    fn resolve_task_bundle_skill_direct_overrides_role() {
        // Same skill attached directly to the task AND inherited from
        // the role — the bundle returns it once tagged Direct (override
        // rule "direct beats inherited"). Mirrors the prompt assertion.
        use catique_infrastructure::db::repositories::inheritance::cascade_skill_attachment;
        use catique_infrastructure::db::repositories::roles as roles_repo;
        use catique_infrastructure::db::repositories::skills as skills_repo;
        use catique_infrastructure::db::repositories::tasks::AttachScope;

        let pool = fresh_pool();
        let task_id = seed_bundle_skills_fixture(&pool);
        {
            let conn = pool.get().unwrap();
            // Direct first.
            skills_repo::add_task_skill(&conn, &task_id, "sk1", 0.5).unwrap();
            // Then role attach + cascade — INSERT OR IGNORE keeps direct intact.
            roles_repo::add_role_skill(&conn, "rl", "sk1", 1.0).unwrap();
            cascade_skill_attachment(&conn, &AttachScope::Role("rl".into()), "sk1", 1.0).unwrap();
        }

        let uc = TasksUseCase::new(&pool);
        let bundle = uc.resolve_task_bundle(&task_id).unwrap();
        assert_eq!(bundle.skills.len(), 1);
        assert_eq!(bundle.skills[0].skill.id, "sk1");
        assert_eq!(bundle.skills[0].origin, OriginRef::Direct);
    }

    #[test]
    fn resolve_task_bundle_includes_mcp_tool_inherited_from_role() {
        use catique_infrastructure::db::repositories::inheritance::cascade_mcp_tool_attachment;
        use catique_infrastructure::db::repositories::roles as roles_repo;
        use catique_infrastructure::db::repositories::tasks::AttachScope;

        let pool = fresh_pool();
        let task_id = seed_bundle_skills_fixture(&pool);
        {
            let conn = pool.get().unwrap();
            roles_repo::add_role_mcp_tool(&conn, "rl", "mt1", 1.0).unwrap();
            cascade_mcp_tool_attachment(&conn, &AttachScope::Role("rl".into()), "mt1", 1.0)
                .unwrap();
        }

        let uc = TasksUseCase::new(&pool);
        let bundle = uc.resolve_task_bundle(&task_id).unwrap();
        assert_eq!(bundle.mcp_tools.len(), 1);
        assert_eq!(bundle.mcp_tools[0].mcp_tool.id, "mt1");
        assert_eq!(bundle.mcp_tools[0].origin, OriginRef::Role("rl".into()));
    }

    #[test]
    fn resolve_task_bundle_mcp_tool_direct_overrides_board() {
        use catique_infrastructure::db::repositories::inheritance::cascade_mcp_tool_attachment;
        use catique_infrastructure::db::repositories::mcp_tools as mt_repo;
        use catique_infrastructure::db::repositories::tasks::AttachScope;

        let pool = fresh_pool();
        let task_id = seed_bundle_skills_fixture(&pool);
        {
            let conn = pool.get().unwrap();
            mt_repo::add_task_mcp_tool(&conn, &task_id, "mt1", 0.5).unwrap();
            cascade_mcp_tool_attachment(&conn, &AttachScope::Board("bd1".into()), "mt1", 1.0)
                .unwrap();
        }

        let uc = TasksUseCase::new(&pool);
        let bundle = uc.resolve_task_bundle(&task_id).unwrap();
        assert_eq!(bundle.mcp_tools.len(), 1);
        assert_eq!(bundle.mcp_tools[0].origin, OriginRef::Direct);
    }

    #[test]
    fn resolve_task_bundle_orders_by_precedence() {
        // Direct first, then Role > Column > Board > Space within their
        // own buckets. Three different prompts so dedup doesn't apply.
        use catique_domain::OriginRef;
        use catique_infrastructure::db::repositories::tasks as repo;

        let pool = fresh_pool();
        {
            let conn = pool.get().unwrap();
            conn.execute_batch(
                "INSERT INTO roles (id, name, content, created_at, updated_at) \
                     VALUES ('rl', 'R', '', 0, 0); \
                 INSERT INTO prompts (id, name, content, created_at, updated_at) VALUES \
                     ('p-d','direct','',0,0), \
                     ('p-r','role','',0,0), \
                     ('p-b','board','',0,0);",
            )
            .unwrap();
        }
        let uc = TasksUseCase::new(&pool);
        let task = uc
            .create(
                "bd1".into(),
                "c1".into(),
                "T".into(),
                None,
                1.0,
                Some("rl".into()),
            )
            .unwrap();
        {
            let conn = pool.get().unwrap();
            // Reverse order on purpose so we know the resolver isn't
            // relying on insertion order.
            repo::cascade_prompt_attachment(
                &conn,
                &repo::AttachScope::Board("bd1".into()),
                "p-b",
                3.0,
            )
            .unwrap();
            repo::cascade_prompt_attachment(
                &conn,
                &repo::AttachScope::Role("rl".into()),
                "p-r",
                2.0,
            )
            .unwrap();
            repo::add_task_prompt(&conn, &task.id, "p-d", 1.0).unwrap();
        }

        let bundle = uc.resolve_task_bundle(&task.id).unwrap();
        let origins: Vec<&OriginRef> = bundle.prompts.iter().map(|p| &p.origin).collect();
        assert_eq!(
            origins,
            vec![
                &OriginRef::Direct,
                &OriginRef::Role("rl".into()),
                &OriginRef::Board("bd1".into()),
            ]
        );
    }

    // ---------------------------------------------------------------
    // Refactor-v3 D-A — overrides v2 (replace OR suppress).
    // ---------------------------------------------------------------

    /// Helper: seed a role + prompt + task, cascade the prompt onto the
    /// role so it appears as inherited on the task. Returns `(task_id,
    /// source_prompt_id)`.
    fn seed_inherited_prompt(pool: &Pool) -> (String, &'static str) {
        use catique_infrastructure::db::repositories::tasks as repo;
        {
            let conn = pool.get().unwrap();
            conn.execute_batch(
                "INSERT INTO roles (id, name, content, created_at, updated_at) \
                     VALUES ('rl', 'R', '', 0, 0); \
                 INSERT INTO prompts (id, name, content, created_at, updated_at) VALUES \
                     ('p-src', 'src', 'src body', 0, 0), \
                     ('p-rep', 'rep', 'rep body', 0, 0);",
            )
            .unwrap();
        }
        let uc = TasksUseCase::new(pool);
        let task = uc
            .create(
                "bd1".into(),
                "c1".into(),
                "T".into(),
                None,
                1.0,
                Some("rl".into()),
            )
            .unwrap();
        {
            let conn = pool.get().unwrap();
            repo::cascade_prompt_attachment(
                &conn,
                &repo::AttachScope::Role("rl".into()),
                "p-src",
                1.0,
            )
            .unwrap();
        }
        (task.id, "p-src")
    }

    #[test]
    fn override_v2_suppress_removes_prompt_and_lists_suppressed() {
        let pool = fresh_pool();
        let (task_id, src) = seed_inherited_prompt(&pool);
        let uc = TasksUseCase::new(&pool);

        // Sanity: pre-override the inherited prompt is in the bundle.
        let pre = uc.resolve_task_bundle(&task_id).unwrap();
        assert_eq!(pre.prompts.len(), 1, "inherited prompt present");
        assert!(pre.suppressed_prompts.is_empty());

        // Suppress.
        uc.set_task_prompt_override_v2(&task_id, src, None).unwrap();
        let bundle = uc.resolve_task_bundle(&task_id).unwrap();
        assert!(
            bundle.prompts.is_empty(),
            "suppressed prompt must vanish from the bundle"
        );
        assert_eq!(bundle.suppressed_prompts.len(), 1);
        assert_eq!(bundle.suppressed_prompts[0].id, "p-src");
    }

    #[test]
    fn override_v2_replace_substitutes_prompt_and_keeps_origin() {
        let pool = fresh_pool();
        let (task_id, src) = seed_inherited_prompt(&pool);
        let uc = TasksUseCase::new(&pool);

        uc.set_task_prompt_override_v2(&task_id, src, Some("p-rep"))
            .unwrap();
        let bundle = uc.resolve_task_bundle(&task_id).unwrap();
        assert_eq!(bundle.prompts.len(), 1);
        assert_eq!(bundle.prompts[0].prompt.id, "p-rep");
        assert_eq!(
            bundle.prompts[0].origin,
            OriginRef::Role("rl".into()),
            "replacement keeps the original origin tag"
        );
        assert!(
            bundle.prompts[0].overridden,
            "replacement row carries overridden = true"
        );
        assert!(bundle.suppressed_prompts.is_empty());
    }

    #[test]
    fn override_v2_clear_restores_inherited_prompt() {
        let pool = fresh_pool();
        let (task_id, src) = seed_inherited_prompt(&pool);
        let uc = TasksUseCase::new(&pool);

        uc.set_task_prompt_override_v2(&task_id, src, None).unwrap();
        assert!(uc.resolve_task_bundle(&task_id).unwrap().prompts.is_empty());

        uc.clear_task_prompt_override_v2(&task_id, src).unwrap();
        let restored = uc.resolve_task_bundle(&task_id).unwrap();
        assert_eq!(restored.prompts.len(), 1);
        assert_eq!(restored.prompts[0].prompt.id, "p-src");
        assert!(!restored.prompts[0].overridden);
        assert!(restored.suppressed_prompts.is_empty());
    }

    #[test]
    fn override_v2_clear_missing_returns_not_found() {
        let pool = fresh_pool();
        let (task_id, _) = seed_inherited_prompt(&pool);
        let uc = TasksUseCase::new(&pool);
        match uc
            .clear_task_prompt_override_v2(&task_id, "p-src")
            .expect_err("nothing to clear")
        {
            AppError::NotFound { entity, .. } => {
                assert_eq!(entity, "task_prompt_override_v2");
            }
            other => panic!("got {other:?}"),
        }
    }

    #[test]
    fn override_v2_set_missing_task_returns_not_found() {
        let pool = fresh_pool();
        let uc = TasksUseCase::new(&pool);
        match uc
            .set_task_prompt_override_v2("ghost", "p", None)
            .expect_err("task missing")
        {
            AppError::NotFound { entity, .. } => assert_eq!(entity, "task"),
            other => panic!("got {other:?}"),
        }
    }

    #[test]
    fn override_v2_does_not_touch_direct_prompts() {
        // Direct rows are not overridable (D-A "out of scope"). The
        // override row for the same prompt id is ignored when the row
        // sitting in the bundle came in as Direct.
        use catique_infrastructure::db::repositories::tasks as repo;

        let pool = fresh_pool();
        {
            let conn = pool.get().unwrap();
            conn.execute_batch(
                "INSERT INTO prompts (id, name, content, created_at, updated_at) VALUES \
                     ('p-direct','direct','',0,0), \
                     ('p-rep','rep','',0,0);",
            )
            .unwrap();
        }
        let uc = TasksUseCase::new(&pool);
        let task = uc
            .create("bd1".into(), "c1".into(), "T".into(), None, 1.0, None)
            .unwrap();
        {
            let conn = pool.get().unwrap();
            repo::add_task_prompt(&conn, &task.id, "p-direct", 1.0).unwrap();
        }
        // Try to suppress + replace the direct row — must be a no-op
        // in the resolver (D-A scope guard).
        uc.set_task_prompt_override_v2(&task.id, "p-direct", Some("p-rep"))
            .unwrap();
        let bundle = uc.resolve_task_bundle(&task.id).unwrap();
        assert_eq!(bundle.prompts.len(), 1);
        assert_eq!(bundle.prompts[0].prompt.id, "p-direct");
        assert!(!bundle.prompts[0].overridden);
        assert!(bundle.suppressed_prompts.is_empty());
    }

    /// Helper: cascade a skill onto the role so it shows up inherited.
    /// Returns `(task_id, source_skill_id)`.
    fn seed_inherited_skill(pool: &Pool) -> (String, &'static str) {
        use catique_infrastructure::db::repositories::inheritance::cascade_skill_attachment;
        use catique_infrastructure::db::repositories::roles as roles_repo;
        use catique_infrastructure::db::repositories::tasks::AttachScope;

        let task_id = seed_bundle_skills_fixture(pool);
        {
            let conn = pool.get().unwrap();
            roles_repo::add_role_skill(&conn, "rl", "sk1", 1.0).unwrap();
            cascade_skill_attachment(&conn, &AttachScope::Role("rl".into()), "sk1", 1.0).unwrap();
        }
        (task_id, "sk1")
    }

    #[test]
    fn override_v2_suppress_skill_removes_from_bundle() {
        let pool = fresh_pool();
        let (task_id, src) = seed_inherited_skill(&pool);
        let uc = TasksUseCase::new(&pool);

        uc.set_task_skill_override_v2(&task_id, src, None).unwrap();
        let bundle = uc.resolve_task_bundle(&task_id).unwrap();
        assert!(bundle.skills.is_empty());
        assert_eq!(bundle.suppressed_skills.len(), 1);
        assert_eq!(bundle.suppressed_skills[0].id, "sk1");
    }

    #[test]
    fn override_v2_replace_skill_substitutes_and_keeps_origin() {
        let pool = fresh_pool();
        let (task_id, src) = seed_inherited_skill(&pool);
        let uc = TasksUseCase::new(&pool);

        uc.set_task_skill_override_v2(&task_id, src, Some("sk2"))
            .unwrap();
        let bundle = uc.resolve_task_bundle(&task_id).unwrap();
        assert_eq!(bundle.skills.len(), 1);
        assert_eq!(bundle.skills[0].skill.id, "sk2");
        assert_eq!(bundle.skills[0].origin, OriginRef::Role("rl".into()));
        assert!(bundle.skills[0].overridden);
    }

    #[test]
    fn override_v2_clear_skill_restores_inherited() {
        let pool = fresh_pool();
        let (task_id, src) = seed_inherited_skill(&pool);
        let uc = TasksUseCase::new(&pool);

        uc.set_task_skill_override_v2(&task_id, src, Some("sk2"))
            .unwrap();
        uc.clear_task_skill_override_v2(&task_id, src).unwrap();
        let bundle = uc.resolve_task_bundle(&task_id).unwrap();
        assert_eq!(bundle.skills.len(), 1);
        assert_eq!(bundle.skills[0].skill.id, "sk1");
        assert!(!bundle.skills[0].overridden);
    }

    /// Helper: cascade an mcp_tool onto the role so it shows up
    /// inherited. Returns `(task_id, source_tool_id)`.
    fn seed_inherited_mcp_tool(pool: &Pool) -> (String, &'static str) {
        use catique_infrastructure::db::repositories::inheritance::cascade_mcp_tool_attachment;
        use catique_infrastructure::db::repositories::roles as roles_repo;
        use catique_infrastructure::db::repositories::tasks::AttachScope;

        let task_id = seed_bundle_skills_fixture(pool);
        {
            let conn = pool.get().unwrap();
            roles_repo::add_role_mcp_tool(&conn, "rl", "mt1", 1.0).unwrap();
            cascade_mcp_tool_attachment(&conn, &AttachScope::Role("rl".into()), "mt1", 1.0)
                .unwrap();
        }
        (task_id, "mt1")
    }

    #[test]
    fn override_v2_suppress_mcp_tool_removes_from_bundle() {
        let pool = fresh_pool();
        let (task_id, src) = seed_inherited_mcp_tool(&pool);
        let uc = TasksUseCase::new(&pool);

        uc.set_task_mcp_tool_override_v2(&task_id, src, None)
            .unwrap();
        let bundle = uc.resolve_task_bundle(&task_id).unwrap();
        assert!(bundle.mcp_tools.is_empty());
        assert_eq!(bundle.suppressed_mcp_tools.len(), 1);
        assert_eq!(bundle.suppressed_mcp_tools[0].id, "mt1");
    }

    #[test]
    fn override_v2_replace_mcp_tool_substitutes_and_keeps_origin() {
        let pool = fresh_pool();
        let (task_id, src) = seed_inherited_mcp_tool(&pool);
        let uc = TasksUseCase::new(&pool);

        uc.set_task_mcp_tool_override_v2(&task_id, src, Some("mt2"))
            .unwrap();
        let bundle = uc.resolve_task_bundle(&task_id).unwrap();
        assert_eq!(bundle.mcp_tools.len(), 1);
        assert_eq!(bundle.mcp_tools[0].mcp_tool.id, "mt2");
        assert_eq!(bundle.mcp_tools[0].origin, OriginRef::Role("rl".into()));
        assert!(bundle.mcp_tools[0].overridden);
    }

    #[test]
    fn override_v2_clear_mcp_tool_restores_inherited() {
        let pool = fresh_pool();
        let (task_id, src) = seed_inherited_mcp_tool(&pool);
        let uc = TasksUseCase::new(&pool);

        uc.set_task_mcp_tool_override_v2(&task_id, src, Some("mt2"))
            .unwrap();
        uc.clear_task_mcp_tool_override_v2(&task_id, src).unwrap();
        let bundle = uc.resolve_task_bundle(&task_id).unwrap();
        assert_eq!(bundle.mcp_tools.len(), 1);
        assert_eq!(bundle.mcp_tools[0].mcp_tool.id, "mt1");
        assert!(!bundle.mcp_tools[0].overridden);
    }

    // ----- catique-8: urgency round-trip ---------------------------------

    #[test]
    fn urgency_defaults_to_none_after_create() {
        let pool = fresh_pool();
        let uc = TasksUseCase::new(&pool);
        let t = uc
            .create("bd1".into(), "c1".into(), "T".into(), None, 1.0, None)
            .unwrap();
        assert_eq!(uc.get_urgency(&t.id).unwrap(), "none");
    }

    #[test]
    fn set_urgency_round_trip() {
        let pool = fresh_pool();
        let uc = TasksUseCase::new(&pool);
        let t = uc
            .create("bd1".into(), "c1".into(), "T".into(), None, 1.0, None)
            .unwrap();
        let r = uc.set_urgency(&t.id, "high").unwrap();
        assert_eq!(r, "high");
        assert_eq!(uc.get_urgency(&t.id).unwrap(), "high");
    }

    #[test]
    fn set_urgency_invalid_value_returns_validation() {
        let pool = fresh_pool();
        let uc = TasksUseCase::new(&pool);
        let t = uc
            .create("bd1".into(), "c1".into(), "T".into(), None, 1.0, None)
            .unwrap();
        match uc.set_urgency(&t.id, "BOGUS").expect_err("validation") {
            AppError::Validation { field, .. } => assert_eq!(field, "urgency"),
            other => panic!("got {other:?}"),
        }
    }

    #[test]
    fn set_urgency_missing_task_returns_not_found() {
        let pool = fresh_pool();
        let uc = TasksUseCase::new(&pool);
        match uc.set_urgency("ghost", "low").expect_err("not found") {
            AppError::NotFound { entity, .. } => assert_eq!(entity, "task"),
            other => panic!("got {other:?}"),
        }
    }

    #[test]
    fn get_urgency_missing_task_returns_not_found() {
        let pool = fresh_pool();
        let uc = TasksUseCase::new(&pool);
        match uc.get_urgency("ghost").expect_err("not found") {
            AppError::NotFound { entity, .. } => assert_eq!(entity, "task"),
            other => panic!("got {other:?}"),
        }
    }

    // -----------------------------------------------------------------
    // Refactor-v3 D-B — denormalised effective-context counters.
    //
    // The kanban card surface reads `effective_prompt_count` /
    // `effective_skill_count` / `effective_tool_count` directly. The
    // tests below pin three invariants:
    //
    //   T1: scope-level attachments bump the counter on every task in
    //       scope (role + board cascade).
    //   T2: a suppress override DEcrements the counter on the affected
    //       task.
    //   T3: clearing the suppress override restores the counter; a
    //       replace override leaves cardinality unchanged.
    //
    // These mirror the acceptance criteria from the D-B decision memo.
    // -----------------------------------------------------------------

    /// Helper: seed a role + two prompts + one task on the role, and a
    /// second prompt at the board scope. Returns the task id.
    /// `bd1` already exists via `fresh_pool`; we add the role +
    /// prompts inline so the test reads end-to-end.
    fn seed_for_counter_tests(pool: &Pool) -> String {
        let uc = TasksUseCase::new(pool);
        {
            let conn = pool.get().unwrap();
            conn.execute_batch(
                "INSERT INTO roles (id, name, content, created_at, updated_at) \
                     VALUES ('rl', 'R', '', 0, 0); \
                 INSERT INTO prompts (id, name, content, created_at, updated_at) VALUES \
                     ('p-role-a', 'role-a', '', 0, 0), \
                     ('p-role-b', 'role-b', '', 0, 0), \
                     ('p-board', 'board', '', 0, 0), \
                     ('p-rep', 'rep', '', 0, 0);",
            )
            .unwrap();
        }
        let task = uc
            .create(
                "bd1".into(),
                "c1".into(),
                "T".into(),
                None,
                1.0,
                Some("rl".into()),
            )
            .unwrap();
        task.id
    }

    #[test]
    fn effective_counts_zero_on_fresh_task() {
        let pool = fresh_pool();
        let uc = TasksUseCase::new(&pool);
        let task = uc
            .create("bd1".into(), "c1".into(), "T".into(), None, 1.0, None)
            .unwrap();
        assert_eq!(task.effective_prompt_count, 0);
        assert_eq!(task.effective_skill_count, 0);
        assert_eq!(task.effective_tool_count, 0);
    }

    /// T1: role-scope set + board-scope set both bump the counter on
    /// every task whose role/board matches.
    #[test]
    fn effective_prompt_count_bumps_on_role_and_board_attach() {
        let pool = fresh_pool();
        let task_id = seed_for_counter_tests(&pool);
        let uc = TasksUseCase::new(&pool);

        // Attach two prompts at the role scope.
        crate::roles::RolesUseCase::new(&pool)
            .set_role_prompts("rl".into(), vec!["p-role-a".into(), "p-role-b".into()])
            .unwrap();
        let after_role = uc.get(&task_id).unwrap();
        assert_eq!(
            after_role.effective_prompt_count, 2,
            "two role-scope prompts must be counted on the inheriting task"
        );

        // Attach one prompt at the board scope.
        crate::boards::BoardsUseCase::new(&pool)
            .set_board_prompts("bd1".into(), vec!["p-board".into()])
            .unwrap();
        let after_board = uc.get(&task_id).unwrap();
        assert_eq!(
            after_board.effective_prompt_count, 3,
            "board-scope prompt adds one more"
        );
    }

    /// T2: a suppress override DEcrements the counter on the affected
    /// task.
    #[test]
    fn effective_prompt_count_decrements_on_suppress_override() {
        let pool = fresh_pool();
        let task_id = seed_for_counter_tests(&pool);
        let uc = TasksUseCase::new(&pool);

        crate::roles::RolesUseCase::new(&pool)
            .set_role_prompts("rl".into(), vec!["p-role-a".into(), "p-role-b".into()])
            .unwrap();
        crate::boards::BoardsUseCase::new(&pool)
            .set_board_prompts("bd1".into(), vec!["p-board".into()])
            .unwrap();
        assert_eq!(uc.get(&task_id).unwrap().effective_prompt_count, 3);

        // Suppress one of the inherited prompts.
        uc.set_task_prompt_override_v2(&task_id, "p-role-a", None)
            .unwrap();
        let after_suppress = uc.get(&task_id).unwrap();
        assert_eq!(
            after_suppress.effective_prompt_count, 2,
            "suppress override DEcrements the effective count"
        );
    }

    /// T3: clearing the suppress restores the count; a replace override
    /// leaves cardinality unchanged.
    #[test]
    fn effective_prompt_count_handles_clear_and_replace() {
        let pool = fresh_pool();
        let task_id = seed_for_counter_tests(&pool);
        let uc = TasksUseCase::new(&pool);

        crate::roles::RolesUseCase::new(&pool)
            .set_role_prompts("rl".into(), vec!["p-role-a".into(), "p-role-b".into()])
            .unwrap();
        crate::boards::BoardsUseCase::new(&pool)
            .set_board_prompts("bd1".into(), vec!["p-board".into()])
            .unwrap();

        // Suppress, then clear → back to 3.
        uc.set_task_prompt_override_v2(&task_id, "p-role-a", None)
            .unwrap();
        assert_eq!(uc.get(&task_id).unwrap().effective_prompt_count, 2);
        uc.clear_task_prompt_override_v2(&task_id, "p-role-a")
            .unwrap();
        assert_eq!(
            uc.get(&task_id).unwrap().effective_prompt_count,
            3,
            "clearing the suppress restores the counter"
        );

        // Replace `p-role-b` with `p-rep`: cardinality MUST stay at 3
        // (one row in, one row out).
        uc.set_task_prompt_override_v2(&task_id, "p-role-b", Some("p-rep"))
            .unwrap();
        assert_eq!(
            uc.get(&task_id).unwrap().effective_prompt_count,
            3,
            "replace override does not change cardinality"
        );
    }
}
