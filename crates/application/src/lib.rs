//! Catique HUB — application (use case) layer.
//!
//! Wave-E1 stub: module skeleton only. Each module file is empty bar a
//! marker comment; E2 populates the use cases (e.g. `boards::list_boards`,
//! `tasks::move_task`). Use cases consume `catique-domain` types and
//! depend on infrastructure traits via dependency injection (no direct
//! infra imports here — `catique-application` must remain pure).

// Lints configured via [lints.clippy] in Cargo.toml.

pub mod attachments;
pub mod boards;
pub mod columns;
pub mod prompts;
pub mod reports;
pub mod roles;
pub mod settings;
pub mod tags;
pub mod tasks;
