//! Spaces use case.
//!
//! Wave-E2.4 (Olga). Mirrors `BoardsUseCase`. Validation: non-empty
//! `name` (≤ 200 chars), `prefix` matches the schema CHECK
//! `[a-z0-9-]{1,10}` — we re-implement the check in Rust so the
//! `AppError::Validation` is friendlier than a raw constraint failure.
//! Optional `color` is validated as `#RRGGBB`; `icon` is opaque to the
//! backend (the frontend owns the identifier set).

use std::path::PathBuf;

use catique_domain::{Prompt, Space};
use catique_infrastructure::db::{
    pool::{acquire, Pool},
    repositories::{
        boards::{self as boards_repo, BoardDraft},
        columns as columns_repo,
        inheritance::{self as inh, InheritanceScope},
        prompts::PromptRow,
        roles as roles_repo,
        spaces::{self as repo, SpaceDraft, SpacePatch, SpaceRow},
        tasks::{
            cascade_clear_scope, cascade_prompt_attachment, cascade_prompt_detachment,
            recompute_effective_counts_for_scope, AttachScope,
        },
    },
};

use crate::{
    agent_files,
    error::AppError,
    error_map::{map_db_err, map_db_err_unique, validate_non_empty, validate_optional_color},
    workflow::{self, NodeNameLookup, WorkflowGraph},
};

/// Default name for the auto-created board landed in every newly
/// created space. Maintainer feedback (D-006, 2026-05-06) standardised
/// this on "Owner" — migration
/// `016_default_board_naming_and_constraints.sql` rebrands every
/// pre-existing default board to the same value. The user can still
/// rename it freely afterwards; uniqueness lives in
/// `(space_id, owner_role_id)`, not in the display name.
const DEFAULT_BOARD_NAME: &str = "Owner";

/// Default icon for the auto-created board. Mirrors the frontend's
/// neutral-default convention (see `src/shared/ui/Icon/index.ts`); the
/// backend stores the identifier as opaque text.
const DEFAULT_BOARD_ICON: &str = "PixelInterfaceEssentialList";

/// Default name for the mandatory default column auto-created on every
/// new board (migration `016_default_board_naming_and_constraints.sql`).
/// Same string as `DEFAULT_BOARD_NAME` because both signal "this is the
/// canonical landing spot when the user has not yet curated names".
/// Default name for the auto-created column landed in every newly
/// minted board. The board itself reads as the role/owner ("Owner");
/// the column is the *bucket* of incoming work — kanban-idiomatic
/// "To Do". Migration `019_default_columns_backfill.sql` renames
/// pre-existing default columns named "Owner" to the same value.
const DEFAULT_COLUMN_NAME: &str = "To Do";

const PREFIX_MAX_LEN: usize = 10;

/// Spaces use case — borrows the application's connection pool.
pub struct SpacesUseCase<'a> {
    pool: &'a Pool,
}

/// Argument bag for [`SpacesUseCase::create`]. Keeps the call site
/// readable now that spaces carry both `color` and `icon` alongside the
/// existing primary fields.
#[derive(Debug, Clone, Default)]
pub struct CreateSpaceArgs {
    pub name: String,
    pub prefix: String,
    pub description: Option<String>,
    /// Optional `#RRGGBB` colour.
    pub color: Option<String>,
    /// Optional pixel-icon identifier — opaque to the backend.
    pub icon: Option<String>,
    pub is_default: bool,
    /// Round-21 opaque project folder path. The frontend interprets it.
    pub project_folder_path: Option<String>,
}

/// Argument bag for [`SpacesUseCase::update`]. Nullable fields use the
/// `Option<Option<String>>` shape to discriminate "leave alone" vs.
/// "clear to NULL" vs. "set".
#[derive(Debug, Clone, Default)]
pub struct UpdateSpaceArgs {
    pub id: String,
    pub name: Option<String>,
    pub description: Option<Option<String>>,
    pub color: Option<Option<String>>,
    pub icon: Option<Option<String>>,
    pub is_default: Option<bool>,
    pub position: Option<f64>,
    /// Round-21 opaque project folder path.
    /// `None` = leave alone; `Some(None)` = clear; `Some(Some(s))` = set.
    pub project_folder_path: Option<Option<String>>,
}

impl<'a> SpacesUseCase<'a> {
    /// Constructor.
    #[must_use]
    pub fn new(pool: &'a Pool) -> Self {
        Self { pool }
    }

    /// List every space, ordered by `(position, name)`.
    ///
    /// # Errors
    ///
    /// Forwards storage-layer errors (see `error_map`).
    pub fn list(&self) -> Result<Vec<Space>, AppError> {
        let conn = acquire(self.pool).map_err(map_db_err)?;
        let rows = repo::list_all(&conn).map_err(map_db_err)?;
        Ok(rows.into_iter().map(row_to_space).collect())
    }

    /// Look up a space by id.
    ///
    /// # Errors
    ///
    /// `AppError::NotFound { entity: "space", … }` if missing.
    pub fn get(&self, id: &str) -> Result<Space, AppError> {
        let conn = acquire(self.pool).map_err(map_db_err)?;
        match repo::get_by_id(&conn, id).map_err(map_db_err)? {
            Some(row) => Ok(row_to_space(row)),
            None => Err(AppError::NotFound {
                entity: "space".into(),
                id: id.to_owned(),
            }),
        }
    }

    /// Create a space.
    ///
    /// Migration `009_default_boards.sql` makes this a two-row insert:
    /// the space itself plus an auto-provisioned default board. Both
    /// rows land inside the same `IMMEDIATE` transaction — if the
    /// board insert fails (e.g. role FK violation, or a contrived
    /// disk-full edge case), the space row rolls back too so the user
    /// never sees a half-formed space without a default board.
    ///
    /// # Errors
    ///
    /// `AppError::Validation` for empty `name` / malformed `prefix` /
    /// malformed `color`, `AppError::Conflict` for UNIQUE(prefix)
    /// collisions.
    #[allow(clippy::needless_pass_by_value)]
    pub fn create(&self, args: CreateSpaceArgs) -> Result<Space, AppError> {
        let trimmed_name = validate_non_empty("name", &args.name)?;
        validate_prefix(&args.prefix)?;
        validate_optional_color("color", args.color.as_deref())?;
        let mut conn = acquire(self.pool).map_err(map_db_err)?;
        let tx = conn
            .transaction_with_behavior(rusqlite::TransactionBehavior::Immediate)
            .map_err(|e| map_db_err(e.into()))?;

        let row = repo::insert(
            &tx,
            &SpaceDraft {
                name: trimmed_name,
                prefix: args.prefix,
                description: args.description,
                color: args.color,
                icon: args.icon,
                is_default: args.is_default,
                position: None,
                project_folder_path: args.project_folder_path,
            },
        )
        .map_err(|e| map_db_err_unique(e, "space"))?;

        // Auto-provision the default board (migration 009). The
        // dropped tx in the error path rolls the space insert back
        // automatically.
        let board_row = boards_repo::insert(
            &tx,
            &BoardDraft {
                name: DEFAULT_BOARD_NAME.to_owned(),
                space_id: row.id.clone(),
                role_id: None,
                position: Some(0.0),
                description: None,
                color: None,
                icon: Some(DEFAULT_BOARD_ICON.to_owned()),
                is_default: true,
                // Falls back to the seeded `maintainer-system` row
                // (Cat-as-Agent Phase 1 / memo Q1) — same default the
                // IPC `create_board` uses.
                owner_role_id: None,
            },
        )
        .map_err(map_db_err)?;

        // Auto-provision the default column on the freshly-minted
        // board (migration `016_default_board_naming_and_constraints.sql`).
        // The cross-board task-move IPC and the resolver both assume
        // every board carries one default column; planting it here
        // keeps that invariant true from the moment the space exists.
        columns_repo::insert(
            &tx,
            &columns_repo::ColumnDraft {
                board_id: board_row.id.clone(),
                name: DEFAULT_COLUMN_NAME.to_owned(),
                position: 0,
                role_id: None,
                is_default: true,
                icon: None,
                color: None,
            },
        )
        .map_err(map_db_err)?;

        tx.commit().map_err(|e| map_db_err(e.into()))?;
        Ok(row_to_space(row))
    }

    /// Partial update.
    ///
    /// # Errors
    ///
    /// `AppError::NotFound` if id is unknown; usual validation /
    /// constraint mappings.
    #[allow(clippy::needless_pass_by_value)]
    pub fn update(&self, args: UpdateSpaceArgs) -> Result<Space, AppError> {
        if let Some(n) = args.name.as_deref() {
            validate_non_empty("name", n)?;
        }
        if let Some(Some(c)) = args.color.as_ref() {
            validate_optional_color("color", Some(c))?;
        }
        let conn = acquire(self.pool).map_err(map_db_err)?;
        let patch = SpacePatch {
            name: args.name.map(|n| n.trim().to_owned()),
            description: args.description,
            color: args.color,
            icon: args.icon,
            is_default: args.is_default,
            position: args.position,
            project_folder_path: args.project_folder_path,
        };
        match repo::update(&conn, &args.id, &patch).map_err(map_db_err)? {
            Some(row) => Ok(row_to_space(row)),
            None => Err(AppError::NotFound {
                entity: "space".into(),
                id: args.id,
            }),
        }
    }

    /// Delete a space and every board it owns (cascading down to
    /// columns + tasks via the existing FK rules).
    ///
    /// Migration `001_initial.sql` declares `boards.space_id` as a
    /// plain `REFERENCES spaces(id)` without `ON DELETE CASCADE`, so a
    /// raw `DELETE FROM spaces` returns SQLITE_CONSTRAINT once any
    /// board exists for the space. Migration `009_default_boards.sql`
    /// makes that universal: every newly-created space owns one
    /// auto-provisioned default board, so without this in-use-case
    /// cascade no new space could ever be deleted.
    ///
    /// We sidestep both problems by walking the cascade in a single
    /// transaction: drop the boards (their child columns + tasks
    /// cascade naturally — those FKs DO carry `ON DELETE CASCADE`),
    /// then drop the space.
    ///
    /// # Errors
    ///
    /// `AppError::NotFound` if id is unknown; transactional failure
    /// during the cascade surfaces as `AppError::TransactionRolledBack`.
    pub fn delete(&self, id: &str) -> Result<(), AppError> {
        let mut conn = acquire(self.pool).map_err(map_db_err)?;
        let tx = conn
            .transaction()
            .map_err(|e| AppError::TransactionRolledBack {
                reason: e.to_string(),
            })?;

        // Tear down owned boards first; FKs from columns/tasks/etc.
        // back to boards already cascade.
        tx.execute("DELETE FROM boards WHERE space_id = ?1", [id])
            .map_err(|e| AppError::TransactionRolledBack {
                reason: e.to_string(),
            })?;

        let removed = tx
            .execute("DELETE FROM spaces WHERE id = ?1", [id])
            .map_err(|e| AppError::TransactionRolledBack {
                reason: e.to_string(),
            })?;

        if removed == 0 {
            // Nothing to commit — the space wasn't there to begin with.
            return Err(AppError::NotFound {
                entity: "space".into(),
                id: id.to_owned(),
            });
        }

        tx.commit().map_err(|e| AppError::TransactionRolledBack {
            reason: e.to_string(),
        })?;
        Ok(())
    }

    // ------------------------------------------------------------------
    // space_prompts join (D9 / ctq-99 / migration 011_space_prompts.sql).
    //
    // Fourth-level prompt-inheritance attachments. The resolver
    // (ctq-100) consumes this read path; the IPC handlers expose the
    // four operations the frontend needs for the dnd-kit reorder UX.
    // ------------------------------------------------------------------

    /// List every prompt attached to a space, ordered by
    /// `space_prompts.position` ascending. Returns an empty Vec when no
    /// prompts are attached.
    ///
    /// # Errors
    ///
    /// Forwards storage-layer errors.
    pub fn list_space_prompts(&self, space_id: &str) -> Result<Vec<Prompt>, AppError> {
        let conn = acquire(self.pool).map_err(map_db_err)?;
        let rows = repo::list_space_prompts(&conn, space_id).map_err(map_db_err)?;
        Ok(rows.into_iter().map(prompt_row_to_prompt).collect())
    }

    /// Attach a prompt to a space. Upserts `position` if the pair
    /// already exists (matches `add_board_prompt` / `add_column_prompt`
    /// semantics).
    ///
    /// ADR-0006 (write-time materialisation): immediately after the
    /// join-table insert, every task whose board lives in this space
    /// gets a `task_prompts` row tagged `origin = 'space:<space_id>'`.
    ///
    /// # Errors
    ///
    /// `AppError::TransactionRolledBack` on FK violation (unknown space
    /// or prompt id).
    pub fn add_space_prompt(
        &self,
        space_id: &str,
        prompt_id: &str,
        position: Option<f64>,
    ) -> Result<(), AppError> {
        let mut conn = acquire(self.pool).map_err(map_db_err)?;
        let tx = conn
            .transaction_with_behavior(rusqlite::TransactionBehavior::Immediate)
            .map_err(|e| map_db_err(e.into()))?;
        repo::add_space_prompt(&tx, space_id, prompt_id, position).map_err(map_db_err)?;
        let pos = position.unwrap_or(0.0);
        let scope = AttachScope::Space(space_id.to_owned());
        cascade_prompt_attachment(&tx, &scope, prompt_id, pos).map_err(map_db_err)?;
        // Refactor-v3 D-B: bump prompt counters on every task whose
        // board lives in this space.
        recompute_effective_counts_for_scope(&tx, &scope).map_err(map_db_err)?;
        tx.commit().map_err(|e| map_db_err(e.into()))?;
        Ok(())
    }

    /// Detach a prompt from a space.
    ///
    /// Symmetric to [`Self::add_space_prompt`]: strips both the
    /// join-table row and every materialised `task_prompts` row tagged
    /// `origin = 'space:<space_id>'`. Direct attachments survive.
    ///
    /// # Errors
    ///
    /// `AppError::NotFound { entity: "space_prompt", … }` when no row
    /// matched the `(space_id, prompt_id)` pair.
    pub fn remove_space_prompt(&self, space_id: &str, prompt_id: &str) -> Result<(), AppError> {
        let mut conn = acquire(self.pool).map_err(map_db_err)?;
        let tx = conn
            .transaction_with_behavior(rusqlite::TransactionBehavior::Immediate)
            .map_err(|e| map_db_err(e.into()))?;
        let removed = repo::remove_space_prompt(&tx, space_id, prompt_id).map_err(map_db_err)?;
        if removed {
            let scope = AttachScope::Space(space_id.to_owned());
            cascade_prompt_detachment(&tx, &scope, prompt_id).map_err(map_db_err)?;
            // Refactor-v3 D-B: decrement counters on every task in scope.
            recompute_effective_counts_for_scope(&tx, &scope).map_err(map_db_err)?;
            tx.commit().map_err(|e| map_db_err(e.into()))?;
            Ok(())
        } else {
            Err(AppError::NotFound {
                entity: "space_prompt".into(),
                id: format!("{space_id}|{prompt_id}"),
            })
        }
    }

    /// Atomically replace the full ordered prompt list for a space.
    /// Mirrors `prompt_groups::set_members` — single round-trip,
    /// savepoint-wrapped, FK violation rolls back.
    ///
    /// ADR-0006: clears every space-origin row, then re-cascades the new
    /// set. The whole operation runs in one immediate transaction so the
    /// resolver never observes a partial sync.
    ///
    /// # Errors
    ///
    /// `AppError::TransactionRolledBack` on FK violation (unknown space
    /// or any prompt id).
    #[allow(clippy::needless_pass_by_value)]
    pub fn set_space_prompts(
        &self,
        space_id: String,
        ordered_prompt_ids: Vec<String>,
    ) -> Result<(), AppError> {
        let mut conn = acquire(self.pool).map_err(map_db_err)?;
        let tx = conn
            .transaction_with_behavior(rusqlite::TransactionBehavior::Immediate)
            .map_err(|e| map_db_err(e.into()))?;
        repo::set_space_prompts(&tx, &space_id, &ordered_prompt_ids).map_err(map_db_err)?;
        let scope = AttachScope::Space(space_id.clone());
        // Wipe the scope's prior contributions, then re-cascade the new
        // ordered list with `position = idx + 1.0` (mirrors the
        // repository's `set_space_prompts` numbering).
        cascade_clear_scope(&tx, &scope).map_err(map_db_err)?;
        for (idx, pid) in ordered_prompt_ids.iter().enumerate() {
            #[allow(clippy::cast_precision_loss)]
            let pos = (idx + 1) as f64;
            cascade_prompt_attachment(&tx, &scope, pid, pos).map_err(map_db_err)?;
        }
        // Refactor-v3 D-B counter sync across the space.
        recompute_effective_counts_for_scope(&tx, &scope).map_err(map_db_err)?;
        tx.commit().map_err(|e| map_db_err(e.into()))?;
        Ok(())
    }

    /// Replace the space's skill list with `skill_ids`. ctq-120.
    ///
    /// # Errors
    ///
    /// Forwards storage-layer errors.
    pub fn set_skills(&self, space_id: &str, skill_ids: &[String]) -> Result<(), AppError> {
        let mut conn = acquire(self.pool).map_err(map_db_err)?;
        inh::set_skills(&mut conn, InheritanceScope::Space, space_id, skill_ids)
            .map_err(map_db_err)?;
        // Refactor-v3 D-B counter sync across the space.
        recompute_effective_counts_for_scope(&conn, &AttachScope::Space(space_id.to_owned()))
            .map_err(map_db_err)?;
        Ok(())
    }

    /// Replace the space's MCP-tool list. ctq-120.
    ///
    /// # Errors
    ///
    /// Forwards storage-layer errors.
    pub fn set_mcp_tools(&self, space_id: &str, mcp_tool_ids: &[String]) -> Result<(), AppError> {
        let mut conn = acquire(self.pool).map_err(map_db_err)?;
        inh::set_mcp_tools(&mut conn, InheritanceScope::Space, space_id, mcp_tool_ids)
            .map_err(map_db_err)?;
        // Refactor-v3 D-B counter sync across the space.
        recompute_effective_counts_for_scope(&conn, &AttachScope::Space(space_id.to_owned()))
            .map_err(map_db_err)?;
        Ok(())
    }

    /// Read the Phase 5 workflow-graph payload for `space_id`. ctq-113.
    ///
    /// Returns `Ok(None)` for an unset slot — the post-migration default
    /// for every existing space — and *also* for an unknown space id.
    /// The IPC contract treats both as "no graph configured"; rejecting
    /// the unknown-id case would force the frontend to pre-check the
    /// space exists, which is friction we don't want for a stub.
    ///
    /// # Errors
    ///
    /// Forwards storage-layer errors.
    pub fn get_workflow_graph(&self, space_id: &str) -> Result<Option<String>, AppError> {
        let conn = acquire(self.pool).map_err(map_db_err)?;
        repo::get_workflow_graph(&conn, space_id).map_err(map_db_err)
    }

    /// Persist `json` as the workflow-graph payload for `space_id`.
    /// ctq-113 — Phase 5 stub. **No JSON validation here**: the future
    /// editor task owns the payload schema.
    ///
    /// `AppError::NotFound` for unknown space ids — distinct from
    /// `get_workflow_graph` because the writer must signal "no row
    /// to overwrite" so the UI can route the user to creating a space
    /// first rather than silently dropping the payload.
    ///
    /// # Errors
    ///
    /// `AppError::NotFound` if the space does not exist; storage-layer
    /// errors otherwise.
    #[allow(clippy::needless_pass_by_value)]
    pub fn set_workflow_graph(&self, space_id: String, json: String) -> Result<(), AppError> {
        let conn = acquire(self.pool).map_err(map_db_err)?;
        let updated = repo::set_workflow_graph(&conn, &space_id, &json).map_err(map_db_err)?;
        if updated {
            Ok(())
        } else {
            Err(AppError::NotFound {
                entity: "space".into(),
                id: space_id,
            })
        }
    }

    /// Render the space's workflow graph into the catique-hub-managed
    /// section of the project's `AGENTS.md` / `CLAUDE.md` file. Ties
    /// together catique-1 (`agent_files::upsert_section`) and
    /// catique-5 (`workflow::render_prompt`).
    ///
    /// Returns the absolute path of the file that was written. Useful
    /// for surfacing in IPC responses + log lines.
    ///
    /// # Errors
    ///
    /// * `AppError::NotFound` — space id unknown.
    /// * `AppError::Validation { field: "project_folder_path", … }` —
    ///   the space has no project folder bound.
    /// * `AppError::Validation { field: "workflow_graph_json", … }` —
    ///   the stored payload is not parseable as a [`WorkflowGraph`].
    /// * Filesystem failures bubble up as the generic
    ///   `AppError::Unknown` (via `agent_files` → string mapping)
    ///   so the caller can surface the underlying message.
    pub fn sync_workflow_to_agent_file(&self, space_id: &str) -> Result<PathBuf, AppError> {
        // 1. Resolve space + project folder + raw graph.
        let conn = acquire(self.pool).map_err(map_db_err)?;
        let space = repo::get_by_id(&conn, space_id)
            .map_err(map_db_err)?
            .ok_or_else(|| AppError::NotFound {
                entity: "space".into(),
                id: space_id.to_owned(),
            })?;
        let project_folder = space
            .project_folder_path
            .ok_or_else(|| AppError::Validation {
                field: "project_folder_path".into(),
                reason: "space has no project folder bound; set one before syncing".into(),
            })?;
        let raw_graph = space.workflow_graph_json.unwrap_or_default();
        let graph: WorkflowGraph = if raw_graph.trim().is_empty() {
            WorkflowGraph::default()
        } else {
            serde_json::from_str(&raw_graph).map_err(|e| AppError::Validation {
                field: "workflow_graph_json".into(),
                reason: format!("not a valid WorkflowGraph payload: {e}"),
            })?
        };

        // 2. Build role-name lookup from the current roles table. We
        // do not narrow to roles referenced by the graph: the lookup
        // is small (≤ low hundreds) and missing-id paths gracefully
        // fall back to the raw role_id string anyway.
        let role_rows = roles_repo::list_all(&conn).map_err(map_db_err)?;
        let lookup = RoleNameMap::from_rows(&role_rows);
        drop(conn);

        // 3. Render + write under the dedicated `workflow` section
        // marker so the owner block (catique-1) stays untouched.
        let body = workflow::render_prompt(&graph, &lookup);
        let target = agent_files::resolve_agent_file(std::path::Path::new(&project_folder));
        agent_files::upsert_keyed_section(&target, "workflow", &body).map_err(|e| {
            AppError::Upstream {
                kind: "filesystem".into(),
                message: format!("agent_files upsert failed: {e}"),
            }
        })?;
        Ok(target)
    }

    /// catique-1: write (or refresh) the owner role's body into the
    /// project's agent file. Looks up the space's project folder,
    /// resolves the owner role of the default board, and upserts its
    /// content under the `owner` marker block.
    ///
    /// # Errors
    ///
    /// * `AppError::NotFound` — space id unknown or no default board.
    /// * `AppError::Validation { field: "project_folder_path", … }` —
    ///   the space has no project folder bound.
    /// * `AppError::Upstream { kind: "filesystem", … }` — write failed.
    pub fn sync_owner_to_agent_file(&self, space_id: &str) -> Result<PathBuf, AppError> {
        let conn = acquire(self.pool).map_err(map_db_err)?;
        let space = repo::get_by_id(&conn, space_id)
            .map_err(map_db_err)?
            .ok_or_else(|| AppError::NotFound {
                entity: "space".into(),
                id: space_id.to_owned(),
            })?;
        let project_folder = space
            .project_folder_path
            .ok_or_else(|| AppError::Validation {
                field: "project_folder_path".into(),
                reason: "space has no project folder bound; set one before syncing".into(),
            })?;

        // Owner role = the role attached to the default board of the
        // space. `owner_role_id` is NOT NULL at schema level (see
        // migration 004); we just need to find that one board.
        let boards = boards_repo::list_by_space(&conn, space_id).map_err(map_db_err)?;
        let default_board =
            boards
                .into_iter()
                .find(|b| b.is_default)
                .ok_or_else(|| AppError::NotFound {
                    entity: "default_board".into(),
                    id: space_id.to_owned(),
                })?;
        let owner_role = roles_repo::get_by_id(&conn, &default_board.owner_role_id)
            .map_err(map_db_err)?
            .ok_or_else(|| AppError::NotFound {
                entity: "role".into(),
                id: default_board.owner_role_id.clone(),
            })?;
        drop(conn);

        let body = format!("## Owner: {}\n\n{}", owner_role.name, owner_role.content);
        let target = agent_files::resolve_agent_file(std::path::Path::new(&project_folder));
        agent_files::upsert_keyed_section(&target, "owner", &body).map_err(|e| {
            AppError::Upstream {
                kind: "filesystem".into(),
                message: format!("agent_files upsert failed: {e}"),
            }
        })?;
        Ok(target)
    }
}

/// Cheap in-memory `role_id → display_name` index used by the
/// workflow renderer. Built once per
/// [`SpacesUseCase::sync_workflow_to_agent_file`] call from
/// `roles::list_all`.
struct RoleNameMap {
    by_id: std::collections::HashMap<String, String>,
}

impl RoleNameMap {
    fn from_rows(rows: &[roles_repo::RoleRow]) -> Self {
        let by_id = rows
            .iter()
            .map(|r| (r.id.clone(), r.name.clone()))
            .collect();
        Self { by_id }
    }
}

impl NodeNameLookup for RoleNameMap {
    fn role_name(&self, role_id: &str) -> Option<String> {
        self.by_id.get(role_id).cloned()
    }
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

fn validate_prefix(prefix: &str) -> Result<(), AppError> {
    if prefix.is_empty() || prefix.len() > PREFIX_MAX_LEN {
        return Err(AppError::Validation {
            field: "prefix".into(),
            reason: "must be 1-10 characters".into(),
        });
    }
    let ok = prefix
        .as_bytes()
        .iter()
        .all(|b| b.is_ascii_lowercase() || b.is_ascii_digit() || *b == b'-');
    if !ok {
        return Err(AppError::Validation {
            field: "prefix".into(),
            reason: "may contain only [a-z0-9-]".into(),
        });
    }
    Ok(())
}

fn row_to_space(row: SpaceRow) -> Space {
    Space {
        id: row.id,
        name: row.name,
        prefix: row.prefix,
        description: row.description,
        color: row.color,
        icon: row.icon,
        is_default: row.is_default,
        position: row.position,
        created_at: row.created_at,
        updated_at: row.updated_at,
        workflow_graph_json: row.workflow_graph_json,
        project_folder_path: row.project_folder_path,
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

    fn args(name: &str, prefix: &str) -> CreateSpaceArgs {
        CreateSpaceArgs {
            name: name.into(),
            prefix: prefix.into(),
            ..CreateSpaceArgs::default()
        }
    }

    #[test]
    fn create_with_bad_prefix_returns_validation() {
        let pool = fresh_pool();
        let uc = SpacesUseCase::new(&pool);
        let err = uc.create(args("S", "BAD-CASE")).expect_err("validation");
        match err {
            AppError::Validation { field, .. } => assert_eq!(field, "prefix"),
            other => panic!("got {other:?}"),
        }
    }

    #[test]
    fn create_with_empty_name_returns_validation() {
        let pool = fresh_pool();
        let uc = SpacesUseCase::new(&pool);
        match uc.create(args("", "abc")).expect_err("v") {
            AppError::Validation { field, .. } => assert_eq!(field, "name"),
            other => panic!("got {other:?}"),
        }
    }

    #[test]
    fn create_with_bad_color_returns_validation() {
        let pool = fresh_pool();
        let uc = SpacesUseCase::new(&pool);
        let mut a = args("S", "abc");
        a.color = Some("not-a-color".into());
        match uc.create(a).expect_err("v") {
            AppError::Validation { field, .. } => assert_eq!(field, "color"),
            other => panic!("got {other:?}"),
        }
    }

    #[test]
    fn duplicate_prefix_returns_conflict() {
        let pool = fresh_pool();
        let uc = SpacesUseCase::new(&pool);
        uc.create(args("A", "abc")).unwrap();
        let err = uc.create(args("B", "abc")).expect_err("conflict");
        match err {
            AppError::Conflict { entity, .. } => assert_eq!(entity, "space"),
            other => panic!("got {other:?}"),
        }
    }

    #[test]
    fn delete_returns_not_found_for_missing_id() {
        let pool = fresh_pool();
        let uc = SpacesUseCase::new(&pool);
        match uc.delete("ghost").expect_err("nf") {
            AppError::NotFound { entity, .. } => assert_eq!(entity, "space"),
            other => panic!("got {other:?}"),
        }
    }

    #[test]
    fn create_then_list_then_get() {
        let pool = fresh_pool();
        let uc = SpacesUseCase::new(&pool);
        let s = uc.create(args("S", "sp")).unwrap();
        let list = uc.list().unwrap();
        assert_eq!(list.len(), 1);
        let got = uc.get(&s.id).unwrap();
        assert_eq!(got.id, s.id);
    }

    #[test]
    fn update_changes_only_supplied_fields() {
        let pool = fresh_pool();
        let uc = SpacesUseCase::new(&pool);
        let s = uc.create(args("S", "sp")).unwrap();
        let updated = uc
            .update(UpdateSpaceArgs {
                id: s.id.clone(),
                name: Some("Renamed".into()),
                ..UpdateSpaceArgs::default()
            })
            .unwrap();
        assert_eq!(updated.name, "Renamed");
        assert_eq!(updated.prefix, "sp");
    }

    #[test]
    fn create_with_icon_and_color_round_trips() {
        let pool = fresh_pool();
        let uc = SpacesUseCase::new(&pool);
        let mut a = args("S", "sp");
        a.color = Some("#112233".into());
        a.icon = Some("star".into());
        let space = uc.create(a).unwrap();
        assert_eq!(space.color.as_deref(), Some("#112233"));
        assert_eq!(space.icon.as_deref(), Some("star"));
        let got = uc.get(&space.id).unwrap();
        assert_eq!(got.color.as_deref(), Some("#112233"));
        assert_eq!(got.icon.as_deref(), Some("star"));
    }

    #[test]
    fn update_can_set_clear_and_change_icon() {
        let pool = fresh_pool();
        let uc = SpacesUseCase::new(&pool);
        let space = uc.create(args("S", "sp")).unwrap();
        assert_eq!(space.icon, None);

        let after_set = uc
            .update(UpdateSpaceArgs {
                id: space.id.clone(),
                icon: Some(Some("bolt".into())),
                ..UpdateSpaceArgs::default()
            })
            .unwrap();
        assert_eq!(after_set.icon.as_deref(), Some("bolt"));

        let after_change = uc
            .update(UpdateSpaceArgs {
                id: space.id.clone(),
                icon: Some(Some("heart".into())),
                ..UpdateSpaceArgs::default()
            })
            .unwrap();
        assert_eq!(after_change.icon.as_deref(), Some("heart"));

        let after_clear = uc
            .update(UpdateSpaceArgs {
                id: space.id.clone(),
                icon: Some(None),
                ..UpdateSpaceArgs::default()
            })
            .unwrap();
        assert_eq!(after_clear.icon, None);
    }

    #[test]
    fn update_with_bad_color_returns_validation() {
        let pool = fresh_pool();
        let uc = SpacesUseCase::new(&pool);
        let space = uc.create(args("S", "sp")).unwrap();
        let err = uc
            .update(UpdateSpaceArgs {
                id: space.id,
                color: Some(Some("not-hex".into())),
                ..UpdateSpaceArgs::default()
            })
            .expect_err("v");
        match err {
            AppError::Validation { field, .. } => assert_eq!(field, "color"),
            other => panic!("got {other:?}"),
        }
    }

    // ------------------------------------------------------------------
    // Auto-provisioned default board on space creation (migration 009).
    // ------------------------------------------------------------------

    #[test]
    fn create_provisions_default_board() {
        let pool = fresh_pool();
        let uc = SpacesUseCase::new(&pool);
        let space = uc.create(args("S", "sp")).unwrap();

        // The default board must exist in the new space's row-set.
        let conn = pool.get().expect("acquire");
        let boards =
            catique_infrastructure::db::repositories::boards::list_by_space(&conn, &space.id)
                .expect("list_by_space");
        assert_eq!(
            boards.len(),
            1,
            "exactly one default board must land per new space"
        );
        let board = &boards[0];
        assert!(board.is_default, "auto-created board must carry is_default");
        // D-006 (migration 016) standardised the default board name on
        // "Owner". Migration 016 also renames every pre-existing one;
        // the use-case factory mints fresh boards with the new name.
        assert_eq!(board.name, "Owner");
        assert_eq!(board.icon.as_deref(), Some("PixelInterfaceEssentialList"));
        assert_eq!(board.description, None);
        assert_eq!(board.color, None);
        assert!(
            (board.position - 0.0).abs() < f64::EPSILON,
            "default board sits at position 0"
        );

        // D-006: the auto-created board carries exactly one default
        // column. Round-21 (migration 019) renamed it from "Owner" to
        // the kanban-idiomatic "To Do". Reuse the already-acquired
        // `conn` rather than re-acquiring (the in-memory pool is
        // single-connection — a second `acquire` would time out).
        let default_col_count: i64 = conn
            .query_row(
                "SELECT COUNT(*) FROM columns WHERE board_id = ?1 AND is_default = 1",
                rusqlite::params![board.id],
                |r| r.get(0),
            )
            .unwrap();
        assert_eq!(default_col_count, 1, "exactly one default column");
    }

    #[test]
    fn create_rolls_back_when_default_board_blocked() {
        // A failing space insert (duplicate prefix) must NOT leave a
        // dangling space row OR a dangling default board behind. We
        // can't easily force the *board* insert to fail without
        // reaching into the schema, so we cover the symmetric
        // invariant: the prefix UNIQUE error rolls back the entire
        // transaction, which means no orphaned board row either.
        let pool = fresh_pool();
        let uc = SpacesUseCase::new(&pool);
        uc.create(args("A", "abc")).unwrap();
        let _err = uc.create(args("B", "abc")).expect_err("conflict");

        // Only one space + one default board total.
        let conn = pool.get().unwrap();
        let space_count: i64 = conn
            .query_row("SELECT COUNT(*) FROM spaces", [], |r| r.get(0))
            .unwrap();
        assert_eq!(space_count, 1);
        let board_count: i64 = conn
            .query_row("SELECT COUNT(*) FROM boards", [], |r| r.get(0))
            .unwrap();
        assert_eq!(board_count, 1);
    }

    // ------------------------------------------------------------------
    // space_prompts (ctq-99 / migration 011_space_prompts.sql).
    // ------------------------------------------------------------------

    /// Insert a prompt directly via SQL so FK constraints are satisfied
    /// without touching the prompts use case (which we don't need here).
    fn seed_prompt(pool: &Pool, id: &str) {
        let conn = pool.get().unwrap();
        conn.execute(
            "INSERT INTO prompts (id, name, content, created_at, updated_at) \
             VALUES (?1, ?2, '', 0, 0)",
            rusqlite::params![id, id],
        )
        .unwrap();
    }

    #[test]
    fn space_prompts_round_trip_dod_check() {
        // DoD round-trip: create space → add 3 prompts → list returns
        // 3 in position order → remove 1 → list returns 2.
        let pool = fresh_pool();
        let uc = SpacesUseCase::new(&pool);
        let space = uc.create(args("S", "sp")).unwrap();
        for id in ["p1", "p2", "p3"] {
            seed_prompt(&pool, id);
        }

        uc.add_space_prompt(&space.id, "p1", Some(1.0)).unwrap();
        uc.add_space_prompt(&space.id, "p2", Some(2.0)).unwrap();
        uc.add_space_prompt(&space.id, "p3", Some(3.0)).unwrap();

        let listed: Vec<String> = uc
            .list_space_prompts(&space.id)
            .unwrap()
            .into_iter()
            .map(|p| p.id)
            .collect();
        assert_eq!(listed, vec!["p1", "p2", "p3"]);

        uc.remove_space_prompt(&space.id, "p2").unwrap();
        let after: Vec<String> = uc
            .list_space_prompts(&space.id)
            .unwrap()
            .into_iter()
            .map(|p| p.id)
            .collect();
        assert_eq!(after, vec!["p1", "p3"]);
    }

    #[test]
    fn remove_space_prompt_returns_not_found_when_pair_absent() {
        let pool = fresh_pool();
        let uc = SpacesUseCase::new(&pool);
        let space = uc.create(args("S", "sp")).unwrap();
        match uc.remove_space_prompt(&space.id, "ghost").expect_err("nf") {
            AppError::NotFound { entity, .. } => assert_eq!(entity, "space_prompt"),
            other => panic!("got {other:?}"),
        }
    }

    #[test]
    fn set_space_prompts_replaces_all() {
        let pool = fresh_pool();
        let uc = SpacesUseCase::new(&pool);
        let space = uc.create(args("S", "sp")).unwrap();
        for id in ["p1", "p2", "p3"] {
            seed_prompt(&pool, id);
        }

        uc.add_space_prompt(&space.id, "p1", Some(1.0)).unwrap();
        uc.add_space_prompt(&space.id, "p2", Some(2.0)).unwrap();

        uc.set_space_prompts(space.id.clone(), vec!["p3".into(), "p1".into()])
            .unwrap();

        let listed: Vec<String> = uc
            .list_space_prompts(&space.id)
            .unwrap()
            .into_iter()
            .map(|p| p.id)
            .collect();
        assert_eq!(listed, vec!["p3", "p1"]);
    }

    #[test]
    fn set_space_prompts_with_empty_clears_all() {
        let pool = fresh_pool();
        let uc = SpacesUseCase::new(&pool);
        let space = uc.create(args("S", "sp")).unwrap();
        seed_prompt(&pool, "p1");
        uc.add_space_prompt(&space.id, "p1", Some(1.0)).unwrap();

        uc.set_space_prompts(space.id.clone(), Vec::new()).unwrap();
        assert!(uc.list_space_prompts(&space.id).unwrap().is_empty());
    }

    // ------------------------------------------------------------------
    // ctq-113 — Phase 5 workflow-graph stub.
    // ------------------------------------------------------------------

    #[test]
    fn workflow_graph_round_trip_arbitrary_string() {
        let pool = fresh_pool();
        let uc = SpacesUseCase::new(&pool);
        let space = uc.create(args("S", "sp")).unwrap();
        // Initially unset.
        assert!(uc.get_workflow_graph(&space.id).unwrap().is_none());
        // Set + read back.
        let payload = r#"{"nodes":[{"id":"a"},{"id":"b"}]}"#;
        uc.set_workflow_graph(space.id.clone(), payload.into())
            .unwrap();
        let got = uc.get_workflow_graph(&space.id).unwrap();
        assert_eq!(got.as_deref(), Some(payload));
    }

    #[test]
    fn set_workflow_graph_returns_not_found_for_missing_space() {
        let pool = fresh_pool();
        let uc = SpacesUseCase::new(&pool);
        match uc
            .set_workflow_graph("ghost".into(), "{}".into())
            .expect_err("nf")
        {
            AppError::NotFound { entity, id } => {
                assert_eq!(entity, "space");
                assert_eq!(id, "ghost");
            }
            other => panic!("got {other:?}"),
        }
    }

    #[test]
    fn workflow_graph_get_returns_none_for_missing_space() {
        // ctq-113 stub contract: missing space collapses into "no graph".
        let pool = fresh_pool();
        let uc = SpacesUseCase::new(&pool);
        assert!(uc.get_workflow_graph("ghost").unwrap().is_none());
    }

    // ------------------------------------------------------------------
    // catique-5: sync_workflow_to_agent_file
    // ------------------------------------------------------------------

    fn args_with_folder(name: &str, prefix: &str, folder: &std::path::Path) -> CreateSpaceArgs {
        CreateSpaceArgs {
            name: name.into(),
            prefix: prefix.into(),
            project_folder_path: Some(folder.to_string_lossy().into_owned()),
            ..CreateSpaceArgs::default()
        }
    }

    #[test]
    fn sync_workflow_returns_not_found_for_missing_space() {
        let pool = fresh_pool();
        let uc = SpacesUseCase::new(&pool);
        match uc.sync_workflow_to_agent_file("ghost").expect_err("nf") {
            AppError::NotFound { entity, id } => {
                assert_eq!(entity, "space");
                assert_eq!(id, "ghost");
            }
            other => panic!("got {other:?}"),
        }
    }

    #[test]
    fn sync_workflow_requires_project_folder() {
        let pool = fresh_pool();
        let uc = SpacesUseCase::new(&pool);
        let space = uc.create(args("S", "sp")).unwrap();
        match uc
            .sync_workflow_to_agent_file(&space.id)
            .expect_err("validation")
        {
            AppError::Validation { field, .. } => assert_eq!(field, "project_folder_path"),
            other => panic!("got {other:?}"),
        }
    }

    #[test]
    fn sync_workflow_writes_empty_section_when_graph_unset() {
        let tmp = tempfile::TempDir::new().unwrap();
        let pool = fresh_pool();
        let uc = SpacesUseCase::new(&pool);
        let space = uc.create(args_with_folder("S", "sp", tmp.path())).unwrap();

        let path = uc.sync_workflow_to_agent_file(&space.id).unwrap();
        assert!(path.ends_with("AGENTS.md"));
        let body = std::fs::read_to_string(&path).unwrap();
        assert!(body.contains("catique-hub:workflow:begin"));
        assert!(body.contains("No workflow nodes configured yet"));
    }

    #[test]
    fn sync_workflow_renders_graph_with_role_names() {
        let tmp = tempfile::TempDir::new().unwrap();
        let pool = fresh_pool();
        // Seed two roles so the workflow lookup hits.
        {
            let conn = pool.get().unwrap();
            conn.execute_batch(
                "INSERT INTO roles (id, name, content, color, icon, created_at, updated_at, is_system) \
                 VALUES ('r-owner','WF-Owner-Test','',NULL,NULL,0,0,0), \
                        ('r-reviewer','WF-Reviewer-Test','',NULL,NULL,0,0,0);",
            )
            .unwrap();
        }

        let uc = SpacesUseCase::new(&pool);
        let space = uc.create(args_with_folder("S", "sp", tmp.path())).unwrap();
        let graph_json = serde_json::json!({
            "version": 1,
            "nodes": [
                { "id": "n1", "role_id": "r-owner",    "x": 0.0, "y": 0.0 },
                { "id": "n2", "role_id": "r-reviewer", "x": 200.0, "y": 0.0 }
            ],
            "edges": [
                { "id": "e1", "from_node": "n1", "to_node": "n2",
                  "kind": "route-on-success" }
            ]
        })
        .to_string();
        uc.set_workflow_graph(space.id.clone(), graph_json).unwrap();

        let path = uc.sync_workflow_to_agent_file(&space.id).unwrap();
        let body = std::fs::read_to_string(&path).unwrap();
        assert!(body.contains("**WF-Owner-Test**"));
        assert!(body.contains("**WF-Reviewer-Test**"));
        assert!(body.contains("on success, hands the task to"));

        // Idempotency: second call leaves a single workflow marker pair.
        uc.sync_workflow_to_agent_file(&space.id).unwrap();
        let body2 = std::fs::read_to_string(&path).unwrap();
        assert_eq!(body2.matches("catique-hub:workflow:begin").count(), 1);
    }

    #[test]
    fn sync_owner_writes_default_board_owner_role_content() {
        let tmp = tempfile::TempDir::new().unwrap();
        let pool = fresh_pool();
        let uc = SpacesUseCase::new(&pool);
        let space = uc.create(args_with_folder("S", "sp", tmp.path())).unwrap();
        // Plant a custom owner role + repoint the default board at it.
        {
            let conn = pool.get().unwrap();
            conn.execute(
                "INSERT INTO roles (id, name, content, color, icon, created_at, updated_at, is_system) \
                 VALUES ('r-custom-owner','Custom-Owner','You drive the project.',NULL,NULL,0,0,0)",
                [],
            )
            .unwrap();
            conn.execute(
                "UPDATE boards SET owner_role_id = 'r-custom-owner' WHERE space_id = ?1 AND is_default = 1",
                rusqlite::params![&space.id],
            )
            .unwrap();
        }

        let path = uc.sync_owner_to_agent_file(&space.id).unwrap();
        let body = std::fs::read_to_string(&path).unwrap();
        assert!(body.contains("catique-hub:owner:begin"));
        assert!(body.contains("## Owner: Custom-Owner"));
        assert!(body.contains("You drive the project."));
    }

    #[test]
    fn sync_owner_and_workflow_share_one_file_without_clobbering() {
        let tmp = tempfile::TempDir::new().unwrap();
        let pool = fresh_pool();
        let uc = SpacesUseCase::new(&pool);
        let space = uc.create(args_with_folder("S", "sp", tmp.path())).unwrap();
        // Empty workflow + a custom owner role; both sections must
        // land in the same file under separate markers.
        {
            let conn = pool.get().unwrap();
            conn.execute(
                "INSERT INTO roles (id, name, content, color, icon, created_at, updated_at, is_system) \
                 VALUES ('r-owner2','Shared-Owner','body',NULL,NULL,0,0,0)",
                [],
            )
            .unwrap();
            conn.execute(
                "UPDATE boards SET owner_role_id = 'r-owner2' WHERE space_id = ?1 AND is_default = 1",
                rusqlite::params![&space.id],
            )
            .unwrap();
        }
        uc.sync_owner_to_agent_file(&space.id).unwrap();
        let path = uc.sync_workflow_to_agent_file(&space.id).unwrap();
        let body = std::fs::read_to_string(&path).unwrap();
        assert!(body.contains("catique-hub:owner:begin"));
        assert!(body.contains("catique-hub:workflow:begin"));
        assert!(body.contains("Shared-Owner"));
        assert!(body.contains("Workflow"));
    }

    #[test]
    fn sync_workflow_rejects_invalid_graph_payload() {
        let tmp = tempfile::TempDir::new().unwrap();
        let pool = fresh_pool();
        let uc = SpacesUseCase::new(&pool);
        let space = uc.create(args_with_folder("S", "sp", tmp.path())).unwrap();
        // Plant a payload that is JSON but not a WorkflowGraph (top-level
        // is an array, not an object).
        uc.set_workflow_graph(space.id.clone(), "[1,2,3]".into())
            .unwrap();
        match uc
            .sync_workflow_to_agent_file(&space.id)
            .expect_err("validation")
        {
            AppError::Validation { field, .. } => {
                assert_eq!(field, "workflow_graph_json");
            }
            other => panic!("got {other:?}"),
        }
    }
}
