//! Concrete client providers — one file per supported agentic client.
//!
//! Round-21 (Connected Providers refactor) trimmed the v1 set to the
//! three providers that ship managed agent files **and** managed MCP
//! configuration: Claude Code, Codex, OpenCode.
//!
//! Post-ADR-0008 (2026-05-12) re-added **Claude Desktop** as an
//! MCP-only provider (`supports_agent_files = false`). Under the
//! pass-through proxy model, Claude Desktop integrates by writing a
//! single `catique-hub` entry into its `claude_desktop_config.json`
//! — there is no agent-file write surface, so the v1 "must do both"
//! rationale no longer applies.
//!
//! `qwen` and `cursor` stay dropped (separate integration story).

pub mod claude_code;
pub mod claude_desktop;
pub mod codex;
pub(crate) mod common;
pub mod opencode;
