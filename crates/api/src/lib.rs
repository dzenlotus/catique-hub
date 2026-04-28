//! Catique HUB — IPC layer.
//!
//! Per ADR-0001 §OQ-3, IPC handlers are organised modularly by domain
//! bounded context. Each handler module under [`handlers`] owns its
//! domain's commands; the only "flat" artefact is the registration list
//! that `src-tauri/src/lib.rs` passes to `tauri::generate_handler!`.
//!
//! Wave-E1 stub: each handler module exports `pub fn register() {}`
//! plus, for `settings`, a single `ping` command used to smoke-test the
//! IPC wiring end-to-end before E2 fleshes out real handlers.
//!
//! `error::AppError` is the single typed error enum returned from every
//! command. Variants enumerated per ADR-0001 §Условия выбора-3 + NFR
//! §3-§4.

// Lints configured via [lints.clippy] in Cargo.toml.

pub mod error;
pub mod handlers;

pub use error::AppError;
