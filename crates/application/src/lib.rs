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

pub mod agent_files;
pub mod attachments;
pub mod boards;
pub mod clients;
pub mod columns;
pub mod connected_providers;
pub mod error;
mod error_map;
pub mod mcp_aggregated;
pub mod mcp_dispatch;
pub mod mcp_proxy;
pub mod mcp_servers;
pub mod mcp_tool_groups;
pub mod mcp_tools;
pub mod prompt_groups;
pub mod prompts;
pub mod reports;
pub mod resolver_backfill;
pub mod role_notes;
pub mod roles;
pub mod search;
pub mod settings;
pub mod skill_import;
pub mod skill_steps;
pub mod skills;
pub mod spaces;
pub mod tags;
pub mod tasks;
pub mod workflow;

pub use error::AppError;
