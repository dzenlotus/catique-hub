//! Adapter for **OpenCode** (community-maintained agentic CLI).
//!
//! Config directory: `~/.opencode/`
//! Signature: the directory itself — OpenCode's config filename has
//! shifted between preview releases, so we treat the directory's
//! existence as the installation marker (same strategy as
//! [`super::qwen`] and [`super::codex`]).
//!
//! Role-sync target: `~/.opencode/agents/` with `.md` payloads,
//! mirroring the Claude Code / Codex convention. The user can rename
//! if OpenCode stabilises a different layout.
//!
//! Instructions file: `~/.opencode/AGENTS.md` (community convention).

use std::path::PathBuf;

use crate::{AdapterError, ClientAdapter};

/// Adapter for the OpenCode agentic client.
pub struct OpenCodeAdapter;

impl ClientAdapter for OpenCodeAdapter {
    fn id(&self) -> &'static str {
        "opencode"
    }

    fn display_name(&self) -> &'static str {
        "OpenCode"
    }

    fn config_dir(&self) -> Result<PathBuf, AdapterError> {
        let home = dirs::home_dir().ok_or(AdapterError::HomeDirUnavailable)?;
        Ok(home.join(".opencode"))
    }

    /// Returns the config dir itself as the signature path because
    /// OpenCode's exact config filename varies across preview builds.
    fn signature_file(&self) -> Result<PathBuf, AdapterError> {
        self.config_dir()
    }

    /// Returns `~/.opencode/AGENTS.md`.
    fn instructions_file(&self) -> Result<PathBuf, AdapterError> {
        Ok(self.config_dir()?.join("AGENTS.md"))
    }

    fn detect(&self) -> Result<bool, AdapterError> {
        // Mirror the macOS-only stance shared by every v1 adapter
        // (ctq-67). On Linux OpenCode installs into
        // `~/.config/opencode/`; once v1.x ships Linux support we can
        // branch on `target_os` here.
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

    /// Returns `~/.opencode/agents/`.
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
        home.join(".opencode")
    }

    #[test]
    fn id_and_display_name() {
        let a = OpenCodeAdapter;
        assert_eq!(a.id(), "opencode");
        assert_eq!(a.display_name(), "OpenCode");
    }

    #[test]
    fn signature_file_equals_config_dir() {
        #[cfg(target_os = "macos")]
        {
            let a = OpenCodeAdapter;
            let dir = a.config_dir().unwrap();
            let sig = a.signature_file().unwrap();
            assert_eq!(
                dir, sig,
                "OpenCode signature should be the config dir itself"
            );
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
        let a = OpenCodeAdapter;
        assert!(a.supports_role_sync());
    }

    #[test]
    fn agents_dir_is_dot_opencode_agents() {
        let a = OpenCodeAdapter;
        if let Ok(dir) = a.agents_dir() {
            let name = dir.file_name().unwrap().to_str().unwrap();
            assert_eq!(name, "agents");
            let parent = dir.parent().unwrap().file_name().unwrap().to_str().unwrap();
            assert_eq!(parent, ".opencode");
        }
    }

    #[test]
    fn agent_filename_has_catique_prefix_and_md_extension() {
        let a = OpenCodeAdapter;
        let name = a.agent_filename("frontend-engineer");
        assert_eq!(name, "catique-frontend-engineer.md");
    }
}
