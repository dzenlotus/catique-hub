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
                // owner defaults to the seeded `maintainer-system`
                // row (Cat-as-Agent Phase 1 / memo Q1).
                owner_role_id: None,
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
}
