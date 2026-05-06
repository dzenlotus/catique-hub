//! Boards use case — orchestrates the [`infrastructure`] repository
//! against the `boards` table.
//!
//! Wave-E2.1 (Olga) shipped `list` / `get` / `create`. Wave-E2.4 adds
//! `update` and `delete` to round out the standard CRUD surface so the
//! IPC layer can expose the same five commands per entity. Migration
//! `008_space_board_icons_colors.sql` adds optional `color` + `icon`
//! presentation hints on top.
//!
//! Mapping rules (DbError → AppError) live in `error_map.rs` and are
//! shared with the other use cases.

use catique_domain::Board;
use catique_infrastructure::db::{
    pool::{acquire, Pool},
    repositories::boards::{self as repo, BoardDraft, BoardPatch, BoardRow},
    repositories::inheritance::{self as inh, InheritanceScope},
    repositories::tasks::{cascade_clear_scope, cascade_prompt_attachment, AttachScope},
};

use crate::{
    error::AppError,
    error_map::{map_db_err, validate_non_empty, validate_optional_color},
};

/// Boards use case — borrows the application's connection pool.
pub struct BoardsUseCase<'a> {
    pool: &'a Pool,
}

/// Argument bag for [`BoardsUseCase::create`]. Keeps the call site
/// readable now that boards carry both `color` and `icon` alongside
/// `description`.
#[derive(Debug, Clone)]
pub struct CreateBoardArgs {
    pub name: String,
    pub space_id: String,
    pub description: Option<String>,
    /// Optional `#RRGGBB` colour.
    pub color: Option<String>,
    /// Optional pixel-icon identifier — opaque to the backend.
    pub icon: Option<String>,
    /// Optional explicit owner role id. `None` falls back to the
    /// `boards.owner_role_id` SQL DEFAULT (`'maintainer-system'`).
    /// Callers that materialise a board for a non-system role
    /// (e.g. SpaceSettings RolesSection) MUST set this; otherwise
    /// every board collapses onto the default Owner row and the
    /// UNIQUE(space_id, owner_role_id) index rejects the second
    /// insert with a confusing "already attached" toast.
    pub owner_role_id: Option<String>,
    /// `true` flags the auto-created default board (migration
    /// `009_default_boards.sql`). The IPC `create_board` handler always
    /// passes `false`; the only caller that flips this on is
    /// `SpacesUseCase::create`, which auto-provisions one default board
    /// per new space.
    pub is_default: bool,
}

/// Argument bag for [`BoardsUseCase::update`]. Nullable fields use the
/// `Option<Option<String>>` shape to discriminate "leave alone" vs.
/// "clear to NULL" vs. "set".
#[derive(Debug, Clone, Default)]
pub struct UpdateBoardArgs {
    pub id: String,
    pub name: Option<String>,
    pub position: Option<f64>,
    pub role_id: Option<Option<String>>,
    pub description: Option<Option<String>>,
    pub color: Option<Option<String>>,
    pub icon: Option<Option<String>>,
}

impl<'a> BoardsUseCase<'a> {
    /// Construct a use-case wrapper. Cheap — pool is `Arc`-shared
    /// internally by r2d2.
    #[must_use]
    pub fn new(pool: &'a Pool) -> Self {
        Self { pool }
    }

    /// List every board, ordered by `(position ASC, name ASC)`.
    ///
    /// # Errors
    ///
    /// See `error_map::map_db_err`.
    pub fn list(&self) -> Result<Vec<Board>, AppError> {
        let conn = acquire(self.pool).map_err(map_db_err)?;
        let rows = repo::list_all(&conn).map_err(map_db_err)?;
        Ok(rows.into_iter().map(row_to_board).collect())
    }

    /// Look up a board by id.
    ///
    /// # Errors
    ///
    /// `AppError::NotFound { entity: "board", id }` if missing.
    pub fn get(&self, id: &str) -> Result<Board, AppError> {
        let conn = acquire(self.pool).map_err(map_db_err)?;
        match repo::get_by_id(&conn, id).map_err(map_db_err)? {
            Some(row) => Ok(row_to_board(row)),
            None => Err(AppError::NotFound {
                entity: "board".into(),
                id: id.to_owned(),
            }),
        }
    }

    /// Create a board in `args.space_id`.
    ///
    /// # Errors
    ///
    /// `AppError::Validation` for empty `name` or malformed `color`,
    /// `AppError::NotFound` for missing `space_id`.
    #[allow(clippy::needless_pass_by_value)]
    pub fn create(&self, args: CreateBoardArgs) -> Result<Board, AppError> {
        let trimmed = validate_non_empty("name", &args.name)?;
        validate_optional_color("color", args.color.as_deref())?;
        let conn = acquire(self.pool).map_err(map_db_err)?;
        if !repo::space_exists(&conn, &args.space_id).map_err(map_db_err)? {
            return Err(AppError::NotFound {
                entity: "space".into(),
                id: args.space_id,
            });
        }
        let row = repo::insert(
            &conn,
            &BoardDraft {
                name: trimmed,
                space_id: args.space_id,
                role_id: None,
                position: None,
                description: args.description,
                color: args.color,
                icon: args.icon,
                is_default: args.is_default,
                // Honour the caller's explicit owner choice; falling
                // back to the seeded `maintainer-system` row only when
                // unset (Cat-as-Agent Phase 1 / memo Q1).
                owner_role_id: args.owner_role_id,
            },
        )
        .map_err(map_db_err)?;
        Ok(row_to_board(row))
    }

    /// Partial update.
    ///
    /// `description` / `role_id` / `color` / `icon`: `None` = leave,
    /// `Some(None)` = clear, `Some(Some(s))` = set.
    ///
    /// # Errors
    ///
    /// `AppError::NotFound` if id is unknown; validation errors for
    /// empty `name` or malformed `color`.
    #[allow(clippy::needless_pass_by_value)]
    pub fn update(&self, args: UpdateBoardArgs) -> Result<Board, AppError> {
        if let Some(n) = args.name.as_deref() {
            validate_non_empty("name", n)?;
        }
        if let Some(Some(c)) = args.color.as_ref() {
            validate_optional_color("color", Some(c))?;
        }
        let conn = acquire(self.pool).map_err(map_db_err)?;
        let patch = BoardPatch {
            name: args.name.map(|n| n.trim().to_owned()),
            position: args.position,
            role_id: args.role_id,
            description: args.description,
            color: args.color,
            icon: args.icon,
        };
        match repo::update(&conn, &args.id, &patch).map_err(map_db_err)? {
            Some(row) => Ok(row_to_board(row)),
            None => Err(AppError::NotFound {
                entity: "board".into(),
                id: args.id,
            }),
        }
    }

    /// Reassign a board's owning cat (Maintainer-style role).
    ///
    /// Cat-as-Agent Phase 1 (ctq-88, audit F-07) guards against
    /// assigning the seeded `dirizher-system` row as a board owner:
    /// Dirizher is the Pattern B coordinator (memo Q3) and only
    /// orchestrates Cats — it never owns work itself. Maintainer
    /// (`maintainer-system`) is a valid owner; user-defined cats are
    /// also fine. The repository-level FK does not encode this
    /// distinction, hence the application-layer guard.
    ///
    /// The companion Tauri command lands separately as ctq-101 — this
    /// use-case method is in place ahead of time so the command will be
    /// already protected when wired.
    ///
    /// # Errors
    ///
    /// * `AppError::BadRequest` when `role_id == "dirizher-system"`.
    /// * `AppError::NotFound` if the board id is unknown.
    /// * `AppError::TransactionRolledBack` if the role id does not
    ///   exist (FK violation surfaces from the repository).
    pub fn set_board_owner(&self, board_id: &str, role_id: &str) -> Result<Board, AppError> {
        // Guard: Dirizher is a coordinator-only role. Refuse before
        // hitting the DB so the rejection is immediate and audit-safe.
        if role_id == "dirizher-system" {
            return Err(AppError::BadRequest {
                reason: "Dirizher cannot own boards".into(),
            });
        }

        let conn = acquire(self.pool).map_err(map_db_err)?;
        let updated = repo::set_owner(&conn, board_id, role_id).map_err(map_db_err)?;
        if !updated {
            return Err(AppError::NotFound {
                entity: "board".into(),
                id: board_id.to_owned(),
            });
        }
        // Re-read so the caller gets the post-update timestamps.
        match repo::get_by_id(&conn, board_id).map_err(map_db_err)? {
            Some(row) => Ok(row_to_board(row)),
            None => Err(AppError::NotFound {
                entity: "board".into(),
                id: board_id.to_owned(),
            }),
        }
    }

    /// Delete a board.
    ///
    /// Refuses to delete the auto-created default board for a space
    /// (migration `009_default_boards.sql`): the kanban view always
    /// needs somewhere to land, and the only legitimate way to drop
    /// such a board is to delete the owning space (which cascades).
    ///
    /// # Errors
    ///
    /// * `AppError::NotFound` if id is unknown.
    /// * `AppError::Validation { field: "isDefault", … }` when the
    ///   target row's `is_default = 1`. We pre-check via `get_by_id`
    ///   instead of letting a constraint fire — the existing
    ///   error-mapping table maps raw `ConstraintViolation` to
    ///   `TransactionRolledBack`, which would erase the user-facing
    ///   reason.
    pub fn delete(&self, id: &str) -> Result<(), AppError> {
        let conn = acquire(self.pool).map_err(map_db_err)?;
        match repo::get_by_id(&conn, id).map_err(map_db_err)? {
            Some(row) if row.is_default => Err(AppError::Validation {
                field: "is_default".into(),
                reason: "Cannot delete the default board for a space. \
                         Delete the space to remove it."
                    .into(),
            }),
            Some(_) => {
                let removed = repo::delete(&conn, id).map_err(map_db_err)?;
                if removed {
                    Ok(())
                } else {
                    // Race: row was deleted between get_by_id and
                    // delete. Treat as NotFound.
                    Err(AppError::NotFound {
                        entity: "board".into(),
                        id: id.to_owned(),
                    })
                }
            }
            None => Err(AppError::NotFound {
                entity: "board".into(),
                id: id.to_owned(),
            }),
        }
    }

    /// Atomically replace the full ordered prompt list for a board.
    /// Mirrors `SpacesUseCase::set_space_prompts` and the other ctq-108
    /// bulk setters: single immediate transaction, FK violation rolls
    /// everything back.
    ///
    /// ADR-0006: clears the join-table rows for `board_id`, wipes every
    /// `task_prompts` row tagged with this scope's origin
    /// (`board:<id>`), then re-INSERTs the new ordered list and
    /// re-cascades each prompt onto every task in the board. Direct
    /// attachments (`origin = 'direct'`) survive unchanged.
    ///
    /// `prompt_ids` may be empty: that clears the board's prompt
    /// attachments in one round-trip.
    ///
    /// Position is INTEGER for `board_prompts` (per migration
    /// `001_initial.sql:217`) — we assign `1..=N` so a follow-up DnD
    /// reorder has clean slots to mid-point into.
    ///
    /// # Errors
    ///
    /// `AppError::TransactionRolledBack` on FK violation (unknown
    /// `board_id` or any prompt id).
    #[allow(clippy::needless_pass_by_value)]
    pub fn set_board_prompts(
        &self,
        board_id: String,
        prompt_ids: Vec<String>,
    ) -> Result<(), AppError> {
        let mut conn = acquire(self.pool).map_err(map_db_err)?;
        let tx = conn
            .transaction_with_behavior(rusqlite::TransactionBehavior::Immediate)
            .map_err(|e| map_db_err(e.into()))?;

        tx.execute(
            "DELETE FROM board_prompts WHERE board_id = ?1",
            rusqlite::params![board_id],
        )
        .map_err(|e| map_db_err(catique_infrastructure::db::pool::DbError::Sqlite(e)))?;
        let scope = AttachScope::Board(board_id.clone());
        cascade_clear_scope(&tx, &scope).map_err(map_db_err)?;

        for (idx, prompt_id) in prompt_ids.iter().enumerate() {
            // Position column is INTEGER on `board_prompts`; the cast
            // chain keeps the bound parameter type aligned with the
            // column type. `try_from` first guards against the
            // theoretical 32-bit-host edge case where `idx` could
            // exceed `i64::MAX`; clamp via `unwrap_or` keeps the
            // signature infallible without a panic path. `prompt_ids`
            // comes from a single IPC payload so the actual length is
            // bounded by Tauri's request budget — well below 2^63.
            let position_i = i64::try_from(idx).unwrap_or(i64::MAX) + 1;
            tx.execute(
                "INSERT INTO board_prompts (board_id, prompt_id, position) \
                 VALUES (?1, ?2, ?3)",
                rusqlite::params![board_id, prompt_id, position_i],
            )
            .map_err(|e| map_db_err(catique_infrastructure::db::pool::DbError::Sqlite(e)))?;
            #[allow(clippy::cast_precision_loss)]
            let position_f = position_i as f64;
            cascade_prompt_attachment(&tx, &scope, prompt_id, position_f).map_err(map_db_err)?;
        }

        tx.commit().map_err(|e| map_db_err(e.into()))?;
        Ok(())
    }

    /// Replace the board's skill list with `skill_ids`. Position in the
    /// supplied slice becomes the row's `position` column. Empty input
    /// clears the board.
    ///
    /// ctq-120.
    ///
    /// # Errors
    ///
    /// Forwards storage-layer errors. FK violations on a missing skill
    /// id roll the transaction back; the pre-call state survives.
    pub fn set_skills(&self, board_id: &str, skill_ids: &[String]) -> Result<(), AppError> {
        let mut conn = acquire(self.pool).map_err(map_db_err)?;
        inh::set_skills(&mut conn, InheritanceScope::Board, board_id, skill_ids)
            .map_err(map_db_err)
    }

    /// Replace the board's MCP-tool list with `mcp_tool_ids`.
    ///
    /// ctq-120.
    ///
    /// # Errors
    ///
    /// Forwards storage-layer errors.
    pub fn set_mcp_tools(
        &self,
        board_id: &str,
        mcp_tool_ids: &[String],
    ) -> Result<(), AppError> {
        let mut conn = acquire(self.pool).map_err(map_db_err)?;
        inh::set_mcp_tools(
            &mut conn,
            InheritanceScope::Board,
            board_id,
            mcp_tool_ids,
        )
        .map_err(map_db_err)
    }
}

fn row_to_board(row: BoardRow) -> Board {
    Board {
        id: row.id,
        name: row.name,
        space_id: row.space_id,
        role_id: row.role_id,
        position: row.position,
        description: row.description,
        color: row.color,
        icon: row.icon,
        is_default: row.is_default,
        created_at: row.created_at,
        updated_at: row.updated_at,
        owner_role_id: row.owner_role_id,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use catique_infrastructure::db::pool::memory_pool_for_tests;
    use catique_infrastructure::db::runner::run_pending;

    fn fresh_pool_with_space(space_id: &str, prefix: &str) -> Pool {
        let pool = memory_pool_for_tests();
        let mut conn = pool.get().expect("acquire");
        run_pending(&mut conn).expect("migrations");
        conn.execute(
            "INSERT INTO spaces (id, name, prefix, is_default, position, created_at, updated_at) \
             VALUES (?1, ?2, ?3, 0, 0, 0, 0)",
            rusqlite::params![space_id, format!("Space {space_id}"), prefix],
        )
        .expect("seed space");
        drop(conn);
        pool
    }

    fn fresh_pool_no_space() -> Pool {
        let pool = memory_pool_for_tests();
        let mut conn = pool.get().expect("acquire");
        run_pending(&mut conn).expect("migrations");
        drop(conn);
        pool
    }

    fn args(name: &str, space_id: &str) -> CreateBoardArgs {
        CreateBoardArgs {
            name: name.into(),
            space_id: space_id.into(),
            description: None,
            color: None,
            icon: None,
            owner_role_id: None,
            is_default: false,
        }
    }

    #[test]
    fn create_then_list_returns_one_board() {
        let pool = fresh_pool_with_space("sp1", "abc");
        let uc = BoardsUseCase::new(&pool);
        let board = uc.create(args("Board One", "sp1")).unwrap();
        assert_eq!(board.name, "Board One");
        let list = uc.list().unwrap();
        assert_eq!(list.len(), 1);
        assert_eq!(list[0].id, board.id);
    }

    #[test]
    fn create_with_empty_name_returns_validation() {
        let pool = fresh_pool_with_space("sp1", "abc");
        let uc = BoardsUseCase::new(&pool);
        let err = uc.create(args("   ", "sp1")).expect_err("validation");
        match err {
            AppError::Validation { field, .. } => assert_eq!(field, "name"),
            other => panic!("got {other:?}"),
        }
    }

    #[test]
    fn create_with_missing_space_returns_not_found() {
        let pool = fresh_pool_no_space();
        let uc = BoardsUseCase::new(&pool);
        let err = uc.create(args("B", "ghost")).expect_err("not found");
        match err {
            AppError::NotFound { entity, id } => {
                assert_eq!(entity, "space");
                assert_eq!(id, "ghost");
            }
            other => panic!("got {other:?}"),
        }
    }

    #[test]
    fn get_returns_not_found_for_missing_id() {
        let pool = fresh_pool_no_space();
        let uc = BoardsUseCase::new(&pool);
        match uc.get("nonsense").expect_err("nf") {
            AppError::NotFound { entity, id } => {
                assert_eq!(entity, "board");
                assert_eq!(id, "nonsense");
            }
            other => panic!("got {other:?}"),
        }
    }

    #[test]
    fn update_renames_board() {
        let pool = fresh_pool_with_space("sp1", "abc");
        let uc = BoardsUseCase::new(&pool);
        let board = uc.create(args("Old", "sp1")).unwrap();
        let updated = uc
            .update(UpdateBoardArgs {
                id: board.id.clone(),
                name: Some("New".into()),
                ..UpdateBoardArgs::default()
            })
            .unwrap();
        assert_eq!(updated.name, "New");
    }

    #[test]
    fn update_returns_not_found_for_missing_id() {
        let pool = fresh_pool_no_space();
        let uc = BoardsUseCase::new(&pool);
        let err = uc
            .update(UpdateBoardArgs {
                id: "ghost".into(),
                name: Some("X".into()),
                ..UpdateBoardArgs::default()
            })
            .expect_err("nf");
        match err {
            AppError::NotFound { entity, .. } => assert_eq!(entity, "board"),
            other => panic!("got {other:?}"),
        }
    }

    #[test]
    fn delete_removes_board_then_not_found() {
        let pool = fresh_pool_with_space("sp1", "abc");
        let uc = BoardsUseCase::new(&pool);
        let board = uc.create(args("X", "sp1")).unwrap();
        uc.delete(&board.id).unwrap();
        match uc.delete(&board.id).expect_err("second delete") {
            AppError::NotFound { entity, .. } => assert_eq!(entity, "board"),
            other => panic!("got {other:?}"),
        }
    }

    #[test]
    fn create_with_description_persists() {
        let pool = fresh_pool_with_space("sp1", "abc");
        let uc = BoardsUseCase::new(&pool);
        let mut a = args("Described", "sp1");
        a.description = Some("My desc".into());
        let board = uc.create(a).unwrap();
        assert_eq!(board.description, Some("My desc".to_owned()));
        let fetched = uc.get(&board.id).unwrap();
        assert_eq!(fetched.description, Some("My desc".to_owned()));
    }

    #[test]
    fn update_description_set_and_clear() {
        let pool = fresh_pool_with_space("sp1", "abc");
        let uc = BoardsUseCase::new(&pool);
        let board = uc.create(args("B", "sp1")).unwrap();
        assert_eq!(board.description, None);

        let set = uc
            .update(UpdateBoardArgs {
                id: board.id.clone(),
                description: Some(Some("desc".into())),
                ..UpdateBoardArgs::default()
            })
            .unwrap();
        assert_eq!(set.description, Some("desc".to_owned()));

        let cleared = uc
            .update(UpdateBoardArgs {
                id: board.id.clone(),
                description: Some(None),
                ..UpdateBoardArgs::default()
            })
            .unwrap();
        assert_eq!(cleared.description, None);
    }

    // ------------------------------------------------------------------
    // Icon + colour coverage at the use-case layer.
    // ------------------------------------------------------------------

    #[test]
    fn create_with_icon_and_color_round_trips() {
        let pool = fresh_pool_with_space("sp1", "abc");
        let uc = BoardsUseCase::new(&pool);
        let mut a = args("Iconic", "sp1");
        a.color = Some("#112233".into());
        a.icon = Some("star".into());
        let board = uc.create(a).unwrap();
        assert_eq!(board.color.as_deref(), Some("#112233"));
        assert_eq!(board.icon.as_deref(), Some("star"));
        let fetched = uc.get(&board.id).unwrap();
        assert_eq!(fetched.color.as_deref(), Some("#112233"));
        assert_eq!(fetched.icon.as_deref(), Some("star"));
    }

    #[test]
    fn create_with_bad_color_returns_validation() {
        let pool = fresh_pool_with_space("sp1", "abc");
        let uc = BoardsUseCase::new(&pool);
        let mut a = args("B", "sp1");
        a.color = Some("not-a-color".into());
        match uc.create(a).expect_err("v") {
            AppError::Validation { field, .. } => assert_eq!(field, "color"),
            other => panic!("got {other:?}"),
        }
    }

    #[test]
    fn update_can_set_clear_and_change_icon() {
        let pool = fresh_pool_with_space("sp1", "abc");
        let uc = BoardsUseCase::new(&pool);
        let board = uc.create(args("B", "sp1")).unwrap();
        assert_eq!(board.icon, None);

        let after_set = uc
            .update(UpdateBoardArgs {
                id: board.id.clone(),
                icon: Some(Some("bolt".into())),
                ..UpdateBoardArgs::default()
            })
            .unwrap();
        assert_eq!(after_set.icon.as_deref(), Some("bolt"));

        let after_change = uc
            .update(UpdateBoardArgs {
                id: board.id.clone(),
                icon: Some(Some("heart".into())),
                ..UpdateBoardArgs::default()
            })
            .unwrap();
        assert_eq!(after_change.icon.as_deref(), Some("heart"));

        let after_clear = uc
            .update(UpdateBoardArgs {
                id: board.id.clone(),
                icon: Some(None),
                ..UpdateBoardArgs::default()
            })
            .unwrap();
        assert_eq!(after_clear.icon, None);
    }

    // ------------------------------------------------------------------
    // is_default coverage at the use-case layer (migration 009).
    // ------------------------------------------------------------------

    #[test]
    fn create_with_is_default_true_round_trips() {
        let pool = fresh_pool_with_space("sp1", "abc");
        let uc = BoardsUseCase::new(&pool);
        let mut a = args("Main", "sp1");
        a.is_default = true;
        let board = uc.create(a).unwrap();
        assert!(board.is_default);
        let fetched = uc.get(&board.id).unwrap();
        assert!(fetched.is_default);
    }

    #[test]
    fn create_defaults_is_default_to_false() {
        let pool = fresh_pool_with_space("sp1", "abc");
        let uc = BoardsUseCase::new(&pool);
        let board = uc.create(args("X", "sp1")).unwrap();
        assert!(!board.is_default);
    }

    #[test]
    fn delete_refuses_default_board() {
        let pool = fresh_pool_with_space("sp1", "abc");
        let uc = BoardsUseCase::new(&pool);
        let mut a = args("Main", "sp1");
        a.is_default = true;
        let board = uc.create(a).unwrap();

        match uc.delete(&board.id).expect_err("must refuse") {
            AppError::Validation { field, reason } => {
                assert_eq!(field, "is_default");
                assert!(
                    reason.contains("default board"),
                    "unexpected reason: {reason}"
                );
            }
            other => panic!("expected Validation, got {other:?}"),
        }

        // The board must still be there after the refusal.
        assert!(uc.get(&board.id).is_ok());
    }

    #[test]
    fn delete_allows_non_default_board() {
        let pool = fresh_pool_with_space("sp1", "abc");
        let uc = BoardsUseCase::new(&pool);
        let board = uc.create(args("X", "sp1")).unwrap();
        assert!(!board.is_default);
        uc.delete(&board.id).expect("non-default board deletes");
    }

    // -----------------------------------------------------------------
    // ctq-88 — set_board_owner refuses Dirizher (coordinator-only).
    // -----------------------------------------------------------------

    #[test]
    fn set_board_owner_assigns_user_role_and_persists() {
        // Happy path: assigning a non-system user role flips the
        // owner_role_id, and a follow-up `get` reflects the new owner.
        // Backs the ctq-101 IPC `set_board_owner` contract — the Tauri
        // command itself is a thin wrapper, so the use-case test is the
        // load-bearing contract.
        let pool = fresh_pool_with_space("sp1", "abc");
        let uc = BoardsUseCase::new(&pool);
        let board = uc.create(args("B", "sp1")).unwrap();
        assert_eq!(board.owner_role_id, "maintainer-system");

        // Seed a user role to assign.
        {
            let conn = catique_infrastructure::db::pool::acquire(&pool).unwrap();
            conn.execute(
                "INSERT INTO roles (id, name, content, created_at, updated_at) \
                 VALUES ('rl-owner','Owner','',0,0)",
                [],
            )
            .unwrap();
        }

        let updated = uc.set_board_owner(&board.id, "rl-owner").unwrap();
        assert_eq!(updated.owner_role_id, "rl-owner");

        // Round-trip via get to confirm persistence.
        let after = uc.get(&board.id).unwrap();
        assert_eq!(after.owner_role_id, "rl-owner");
    }

    #[test]
    fn set_board_owner_returns_not_found_for_missing_board() {
        let pool = fresh_pool_with_space("sp1", "abc");
        let uc = BoardsUseCase::new(&pool);
        match uc
            .set_board_owner("ghost", "maintainer-system")
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
    fn set_board_owner_rejects_dirizher() {
        // The board exists; the call must still be rejected up-front
        // before any DB write — Dirizher is the Pattern B coordinator
        // and never owns work.
        let pool = fresh_pool_with_space("sp1", "abc");
        let uc = BoardsUseCase::new(&pool);
        let board = uc.create(args("B", "sp1")).unwrap();

        match uc
            .set_board_owner(&board.id, "dirizher-system")
            .expect_err("must refuse")
        {
            AppError::BadRequest { reason } => {
                assert!(reason.contains("Dirizher"), "unexpected reason: {reason}");
            }
            other => panic!("expected BadRequest, got {other:?}"),
        }

        // Confirm the owner was NOT changed — should still be the
        // seeded `maintainer-system` default from migration 004.
        let after = uc.get(&board.id).unwrap();
        assert_eq!(after.owner_role_id, "maintainer-system");
    }

    // -----------------------------------------------------------------
    // ctq-108 — set_board_prompts bulk setter.
    // -----------------------------------------------------------------

    /// Seeds three prompts and one task on the board so the cascade
    /// helper has a target row to materialise into.
    fn seed_board_prompts_fixture() -> (Pool, String) {
        let pool = fresh_pool_with_space("sp1", "abc");
        let board = BoardsUseCase::new(&pool).create(args("B", "sp1")).unwrap();
        {
            let conn = acquire(&pool).unwrap();
            conn.execute_batch(
                "INSERT INTO prompts (id, name, content, created_at, updated_at) VALUES \
                     ('p1','P1','',0,0), \
                     ('p2','P2','',0,0), \
                     ('p3','P3','',0,0);",
            )
            .unwrap();
            conn.execute(
                "INSERT INTO columns (id, board_id, name, position, created_at) \
                 VALUES ('c1',?1,'C',0,0)",
                rusqlite::params![board.id],
            )
            .unwrap();
            conn.execute(
                "INSERT INTO tasks (id, board_id, column_id, slug, title, position, created_at, updated_at) \
                 VALUES ('t1',?1,'c1','sp-1','T',0,0,0)",
                rusqlite::params![board.id],
            )
            .unwrap();
        }
        (pool, board.id)
    }

    #[test]
    fn set_board_prompts_replaces_ordering_and_cascades() {
        let (pool, board_id) = seed_board_prompts_fixture();
        let uc = BoardsUseCase::new(&pool);

        uc.set_board_prompts(board_id.clone(), vec!["p1".into(), "p2".into()])
            .unwrap();
        uc.set_board_prompts(board_id.clone(), vec!["p3".into(), "p1".into()])
            .unwrap();

        let conn = acquire(&pool).unwrap();
        let ordered: Vec<String> = conn
            .prepare(
                "SELECT prompt_id FROM board_prompts \
                 WHERE board_id = ?1 ORDER BY position ASC",
            )
            .unwrap()
            .query_map(rusqlite::params![board_id], |r| r.get::<_, String>(0))
            .unwrap()
            .map(Result::unwrap)
            .collect();
        assert_eq!(ordered, vec!["p3".to_string(), "p1".to_string()]);

        let mat: Vec<String> = conn
            .prepare(
                "SELECT prompt_id FROM task_prompts \
                 WHERE task_id = 't1' AND origin = ?1 ORDER BY prompt_id",
            )
            .unwrap()
            .query_map(rusqlite::params![format!("board:{board_id}")], |r| {
                r.get::<_, String>(0)
            })
            .unwrap()
            .map(Result::unwrap)
            .collect();
        assert_eq!(mat, vec!["p1".to_string(), "p3".to_string()]);
    }

    #[test]
    fn set_board_prompts_with_empty_clears_all() {
        let (pool, board_id) = seed_board_prompts_fixture();
        let uc = BoardsUseCase::new(&pool);
        uc.set_board_prompts(board_id.clone(), vec!["p1".into(), "p2".into()])
            .unwrap();
        uc.set_board_prompts(board_id.clone(), Vec::new()).unwrap();

        let conn = acquire(&pool).unwrap();
        let join_count: i64 = conn
            .query_row(
                "SELECT COUNT(*) FROM board_prompts WHERE board_id = ?1",
                rusqlite::params![board_id],
                |r| r.get(0),
            )
            .unwrap();
        assert_eq!(join_count, 0);
        let mat_count: i64 = conn
            .query_row(
                "SELECT COUNT(*) FROM task_prompts WHERE origin = ?1",
                rusqlite::params![format!("board:{board_id}")],
                |r| r.get(0),
            )
            .unwrap();
        assert_eq!(mat_count, 0);
    }

    #[test]
    fn set_board_prompts_atomic_on_fk_error() {
        let (pool, board_id) = seed_board_prompts_fixture();
        let uc = BoardsUseCase::new(&pool);
        uc.set_board_prompts(board_id.clone(), vec!["p1".into()])
            .unwrap();

        let err = uc
            .set_board_prompts(
                board_id.clone(),
                vec!["p2".into(), "ghost".into(), "p3".into()],
            )
            .expect_err("FK violation");
        match err {
            AppError::TransactionRolledBack { .. } => {}
            other => panic!("expected TransactionRolledBack, got {other:?}"),
        }

        let conn = acquire(&pool).unwrap();
        let ids: Vec<String> = conn
            .prepare(
                "SELECT prompt_id FROM board_prompts \
                 WHERE board_id = ?1 ORDER BY position ASC",
            )
            .unwrap()
            .query_map(rusqlite::params![board_id], |r| r.get::<_, String>(0))
            .unwrap()
            .map(Result::unwrap)
            .collect();
        assert_eq!(ids, vec!["p1".to_string()]);
    }
}
