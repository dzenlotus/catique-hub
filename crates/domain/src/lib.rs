//! Catique HUB — domain layer.
//!
//! Pure value objects + entity structs. **NO external IO** (no DB, no FS,
//! no network). Per ADR-0001 §OQ-3 and Clean-Architecture-ish layering,
//! this crate is the innermost ring: depended on by `application`,
//! `infrastructure`, and `api`; depends on nothing in the workspace.
//!
//! ## TS bindings
//!
//! Every entity derives [`ts_rs::TS`] with `#[ts(export, export_to = "../../../bindings/")]`.
//! Running `cargo test -p catique-domain` triggers the per-type
//! auto-generated `export_bindings_*` test that ts-rs emits, which writes
//! the `.ts` file into `bindings/` at workspace root.
//!
//! ## Wave-E1 scope
//!
//! Stub structs only — fields mirror Promptery v0.4 schema
//! (`docs/catique-migration/schemas/promptery-v0.4-schema.sql`). No
//! methods. Use cases land in `catique-application` during E2.
//!
//! Field-name convention: `snake_case` in Rust, `camelCase` in TS via
//! `#[ts(rename_all = "camelCase")]` per-struct (ADR-0001 §Naming).

// Lints configured via [lints.clippy] in Cargo.toml — manifest-driven
// so all crates share a single source of truth (NFR §5.2).

pub mod agent_report;
pub mod attachment;
pub mod board;
pub mod column;
pub mod connected_client;
pub mod connected_provider;
pub mod mcp_call_log;
pub mod mcp_server;
pub mod mcp_tool;
pub mod prompt;
pub mod prompt_group;
pub mod prompt_tag_map;
pub mod role;
pub mod search;
pub mod skill;
pub mod skill_attachment;
pub mod space;
pub mod tag;
pub mod task;
pub mod task_bundle;
pub mod task_match;
pub mod task_rating;

pub use agent_report::AgentReport;
pub use attachment::Attachment;
pub use board::Board;
pub use column::Column;
pub use connected_client::{ConnectedClient, ConnectionStatus};
pub use connected_provider::{SupportedProvider, SyncState, SyncStatus};
pub use mcp_call_log::McpCallLog;
pub use mcp_server::{McpServer, Transport};
pub use mcp_tool::{McpTool, McpToolSource};
pub use prompt::Prompt;
pub use prompt_group::PromptGroup;
pub use prompt_tag_map::PromptTagMapEntry;
pub use role::Role;
pub use search::SearchResult;
pub use skill::Skill;
pub use skill_attachment::{SkillAttachment, SkillAttachmentKind};
pub use space::Space;
pub use tag::Tag;
pub use task::Task;
pub use task_bundle::{
    McpToolWithOrigin, OriginRef, PromptWithOrigin, SkillWithOrigin, TaskBundle,
};
pub use task_match::TaskMatch;
pub use task_rating::TaskRating;
