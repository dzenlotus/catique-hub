//! Adapter for **Cursor** (AI-first code editor).
//!
//! Config directory: `~/.cursor/`
//! Signature file:   `~/.cursor/mcp.json`
//!
//! Reference: Cursor documentation on MCP configuration.

use std::path::PathBuf;

use crate::{AdapterError, ClientAdapter};

/// Adapter for the Cursor AI code editor.
pub struct CursorAdapter;

impl ClientAdapter for CursorAdapter {
    fn id(&self) -> &'static str {
        "cursor"
    }

    fn display_name(&self) -> &'static str {
        "Cursor"
    }

    fn config_dir(&self) -> Result<PathBuf, AdapterError> {
        let home = dirs::home_dir().ok_or(AdapterError::HomeDirUnavailable)?;
        Ok(home.join(".cursor"))
    }

    fn signature_file(&self) -> Result<PathBuf, AdapterError> {
        Ok(self.config_dir()?.join("mcp.json"))
    }

    /// Returns `~/.cursor/rules.mdc`.
    ///
    /// Cursor's directory-of-rules pattern is out of scope for v1;
    /// this single file is the canonical global instructions path.
    fn instructions_file(&self) -> Result<PathBuf, AdapterError> {
        Ok(self.config_dir()?.join("rules.mdc"))
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

    fn supports_role_sync(&self) -> bool {
        true
    }

    /// Returns `~/.cursor/rules/`.
    ///
    /// Note: Cursor's "rules" directory is separate from the single
    /// global `rules.mdc` instructions file — we write per-role `.mdc`
    /// files here.
    fn agents_dir(&self) -> Result<PathBuf, AdapterError> {
        Ok(self.config_dir()?.join("rules"))
    }

    /// Returns `catique-{role_id}.mdc`.
    fn agent_filename(&self, role_id: &str) -> String {
        format!("catique-{role_id}.mdc")
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;
    use tempfile::TempDir;

    fn config_dir_for(home: &std::path::Path) -> PathBuf {
        home.join(".cursor")
    }

    #[test]
    fn id_and_display_name() {
        let a = CursorAdapter;
        assert_eq!(a.id(), "cursor");
        assert_eq!(a.display_name(), "Cursor");
    }

    #[test]
    fn signature_file_is_mcp_json() {
        let tmp = TempDir::new().unwrap();
        let dir = config_dir_for(tmp.path());
        fs::create_dir_all(&dir).unwrap();
        let sig = dir.join("mcp.json");
        assert_eq!(sig.file_name().unwrap().to_str().unwrap(), "mcp.json");
    }

    #[test]
    fn instructions_file_is_rules_mdc() {
        let tmp = TempDir::new().unwrap();
        let dir = config_dir_for(tmp.path());
        let expected = dir.join("rules.mdc");
        assert_eq!(
            expected.file_name().unwrap().to_str().unwrap(),
            "rules.mdc"
        );
    }

    #[test]
    fn detect_false_when_mcp_json_absent() {
        let tmp = TempDir::new().unwrap();
        let dir = config_dir_for(tmp.path());
        // No mcp.json — even if the .cursor dir exists, not installed.
        fs::create_dir_all(&dir).unwrap();
        assert!(!dir.join("mcp.json").exists());
    }

    // ── Role-sync trait surface ───────────────────────────────────────────

    #[test]
    fn supports_role_sync_is_true() {
        let a = CursorAdapter;
        assert!(a.supports_role_sync());
    }

    #[test]
    fn agents_dir_is_dot_cursor_rules() {
        let a = CursorAdapter;
        if let Ok(dir) = a.agents_dir() {
            let name = dir.file_name().unwrap().to_str().unwrap();
            assert_eq!(name, "rules");
            let parent = dir.parent().unwrap().file_name().unwrap().to_str().unwrap();
            assert_eq!(parent, ".cursor");
        }
    }

    #[test]
    fn agent_filename_has_catique_prefix_and_mdc_extension() {
        let a = CursorAdapter;
        let name = a.agent_filename("frontend-engineer");
        assert_eq!(name, "catique-frontend-engineer.mdc");
    }
}
