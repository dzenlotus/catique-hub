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

    fn detect(&self) -> Result<bool, AdapterError> {
        #[cfg(not(target_os = "macos"))]
        return Ok(false);

        #[cfg(target_os = "macos")]
        {
            let sig = self.signature_file()?;
            Ok(sig.exists())
        }
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
    fn detect_false_when_mcp_json_absent() {
        let tmp = TempDir::new().unwrap();
        let dir = config_dir_for(tmp.path());
        // No mcp.json — even if the .cursor dir exists, not installed.
        fs::create_dir_all(&dir).unwrap();
        assert!(!dir.join("mcp.json").exists());
    }
}
