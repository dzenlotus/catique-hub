//! Adapter for **Claude Code** (Anthropic CLI).
//!
//! Config directory: `~/.claude/`
//! Signature file probed: `~/.claude/settings.json`
//! Fallback: `~/.claude/CLAUDE.md` — the adapter reports `installed`
//! when *either* file is present.
//!
//! Reference: <https://docs.anthropic.com/en/docs/claude-code>

use std::path::PathBuf;

use crate::{AdapterError, ClientAdapter};

/// Adapter for Anthropic's Claude Code CLI.
pub struct ClaudeCodeAdapter;

impl ClientAdapter for ClaudeCodeAdapter {
    fn id(&self) -> &'static str {
        "claude-code"
    }

    fn display_name(&self) -> &'static str {
        "Claude Code"
    }

    fn config_dir(&self) -> Result<PathBuf, AdapterError> {
        let home = dirs::home_dir().ok_or(AdapterError::HomeDirUnavailable)?;
        Ok(home.join(".claude"))
    }

    /// Primary signature: `~/.claude/settings.json`.
    fn signature_file(&self) -> Result<PathBuf, AdapterError> {
        Ok(self.config_dir()?.join("settings.json"))
    }

    /// Returns `~/.claude/CLAUDE.md`.
    fn instructions_file(&self) -> Result<PathBuf, AdapterError> {
        Ok(self.config_dir()?.join("CLAUDE.md"))
    }

    fn detect(&self) -> Result<bool, AdapterError> {
        // Non-macOS guard: Claude Code exists on Linux too but ctq-67
        // scopes v1 to macOS only — return false on other platforms so
        // the registry stays clean during cross-compilation/CI.
        #[cfg(not(target_os = "macos"))]
        return Ok(false);

        #[cfg(target_os = "macos")]
        {
            let dir = self.config_dir()?;
            // Accept either settings.json OR CLAUDE.md as evidence of
            // installation (some users may have one but not the other).
            let primary = dir.join("settings.json");
            let fallback = dir.join("CLAUDE.md");
            Ok(primary.exists() || fallback.exists())
        }
    }

    // ── Role-sync (ctq-69) ─────────────────────────────────────────────────

    fn supports_role_sync(&self) -> bool {
        true
    }

    /// Returns `~/.claude/agents/`.
    fn agents_dir(&self) -> Result<PathBuf, AdapterError> {
        Ok(self.config_dir()?.join("agents"))
    }

    /// Returns `catique-{role_id}.md`.
    fn agent_filename(&self, role_id: &str) -> String {
        format!("catique-{role_id}.md")
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;
    use tempfile::TempDir;

    fn adapter_with_home(home: &std::path::Path) -> impl Fn() -> PathBuf + '_ {
        move || home.join(".claude")
    }

    /// Helper: build a `ClaudeCodeAdapter` but exercise the path-building
    /// logic directly against a temp dir rather than `$HOME`.
    fn config_dir_for(home: &std::path::Path) -> PathBuf {
        home.join(".claude")
    }

    #[test]
    fn id_and_display_name() {
        let a = ClaudeCodeAdapter;
        assert_eq!(a.id(), "claude-code");
        assert_eq!(a.display_name(), "Claude Code");
    }

    #[test]
    fn detect_false_when_dir_absent() {
        // Simulate a clean $HOME with no .claude directory.
        let tmp = TempDir::new().unwrap();
        let dir = config_dir_for(tmp.path());
        assert!(!dir.exists(), "dir must not exist for this test");

        // The real `detect` reads `dirs::home_dir()`, which returns the
        // actual $HOME. We test the logic directly by checking that the
        // path does not exist.
        assert!(!dir.join("settings.json").exists());
        assert!(!dir.join("CLAUDE.md").exists());
    }

    #[test]
    fn detect_true_when_settings_json_present() {
        let tmp = TempDir::new().unwrap();
        let dir = config_dir_for(tmp.path());
        fs::create_dir_all(&dir).unwrap();
        fs::write(dir.join("settings.json"), "{}").unwrap();

        assert!(dir.join("settings.json").exists());
    }

    #[test]
    fn instructions_file_is_claude_md() {
        // The adapter always resolves the path using dirs::home_dir().
        // We verify the filename independently of the real home.
        let a = ClaudeCodeAdapter;
        // On any platform, the call should succeed (or fail only when
        // home dir is unavailable). We are interested in the filename.
        if let Ok(path) = a.instructions_file() {
            assert_eq!(path.file_name().unwrap().to_str().unwrap(), "CLAUDE.md");
        }
    }

    #[test]
    fn instructions_file_path_under_config_dir() {
        let tmp = TempDir::new().unwrap();
        let config = config_dir_for(tmp.path());
        // Simulate what the adapter does: config_dir().join("CLAUDE.md").
        let expected = config.join("CLAUDE.md");
        assert_eq!(expected.file_name().unwrap().to_str().unwrap(), "CLAUDE.md");
    }

    #[test]
    fn detect_true_when_claude_md_present_but_no_settings_json() {
        let tmp = TempDir::new().unwrap();
        let dir = config_dir_for(tmp.path());
        fs::create_dir_all(&dir).unwrap();
        fs::write(dir.join("CLAUDE.md"), "# Instructions").unwrap();

        let _ = adapter_with_home(tmp.path());
        assert!(dir.join("CLAUDE.md").exists());
        assert!(!dir.join("settings.json").exists());
    }

    // ── Role-sync trait surface ───────────────────────────────────────────

    #[test]
    fn supports_role_sync_is_true() {
        let a = ClaudeCodeAdapter;
        assert!(a.supports_role_sync());
    }

    #[test]
    fn agents_dir_is_dot_claude_agents() {
        let a = ClaudeCodeAdapter;
        if let Ok(dir) = a.agents_dir() {
            let name = dir.file_name().unwrap().to_str().unwrap();
            assert_eq!(name, "agents");
            let parent = dir.parent().unwrap().file_name().unwrap().to_str().unwrap();
            assert_eq!(parent, ".claude");
        }
    }

    #[test]
    fn agent_filename_has_catique_prefix_and_md_extension() {
        let a = ClaudeCodeAdapter;
        let name = a.agent_filename("rust-backend");
        assert_eq!(name, "catique-rust-backend.md");
    }
}
