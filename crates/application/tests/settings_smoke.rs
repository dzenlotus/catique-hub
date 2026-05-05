//! Smoke integration test for the `settings` use case (ctq-96, audit
//! F-12). Exercises the two-method round-trip — `set_setting` →
//! `get_setting` — against a fresh in-memory pool with all migrations
//! applied. Mirrors the helper structure used by `search_smoke`.

use catique_application::{settings::SettingsUseCase, AppError};
use catique_infrastructure::db::pool::memory_pool_for_tests;
use catique_infrastructure::db::runner::run_pending;

fn fresh_pool() -> catique_infrastructure::db::pool::Pool {
    let pool = memory_pool_for_tests();
    let mut conn = pool.get().unwrap();
    run_pending(&mut conn).unwrap();
    drop(conn);
    pool
}

#[test]
fn round_trip_with_real_migrations() {
    let pool = fresh_pool();
    let uc = SettingsUseCase::new(&pool);

    // Use a key migration 004 does NOT pre-seed (it inserts
    // `cat_migration_reviewed`); `selected_space` is unset by default.
    let key = "selected_space";

    // Absent → None.
    assert!(uc.get_setting(key).unwrap().is_none());

    // Write → read.
    uc.set_setting(key, "sp1").unwrap();
    assert_eq!(uc.get_setting(key).unwrap().as_deref(), Some("sp1"));

    // Overwrite → latest value wins.
    uc.set_setting(key, "sp2").unwrap();
    assert_eq!(uc.get_setting(key).unwrap().as_deref(), Some("sp2"));

    // Migration-seeded key is readable too.
    assert_eq!(
        uc.get_setting("cat_migration_reviewed").unwrap().as_deref(),
        Some("false"),
        "migration 004 pre-seeds cat_migration_reviewed='false'",
    );
}

#[test]
fn validation_rejects_blank_key() {
    let pool = fresh_pool();
    let uc = SettingsUseCase::new(&pool);
    match uc.set_setting("   ", "v").expect_err("validation") {
        AppError::Validation { field, .. } => assert_eq!(field, "key"),
        other => panic!("got {other:?}"),
    }
}

#[test]
fn empty_value_is_persisted_and_distinct_from_absent() {
    let pool = fresh_pool();
    let uc = SettingsUseCase::new(&pool);

    uc.set_setting("explicit_empty", "").unwrap();
    assert_eq!(
        uc.get_setting("explicit_empty").unwrap().as_deref(),
        Some(""),
        "empty string round-trips and is not collapsed to None",
    );
    assert!(uc.get_setting("never_written").unwrap().is_none());
}
