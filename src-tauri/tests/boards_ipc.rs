//! Boards IPC integration tests — DEFERRED to Wave-E2.7.
//!
//! The brief asked for an integration test that spawns a Tauri test app
//! and exercises `list_boards` / `create_board` / `get_board` via a mock
//! invoker. Tauri 2.x's `tauri::test::mock_app` API requires a
//! non-trivial setup (mock window, mock state injection, async runtime
//! plumbing) and the boards use case is already covered end-to-end at
//! the use-case level (`crates/application/src/boards.rs#tests`).
//!
//! Rather than ship a half-working integration harness, this file is a
//! deliberate placeholder so the test crate exists and CI doesn't have
//! to be retrained when E2.7 lands.
//!
//! TODO(E2.7, Olga): build the tauri-test harness, copy the use-case
//! tests one-for-one through the IPC layer, and assert serialisation
//! of `AppError` matches `bindings/AppError.ts`.

#[test]
fn placeholder_ipc_integration_deferred_to_e2_7() {
    // Intentionally empty — see module docs.
}
