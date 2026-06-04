//! End-to-end integration test for `mcp_aggregated::dispatch_entity`.
//!
//! Verifies that the consolidated entity-level surface actually drives
//! the same use cases as the legacy flat method names. Each test picks
//! one entity, runs a create → list → get → delete cycle through
//! `dispatch_entity` only, and asserts the side effects landed in the
//! shared SQLite pool the same way they would via `mcp_dispatch::dispatch`.

use catique_application::mcp_aggregated::dispatch_entity;
use catique_infrastructure::db::pool::{memory_pool_for_tests, Pool};
use catique_infrastructure::db::runner::run_pending;
use serde_json::{json, Value};

fn fresh_pool() -> Pool {
    let pool = memory_pool_for_tests();
    let mut conn = pool.get().unwrap();
    run_pending(&mut conn).unwrap();
    drop(conn);
    pool
}

fn unwrap_id(value: &Value) -> String {
    value
        .get("id")
        .and_then(Value::as_str)
        .unwrap_or_else(|| panic!("entity has no string `id`: {value}"))
        .to_owned()
}

#[test]
fn tag_crud_round_trip() {
    let pool = fresh_pool();

    let created = dispatch_entity(
        &pool,
        "tag",
        json!({ "action": "create", "name": "urgent", "color": "#ff0000" }),
    )
    .expect("tag.create");
    let id = unwrap_id(&created);

    let listed = dispatch_entity(&pool, "tag", json!({ "action": "list" })).expect("tag.list");
    let names: Vec<&str> = listed
        .as_array()
        .unwrap()
        .iter()
        .filter_map(|t| t.get("name").and_then(Value::as_str))
        .collect();
    assert!(names.contains(&"urgent"), "tag.list missed inserted row");

    let fetched =
        dispatch_entity(&pool, "tag", json!({ "action": "get", "id": id })).expect("tag.get");
    assert_eq!(fetched.get("name").and_then(Value::as_str), Some("urgent"));

    let deleted =
        dispatch_entity(&pool, "tag", json!({ "action": "delete", "id": id })).expect("tag.delete");
    assert_eq!(deleted, json!({ "ok": true }));
}

#[test]
fn role_crud_round_trip() {
    let pool = fresh_pool();

    let created = dispatch_entity(
        &pool,
        "role",
        json!({ "action": "create", "name": "reviewer", "content": "Reviews code." }),
    )
    .expect("role.create");
    let id = unwrap_id(&created);

    let fetched =
        dispatch_entity(&pool, "role", json!({ "action": "get", "id": id })).expect("role.get");
    assert_eq!(
        fetched.get("name").and_then(Value::as_str),
        Some("reviewer")
    );

    let listed = dispatch_entity(&pool, "role", json!({ "action": "list" })).expect("role.list");
    assert!(
        listed
            .as_array()
            .unwrap()
            .iter()
            .any(|r| { r.get("id").and_then(Value::as_str) == Some(id.as_str()) }),
        "role.list missed inserted row",
    );
}

#[test]
fn prompt_create_and_update_round_trip() {
    let pool = fresh_pool();

    let created = dispatch_entity(
        &pool,
        "prompt",
        json!({
            "action": "create",
            "name": "smoke",
            "content": "hello",
        }),
    )
    .expect("prompt.create");
    let id = unwrap_id(&created);

    let updated = dispatch_entity(
        &pool,
        "prompt",
        json!({
            "action": "update",
            "id": id,
            "name": "smoke-v2",
        }),
    )
    .expect("prompt.update");
    assert_eq!(
        updated.get("name").and_then(Value::as_str),
        Some("smoke-v2")
    );
}

#[test]
fn unknown_action_returns_helpful_error() {
    let pool = fresh_pool();
    let err = dispatch_entity(&pool, "task", json!({ "action": "fly" })).expect_err("must fail");
    assert!(err.contains("task"));
    assert!(err.contains("fly"));
}

#[test]
fn missing_action_returns_helpful_error() {
    let pool = fresh_pool();
    let err = dispatch_entity(&pool, "task", json!({ "id": "anything" })).expect_err("must fail");
    assert!(err.contains("task"));
    assert!(err.contains("action"));
}

#[test]
fn async_legacy_method_refuses_in_sync_dispatch() {
    let pool = fresh_pool();
    let err = dispatch_entity(
        &pool,
        "skill",
        json!({ "action": "import_from_url", "url": "https://example.invalid" }),
    )
    .expect_err("import_from_url must be rejected in sync path");
    assert!(err.contains("import_skill_from_url"));
    assert!(err.contains("async"));
}

#[test]
fn setting_get_set_round_trip() {
    let pool = fresh_pool();

    dispatch_entity(
        &pool,
        "setting",
        json!({ "action": "set", "key": "selected_space", "value": "sp1" }),
    )
    .expect("setting.set");

    let got = dispatch_entity(
        &pool,
        "setting",
        json!({ "action": "get", "key": "selected_space" }),
    )
    .expect("setting.get");
    assert_eq!(got.as_str(), Some("sp1"));
}
