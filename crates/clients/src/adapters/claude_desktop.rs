//! Adapter for **Claude Desktop** (Anthropic Electron app).
//!
//! Config directory: `~/Library/Application Support/Claude/`
//! Signature file:   `~/Library/Application Support/Claude/claude_desktop_config.json`
//!
//! Reference: Anthropic Claude Desktop documentation.

use std::path::PathBuf;

use crate::{AdapterError, ClientAdapter};

/// Adapter for the Claude Desktop application.
pub struct ClaudeDesktopAdapter;

impl ClientAdapter for ClaudeDesktopAdapter {
    fn id(&self) -> &'static str {
        "claude-desktop"
    }

    fn display_name(&self) -> &'static str {
        "Claude Desktop"
    }

    fn config_dir(&self) -> Result<PathBuf, AdapterError> {
        let home = dirs::home_dir().ok_or(AdapterError::HomeDirUnavailable)?;
        Ok(home
            .join("Library")
            .join("Application Support")
            .join("Claude"))
    }

    fn signature_file(&self) -> Result<PathBuf, AdapterError> {
        Ok(self.config_dir()?.join("claude_desktop_config.json"))
    }

    /// Returns `~/Library/Application Support/Claude/CLAUDE.md`.
    ///
    /// Note: per-project instructions (`<project>/.claude/CLAUDE.md`)
    /// are out of scope for v1.
    fn instructions_file(&self) -> Result<PathBuf, AdapterError> {
        Ok(self.config_dir()?.join("CLAUDE.md"))
    }

    fn detect(&self) -> Result<bool, AdapterError> {
        #[cfg(not(target_os = "macos"))]
        return Ok(false);

        #[cfg(target_os = "macos")]
        {
            let sig = self.signature_file()?;
            Ok(sig.exists())
        }
    }

    // ── Role-sync (ctq-69) ─────────────────────────────────────────────────

    /// Claude Desktop: per-project agents are out of scope for v1.
    /// Global-only mode is undefined in the Desktop app. Sync disabled.
    fn supports_role_sync(&self) -> bool {
        false
    }

    fn agents_dir(&self) -> Result<PathBuf, AdapterError> {
        Err(AdapterError::SyncNotSupported)
    }

    fn agent_filename(&self, _role_id: &str) -> String {
        String::new()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn id_and_display_name() {
        let a = ClaudeDesktopAdapter;
        assert_eq!(a.id(), "claude-desktop");
        assert_eq!(a.display_name(), "Claude Desktop");
    }

    #[test]
    fn config_dir_contains_library_path() {
        // Only meaningful to inspect the path on macOS; skip on other
        // platforms where dirs::home_dir() may return a Linux-style path.
        #[cfg(target_os = "macos")]
        {
            let a = ClaudeDesktopAdapter;
            let dir = a.config_dir().unwrap();
            let display = dir.to_string_lossy();
            assert!(
                display.contains("Library/Application Support/Claude"),
                "unexpected path: {display}"
            );
        }
    }

    #[test]
    fn instructions_file_is_claude_md() {
        #[cfg(target_os = "macos")]
        {
            let a = ClaudeDesktopAdapter;
            let path = a.instructions_file().unwrap();
            assert_eq!(
                path.file_name().unwrap().to_str().unwrap(),
                "CLAUDE.md"
            );
            let display = path.to_string_lossy();
            assert!(
                display.contains("Library/Application Support/Claude"),
                "unexpected path: {display}"
            );
        }
    }

    #[test]
    fn signature_file_basename_is_correct() {
        #[cfg(target_os = "macos")]
        {
            let a = ClaudeDesktopAdapter;
            let sig = a.signature_file().unwrap();
            assert_eq!(
                sig.file_name().unwrap().to_str().unwrap(),
                "claude_desktop_config.json"
            );
        }
    }

    // ── Role-sync trait surface ───────────────────────────────────────────

    #[test]
    fn supports_role_sync_is_false() {
        let a = ClaudeDesktopAdapter;
        assert!(!a.supports_role_sync());
    }

    #[test]
    fn agents_dir_returns_sync_not_supported() {
        let a = ClaudeDesktopAdapter;
        match a.agents_dir() {
            Err(AdapterError::SyncNotSupported) => {}
            other => panic!("expected SyncNotSupported, got {other:?}"),
        }
    }
}
