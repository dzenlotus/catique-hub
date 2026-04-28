//! Catique HUB — IPC layer.
//!
//! Per ADR-0001 §OQ-3, IPC handlers are organised modularly by domain
//! bounded context. Each handler module under [`handlers`] owns its
//! domain's commands; the only "flat" artefact is the registration list
//! that `src-tauri/src/lib.rs` passes to `tauri::generate_handler!`.
//!
//! Wave-E2 (Olga, 2026-04-28): the `boards` module is fully wired —
//! see `handlers::boards::{list_boards, create_board, get_board}`.
//! Other handler modules remain Wave-E1 stubs.
//!
//! [`AppError`] is the single typed error enum returned from every
//! command. It now lives in `catique-application` (moved in E2 to break
//! the would-be cycle when use cases started returning it themselves).
//! Re-exported here so existing callers (`catique_api::AppError`) keep
//! working — and so ts-rs's `#[ts(export)]` test fires when callers run
//! `cargo test -p catique-application`.

// Lints configured via [lints.clippy] in Cargo.toml.

pub mod events;
pub mod handlers;
pub mod state;

pub use catique_application::AppError;
pub use state::AppState;
