//! Provider for **Claude Desktop** (Anthropic's desktop app for macOS / Windows).
//!
//! ## What this adapter manages
//!
//! Under ADR-0008 (MCP pass-through proxy) Claude Desktop integrates
//! with Catique HUB through the desktop app's MCP config file — a
//! single entry pointing at the Catique sidecar. Once written, every
//! upstream MCP server registered in Catique HUB is reachable to a
//! Claude Desktop session as a proxied tool (`{server.name}.{tool}`),
//! without the user touching the desktop's settings.
//!
//! Claude Desktop does **not** support managed agent files in the
//! Claude-Code sense (system prompts as on-disk files per role). That
//! surface is `false` for this provider.
//!
//! ## Paths
//!
//! Platform-specific by design (Apple's `Application Support` /
//! Microsoft's `%APPDATA%`). The detect step probes the parent
//! directory rather than the JSON file itself — the file is created
//! on first launch of the app and may not exist yet for a fresh
//! install that has never been opened.
//!
//! | Platform | Config path |
//! |---|---|
//! | macOS    | `~/Library/Application Support/Claude/claude_desktop_config.json` |
//! | Windows  | `%APPDATA%/Claude/claude_desktop_config.json` |
//! | Linux    | unsupported by Anthropic; adapter `detect()` returns `false` |
//!
//! ## Atomicity rules
//!
//! `claude_desktop_config.json` is owned by the desktop app and may
//! contain unrelated keys (`globalShortcut`, future settings, etc.).
//! Same defensive read-mutate-write pattern as
//! [`claude_code::mutate_claude_json`]: parse the whole JSON, mutate
//! only `mcpServers["catique-hub"]`, write back atomically via
//! tmp+rename. Foreign keys are preserved verbatim.
//!
//! Reference: <https://modelcontextprotocol.io/quickstart/user>

use std::path::PathBuf;

use async_trait::async_trait;
use serde_json::{Map, Value};

use crate::{
    adapters::claude_code::mutate_claude_json, ClientProvider, McpEntry, ProviderError,
    RemoveReport, RoleBundle, SyncReport, CATIQUE_MCP_KEY,
};
// `home_dir` is only consumed by the macOS config-dir branch below; gate
// the import so non-macOS builds don't carry an unused import.
#[cfg(target_os = "macos")]
use crate::adapters::common::home_dir;

/// Provider for Anthropic's Claude Desktop app.
pub struct ClaudeDesktopProvider;

impl ClaudeDesktopProvider {
    /// Resolve the platform-specific path to `claude_desktop_config.json`.
    ///
    /// macOS: `~/Library/Application Support/Claude/claude_desktop_config.json`
    /// Windows: `%APPDATA%/Claude/claude_desktop_config.json`
    /// Linux: `Err(ProviderError::Unsupported)` — the app is not
    /// distributed for Linux.
    fn mcp_config_path() -> Result<PathBuf, ProviderError> {
        let dir = app_data_dir()?;
        Ok(dir.join("claude_desktop_config.json"))
    }

    /// Parent directory (for `detect` — the JSON file may not exist
    /// yet on a brand-new install).
    fn app_dir() -> Result<PathBuf, ProviderError> {
        app_data_dir()
    }
}

#[async_trait]
impl ClientProvider for ClaudeDesktopProvider {
    fn id(&self) -> &'static str {
        "claude-desktop"
    }

    fn display_name(&self) -> &'static str {
        "Claude Desktop"
    }

    fn supports_agent_files(&self) -> bool {
        // Claude Desktop reads its system prompts from app state, not
        // from on-disk files. There is no agents directory to populate.
        false
    }

    fn supports_mcp(&self) -> bool {
        true
    }

    async fn detect(&self) -> Result<bool, ProviderError> {
        // The `Claude/` directory under platform AppData is the proof
        // of installation. The JSON file inside may not exist yet on
        // a brand-new install — `sync` will create it.
        match Self::app_dir() {
            Ok(dir) => Ok(tokio::fs::metadata(&dir).await.is_ok()),
            // Unsupported platform (Linux) → not installed.
            Err(ProviderError::Unsupported(_)) => Ok(false),
            Err(other) => Err(other),
        }
    }

    async fn sync(&self, bundle: &RoleBundle) -> Result<SyncReport, ProviderError> {
        // MCP slot only — no agent files for this provider.
        if let Some(mcp) = bundle.mcp.as_ref() {
            // Ensure the parent dir exists; the user may have a fresh
            // install where the JSON file was never written.
            tokio::fs::create_dir_all(Self::app_dir()?).await?;
            mutate_claude_json(&Self::mcp_config_path()?, |servers| {
                servers.insert(CATIQUE_MCP_KEY.to_string(), mcp_entry_to_value(mcp));
            })
            .await?;
        }
        Ok(SyncReport {
            written: Vec::new(),
            removed: Vec::new(),
            skipped: Vec::new(),
        })
    }

    async fn remove(&self) -> Result<RemoveReport, ProviderError> {
        let mut removed: Vec<String> = Vec::new();

        let mcp_path = Self::mcp_config_path()?;
        if tokio::fs::metadata(&mcp_path).await.is_ok() {
            mutate_claude_json(&mcp_path, |servers| {
                servers.remove(CATIQUE_MCP_KEY);
            })
            .await?;
            removed.push(format!(
                "{}#mcpServers.{CATIQUE_MCP_KEY}",
                mcp_path.display()
            ));
        }

        Ok(RemoveReport {
            removed,
            skipped: Vec::new(),
        })
    }
}

/// Resolve the platform `Claude/` directory under AppData. The
/// abstraction lives in this module rather than in `common.rs` because
/// no other adapter uses an AppData directory — Claude Code and Codex
/// both root themselves under `~/`.
fn app_data_dir() -> Result<PathBuf, ProviderError> {
    #[cfg(target_os = "macos")]
    {
        Ok(home_dir()?.join("Library/Application Support/Claude"))
    }
    #[cfg(target_os = "windows")]
    {
        let raw = std::env::var("APPDATA").map_err(|_| {
            ProviderError::Unsupported(
                "claude-desktop: APPDATA env var not set (expected on Windows)".into(),
            )
        })?;
        Ok(PathBuf::from(raw).join("Claude"))
    }
    #[cfg(not(any(target_os = "macos", target_os = "windows")))]
    {
        Err(ProviderError::Unsupported(
            "claude-desktop is not distributed for this platform".into(),
        ))
    }
}

/// Project an [`McpEntry`] into Claude Desktop's JSON shape. The
/// schema mirrors Claude Code's — both apps consume the same
/// `mcpServers["..."] = { command, args, env }` shape — but kept
/// adapter-local so a future schema drift (e.g. desktop-only
/// `transport` field) does not couple the two providers.
fn mcp_entry_to_value(entry: &McpEntry) -> Value {
    let mut obj = Map::new();
    obj.insert("command".into(), Value::String(entry.command.clone()));
    obj.insert(
        "args".into(),
        Value::Array(entry.args.iter().cloned().map(Value::String).collect()),
    );
    if !entry.env.is_empty() {
        let mut env = Map::new();
        for (k, v) in &entry.env {
            env.insert(k.clone(), Value::String(v.clone()));
        }
        obj.insert("env".into(), Value::Object(env));
    }
    Value::Object(obj)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn provider_metadata() {
        let p = ClaudeDesktopProvider;
        assert_eq!(p.id(), "claude-desktop");
        assert_eq!(p.display_name(), "Claude Desktop");
        assert!(!p.supports_agent_files(), "no agent files for desktop");
        assert!(p.supports_mcp());
    }

    #[cfg(target_os = "macos")]
    #[test]
    fn mcp_config_path_lives_under_application_support() {
        let path = ClaudeDesktopProvider::mcp_config_path().unwrap();
        let s = path.to_string_lossy();
        assert!(
            s.contains("Library/Application Support/Claude"),
            "unexpected path: {s}"
        );
        assert!(s.ends_with("claude_desktop_config.json"));
    }

    #[cfg(target_os = "windows")]
    #[test]
    fn mcp_config_path_lives_under_appdata() {
        // SAFETY: tests are single-threaded; env mutation is local.
        std::env::set_var("APPDATA", r"C:\Users\test\AppData\Roaming");
        let path = ClaudeDesktopProvider::mcp_config_path().unwrap();
        let s = path.to_string_lossy();
        assert!(s.contains("Claude"));
        assert!(s.ends_with("claude_desktop_config.json"));
    }

    #[cfg(not(any(target_os = "macos", target_os = "windows")))]
    #[test]
    fn detect_on_linux_returns_false() {
        let rt = tokio::runtime::Builder::new_current_thread()
            .enable_all()
            .build()
            .unwrap();
        let p = ClaudeDesktopProvider;
        let detected = rt.block_on(p.detect()).unwrap();
        assert!(!detected);
    }
}
