//! Adapter for **OpenAI Codex CLI**.
//!
//! Config directory: `~/.codex/`
//! Signature: the directory itself — Codex CLI writes a handful of
//! files (`config.json`, session caches) whose names have shifted across
//! preview releases, so we treat the directory's existence as the
//! installation marker. Same conservative strategy as [`super::qwen`].
//!
//! Role-sync target: `~/.codex/agents/` with `.md` payloads, mirroring
//! the Claude Code convention. Codex' "agents" directory follows the
//! emerging community norm (also adopted by OpenCode); the user can
//! rename if Codex stabilises a different layout.
//!
//! Instructions file: `~/.codex/AGENTS.md` (community convention).

use std::path::PathBuf;

use crate::{AdapterError, ClientAdapter};

/// Adapter for the OpenAI Codex CLI agentic client.
pub struct CodexAdapter;

impl ClientAdapter for CodexAdapter {
    fn id(&self) -> &'static str {
        "codex"
    }

    fn display_name(&self) -> &'static str {
        "Codex"
    }

    fn config_dir(&self) -> Result<PathBuf, AdapterError> {
        let home = dirs::home_dir().ok_or(AdapterError::HomeDirUnavailable)?;
        Ok(home.join(".codex"))
    }

    /// Returns the config dir itself as the signature path because Codex
    /// CLI's exact config filename varies across preview builds.
    fn signature_file(&self) -> Result<PathBuf, AdapterError> {
        self.config_dir()
    }

    /// Returns `~/.codex/AGENTS.md`.
    fn instructions_file(&self) -> Result<PathBuf, AdapterError> {
        Ok(self.config_dir()?.join("AGENTS.md"))
    }

    fn detect(&self) -> Result<bool, AdapterError> {
        // Mirror the macOS-only stance shared by every v1 adapter
        // (ctq-67). On Linux Codex installs into `~/.config/codex/`
        // instead — once v1.x ships Linux support we can branch on
        // `target_os` here.
        #[cfg(not(target_os = "macos"))]
        return Ok(false);

        #[cfg(target_os = "macos")]
        {
            let dir = self.config_dir()?;
            Ok(dir.exists())
        }
    }

    // ── Role-sync (ctq-69) ─────────────────────────────────────────────────

    fn supports_role_sync(&self) -> bool {
        true
    }

    /// Returns `~/.codex/agents/`.
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

    fn config_dir_for(home: &std::path::Path) -> PathBuf {
        home.join(".codex")
    }

    #[test]
    fn id_and_display_name() {
        let a = CodexAdapter;
        assert_eq!(a.id(), "codex");
        assert_eq!(a.display_name(), "Codex");
    }

    #[test]
    fn signature_file_equals_config_dir() {
        #[cfg(target_os = "macos")]
        {
            let a = CodexAdapter;
            let dir = a.config_dir().unwrap();
            let sig = a.signature_file().unwrap();
            assert_eq!(dir, sig, "Codex signature should be the config dir itself");
        }
    }

    #[test]
    fn instructions_file_is_agents_md() {
        let tmp = TempDir::new().unwrap();
        let dir = config_dir_for(tmp.path());
        let expected = dir.join("AGENTS.md");
        assert_eq!(expected.file_name().unwrap().to_str().unwrap(), "AGENTS.md");
    }

    #[test]
    fn detect_false_when_dir_absent() {
        let tmp = TempDir::new().unwrap();
        let dir = config_dir_for(tmp.path());
        assert!(!dir.exists());
    }

    #[test]
    fn detect_true_when_dir_exists() {
        let tmp = TempDir::new().unwrap();
        let dir = config_dir_for(tmp.path());
        fs::create_dir_all(&dir).unwrap();
        assert!(dir.exists());
    }

    // ── Role-sync trait surface ───────────────────────────────────────────

    #[test]
    fn supports_role_sync_is_true() {
        let a = CodexAdapter;
        assert!(a.supports_role_sync());
    }

    #[test]
    fn agents_dir_is_dot_codex_agents() {
        let a = CodexAdapter;
        if let Ok(dir) = a.agents_dir() {
            let name = dir.file_name().unwrap().to_str().unwrap();
            assert_eq!(name, "agents");
            let parent = dir.parent().unwrap().file_name().unwrap().to_str().unwrap();
            assert_eq!(parent, ".codex");
        }
    }

    #[test]
    fn agent_filename_has_catique_prefix_and_md_extension() {
        let a = CodexAdapter;
        let name = a.agent_filename("rust-backend");
        assert_eq!(name, "catique-rust-backend.md");
    }
}
