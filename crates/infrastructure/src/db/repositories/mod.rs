//! Per-entity repositories. Pure synchronous methods over a
//! `&rusqlite::Connection` (or `&mut Connection` for transactional
//! ones). Async + pool acquisition is the use-case layer's job.
//!
//! Wave-E2.4 (Olga): the eight primary entities each get their own
//! module. Join-table helpers live on whichever entity is the natural
//! "owner" — see the wave-brief and individual module docs:
//!
//! * `roles.rs`   — `role_prompts`, `role_skills`, `role_mcp_tools`
//! * `prompts.rs` — `board_prompts`, `column_prompts`, `prompt_group_members`
//! * `tasks.rs`   — `task_prompts`, `task_prompt_overrides`
//! * `tags.rs`    — `prompt_tags`

pub mod agent_reports;
pub mod attachments;
pub mod boards;
pub mod columns;
pub mod inheritance;
pub mod mcp_servers;
pub mod mcp_tools;
pub mod prompt_groups;
pub mod prompts;
pub mod roles;
pub mod search;
pub mod settings;
pub mod skills;
pub mod spaces;
pub mod tags;
pub mod task_ratings;
pub mod tasks;

mod util;
