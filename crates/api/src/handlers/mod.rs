//! Per-domain IPC handler modules (ADR-0001 §OQ-3).
//!
//! `register()` on each module is a deliberately empty marker: the real
//! registration is the `tauri::generate_handler!` list in
//! `src-tauri/src/lib.rs` — Tauri requires that to be flat. Keeping a
//! `register()` stub here lets E2 add per-module setup hooks
//! (e.g. background reindexers) without touching the registration site.

pub mod attachments;
pub mod boards;
pub mod columns;
pub mod import;
pub mod mcp_tools;
pub mod prompts;
pub mod reports;
pub mod roles;
pub mod search;
pub mod secrets;
pub mod settings;
pub mod skills;
pub mod spaces;
pub mod tags;
pub mod tasks;
