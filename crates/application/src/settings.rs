//! `settings` use case — thin generic key/value adapter.
//!
//! The `settings` table (Promptery v0.4 schema, migration
//! `001_initial.sql`) backs shell-level toggles such as
//! `cat_migration_reviewed`, `selected_space`, etc. The use case is two
//! methods deep — the repository already enforces UPSERT semantics — but
//! we still channel calls through it so the IPC layer never reaches into
//! `catique-infrastructure` directly (ADR-0001 dependency arrow).
//!
//! Validation is intentionally minimal: we trim and length-cap the
//! `key` (NFR §4.2 buffer ceiling) and let the caller pass any UTF-8
//! `value`. The schema declares both columns `NOT NULL` so neither
//! field is `Option<String>` at the application boundary.

use catique_infrastructure::db::{
    pool::{acquire, Pool},
    repositories::settings as repo,
};

use crate::{error::AppError, error_map::map_db_err};

/// Hard upper bound on `key` length. The settings table has no schema
/// CHECK; the cap mirrors NFR §4.2 (validation) so a runaway caller
/// can't blow the row out to the SQLite per-cell limit.
const SETTING_KEY_MAX_LEN: usize = 200;

/// Hard upper bound on `value` length — same rationale as
/// [`SETTING_KEY_MAX_LEN`]. 50 000 chars matches the prompt-content
/// ceiling and the step-log per-line cap.
const SETTING_VALUE_MAX_LEN: usize = 50_000;

/// Settings use case.
pub struct SettingsUseCase<'a> {
    pool: &'a Pool,
}

impl<'a> SettingsUseCase<'a> {
    /// Constructor.
    #[must_use]
    pub fn new(pool: &'a Pool) -> Self {
        Self { pool }
    }

    /// Read a single setting. `Ok(None)` for absent keys — the caller
    /// supplies the default. Empty-string values are returned verbatim
    /// (distinct from absent).
    ///
    /// # Errors
    ///
    /// * `AppError::Validation` — `key` empty or oversized.
    /// * Storage-layer errors as usual.
    pub fn get_setting(&self, key: &str) -> Result<Option<String>, AppError> {
        validate_key(key)?;
        let conn = acquire(self.pool).map_err(map_db_err)?;
        repo::get_setting(&conn, key.trim()).map_err(map_db_err)
    }

    /// Write a single setting (UPSERT). `updated_at` is refreshed on
    /// every call.
    ///
    /// # Errors
    ///
    /// * `AppError::Validation` — `key` or `value` empty / oversized.
    /// * Storage-layer errors as usual.
    pub fn set_setting(&self, key: &str, value: &str) -> Result<(), AppError> {
        validate_key(key)?;
        if value.len() > SETTING_VALUE_MAX_LEN {
            return Err(AppError::Validation {
                field: "value".into(),
                reason: format!("must be at most {SETTING_VALUE_MAX_LEN} characters"),
            });
        }
        let conn = acquire(self.pool).map_err(map_db_err)?;
        repo::set_setting(&conn, key.trim(), value).map_err(map_db_err)
    }
}

fn validate_key(key: &str) -> Result<(), AppError> {
    let trimmed = key.trim();
    if trimmed.is_empty() {
        return Err(AppError::Validation {
            field: "key".into(),
            reason: "must not be empty or whitespace-only".into(),
        });
    }
    if trimmed.len() > SETTING_KEY_MAX_LEN {
        return Err(AppError::Validation {
            field: "key".into(),
            reason: format!("must be at most {SETTING_KEY_MAX_LEN} characters"),
        });
    }
    Ok(())
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
    fn get_returns_none_for_absent_key() {
        let pool = fresh_pool();
        let uc = SettingsUseCase::new(&pool);
        assert!(uc.get_setting("missing").unwrap().is_none());
    }

    #[test]
    fn set_then_get_round_trip() {
        let pool = fresh_pool();
        let uc = SettingsUseCase::new(&pool);
        uc.set_setting("selected_space", "sp1").unwrap();
        assert_eq!(
            uc.get_setting("selected_space").unwrap().as_deref(),
            Some("sp1")
        );
    }

    #[test]
    fn set_overwrites_previous_value() {
        let pool = fresh_pool();
        let uc = SettingsUseCase::new(&pool);
        uc.set_setting("k", "v1").unwrap();
        uc.set_setting("k", "v2").unwrap();
        assert_eq!(uc.get_setting("k").unwrap().as_deref(), Some("v2"));
    }

    #[test]
    fn empty_key_returns_validation() {
        let pool = fresh_pool();
        let uc = SettingsUseCase::new(&pool);
        match uc.get_setting("   ").expect_err("validation") {
            AppError::Validation { field, .. } => assert_eq!(field, "key"),
            other => panic!("got {other:?}"),
        }
    }

    #[test]
    fn oversized_value_rejected() {
        let pool = fresh_pool();
        let uc = SettingsUseCase::new(&pool);
        let huge = "x".repeat(SETTING_VALUE_MAX_LEN + 1);
        match uc.set_setting("k", &huge).expect_err("validation") {
            AppError::Validation { field, .. } => assert_eq!(field, "value"),
            other => panic!("got {other:?}"),
        }
    }
}
