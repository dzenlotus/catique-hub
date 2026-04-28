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
}
