//! Round-trip TS-bindings export.
//!
//! Each entity calls `Type::export()` explicitly. ts-rs 8.x **also**
//! auto-generates a per-type `export_bindings_<Type>` `#[test]` from
//! `#[ts(export)]`; running `cargo test -p catique-domain` triggers both,
//! and the binding `.ts` files land in `bindings/` at workspace root.
//!
//! NOTE on the original brief (Olga): the brief mentioned
//! `Space::export_all()` — that API does not exist on ts-rs 8.x. The
//! correct call is `Space::export()` (per-type) which matches the auto-
//! generated test the macro emits. Documented here so future-Olga doesn't
//! get confused chasing a non-existent `export_all`.

use catique_domain::{
    AgentReport, Attachment, Board, Column, Prompt, PromptGroup, Role, Space, Tag, Task,
};
use ts_rs::TS;

#[test]
fn export_space() {
    Space::export().expect("Space TS bindings should export cleanly");
}

#[test]
fn export_board() {
    Board::export().expect("Board TS bindings should export cleanly");
}

#[test]
fn export_column() {
    Column::export().expect("Column TS bindings should export cleanly");
}

#[test]
fn export_task() {
    Task::export().expect("Task TS bindings should export cleanly");
}

#[test]
fn export_prompt() {
    Prompt::export().expect("Prompt TS bindings should export cleanly");
}

#[test]
fn export_role() {
    Role::export().expect("Role TS bindings should export cleanly");
}

#[test]
fn export_tag() {
    Tag::export().expect("Tag TS bindings should export cleanly");
}

#[test]
fn export_agent_report() {
    AgentReport::export().expect("AgentReport TS bindings should export cleanly");
}

#[test]
fn export_attachment() {
    Attachment::export().expect("Attachment TS bindings should export cleanly");
}

// ---------------- prompt_group (E2.x) ----------------

#[test]
fn export_prompt_group() {
    PromptGroup::export().expect("PromptGroup TS bindings should export cleanly");
}

