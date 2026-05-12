//! Concrete client providers — one file per supported agentic client.
//!
//! Round-21 (Connected Providers refactor) trims the v1 set down to the
//! three providers that ship managed agent files **and** managed MCP
//! configuration: Claude Code, Codex, OpenCode. The dropped adapters
//! (`claude_desktop`, `qwen`, `cursor`) are removed end-to-end — see
//! the round-21 decisions doc for rationale.

pub mod claude_code;
pub mod codex;
pub(crate) mod common;
pub mod opencode;
