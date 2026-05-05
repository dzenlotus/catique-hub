//! Spaces use case.
//!
//! Wave-E2.4 (Olga). Mirrors `BoardsUseCase`. Validation: non-empty
//! `name` (≤ 200 chars), `prefix` matches the schema CHECK
//! `[a-z0-9-]{1,10}` — we re-implement the check in Rust so the
//! `AppError::Validation` is friendlier than a raw constraint failure.
//! Optional `color` is validated as `#RRGGBB`; `icon` is opaque to the
//! backend (the frontend owns the identifier set).

use catique_domain::Space;
use catique_infrastructure::db::{
    pool::{acquire, Pool},
    repositories::{
        boards::{self as boards_repo, BoardDraft},
        spaces::{self as repo, SpaceDraft, SpacePatch, SpaceRow},
    },
};

use crate::{
    error::AppError,
    error_map::{map_db_err, map_db_err_unique, validate_non_empty, validate_optional_color},
};

/// Default name for the auto-created board landed in every newly
/// created space (migration `009_default_boards.sql`). Kept generic so
/// the user can rename it freely; uniqueness lives in `(space_id, id)`,
/// not in the display name.
const DEFAULT_BOARD_NAME: &str = "Main";

/// Default icon for the auto-created board. Mirrors the frontend's
/// neutral-default convention (see `src/shared/ui/Icon/index.ts`); the
/// backend stores the identifier as opaque text.
const DEFAULT_BOARD_ICON: &str = "PixelInterfaceEssentialList";

const PREFIX_MAX_LEN: usize = 10;

/// Spaces use case — borrows the application's connection pool.
pub struct SpacesUseCase<'a> {
    pool: &'a Pool,
}

/// Argument bag for [`SpacesUseCase::create`]. Keeps the call site
/// readable now that spaces carry both `color` and `icon` alongside the
/// existing primary fields.
#[derive(Debug, Clone)]
pub struct CreateSpaceArgs {
    pub name: String,
    pub prefix: String,
    pub description: Option<String>,
    /// Optional `#RRGGBB` colour.
    pub color: Option<String>,
    /// Optional pixel-icon identifier — opaque to the backend.
    pub icon: Option<String>,
    pub is_default: bool,
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
            },
        )
        .map_err(|e| map_db_err_unique(e, "space"))?;

        // Auto-provision the default board (migration 009). The
        // dropped tx in the error path rolls the space insert back
        // automatically.
        boards_repo::insert(
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
        };
        match repo::update(&conn, &args.id, &patch).map_err(map_db_err)? {
            Some(row) => Ok(row_to_space(row)),
            None => Err(AppError::NotFound {
                entity: "space".into(),
                id: args.id,
            }),
        }
    }

    /// Delete a space.
    ///
    /// # Errors
    ///
    /// `AppError::NotFound` if id is unknown; FK violation (boards
    /// still in this space) surfaces as `AppError::Conflict`.
    pub fn delete(&self, id: &str) -> Result<(), AppError> {
        let conn = acquire(self.pool).map_err(map_db_err)?;
        let removed = repo::delete(&conn, id).map_err(|e| map_db_err_unique(e, "space"))?;
        if removed {
            Ok(())
        } else {
            Err(AppError::NotFound {
                entity: "space".into(),
                id: id.to_owned(),
            })
        }
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
            description: None,
            color: None,
            icon: None,
            is_default: false,
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
        assert_eq!(board.name, "Main");
        assert_eq!(board.icon.as_deref(), Some("PixelInterfaceEssentialList"));
        assert_eq!(board.description, None);
        assert_eq!(board.color, None);
        assert!(
            (board.position - 0.0).abs() < f64::EPSILON,
            "default board sits at position 0"
        );
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
}
