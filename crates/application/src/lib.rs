//! Catique HUB — application (use case) layer.
//!
//! Use cases consume `catique-domain` types and call into
//! `catique-infrastructure` repositories via a connection pool. The
//! single typed error returned to the IPC boundary is [`AppError`] —
//! moved here from `catique-api` in E2 (see `error.rs` module doc for
//! the rationale).
//!
//! Wave-E2 (Olga, 2026-04-28): the `boards` module is fully implemented
//! as the first vertical slice. Other domain modules are still empty
//! stubs; they fill in over E2.x as their slice lands.

// Lints configured via [lints.clippy] in Cargo.toml.

pub mod attachments;
pub mod boards;
pub mod columns;
pub mod error;
mod error_map;
pub mod import;
pub mod mcp_tools;
pub mod prompts;
pub mod reports;
pub mod roles;
pub mod search;
pub mod settings;
pub mod skills;
pub mod spaces;
pub mod tags;
pub mod tasks;

pub use error::AppError;
