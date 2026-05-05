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
    repositories::spaces::{self as repo, SpaceDraft, SpacePatch, SpaceRow},
};

use crate::{
    error::AppError,
    error_map::{map_db_err, map_db_err_unique, validate_non_empty, validate_optional_color},
};

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
        let conn = acquire(self.pool).map_err(map_db_err)?;
        let row = repo::insert(
            &conn,
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
}
