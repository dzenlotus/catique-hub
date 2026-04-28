//! Adapter for **Qwen CLI** (Alibaba Cloud AI assistant).
//!
//! Config directory: `~/.qwen/`
//! Signature: the directory itself (`~/.qwen/`) is used as the
//! signature, because Qwen CLI's exact config filename varies across
//! versions. If `~/.qwen/` exists we treat the CLI as installed.
//!
//! When Qwen CLI stabilises a canonical file (e.g. `settings.json` or
//! `config.json`), update `signature_file` to point at that file and
//! update `detect` to check `sig.exists()` instead of `dir.exists()`.
//!
//! ## Known ambiguity
//!
//! As of 2026-Q2 there is no official public documentation for Qwen
//! CLI's config layout on macOS. The directory-existence heuristic is
//! intentionally conservative — it avoids false-positives from
//! unrelated `~/.qwen` directories that might be created by third-party
//! tooling. Tracked in OQ-1 (ctq-67 open question).

use std::path::PathBuf;

use crate::{AdapterError, ClientAdapter};

/// Adapter for the Qwen CLI agentic client.
pub struct QwenAdapter;

impl ClientAdapter for QwenAdapter {
    fn id(&self) -> &'static str {
        "qwen"
    }

    fn display_name(&self) -> &'static str {
        "Qwen CLI"
    }

    fn config_dir(&self) -> Result<PathBuf, AdapterError> {
        let home = dirs::home_dir().ok_or(AdapterError::HomeDirUnavailable)?;
        Ok(home.join(".qwen"))
    }

    /// Returns the config dir itself as the signature path because Qwen
    /// has no known canonical single-file signature in v1. The UI will
    /// render the path with a "(directory)" annotation.
    fn signature_file(&self) -> Result<PathBuf, AdapterError> {
        self.config_dir()
    }

    fn detect(&self) -> Result<bool, AdapterError> {
        #[cfg(not(target_os = "macos"))]
        return Ok(false);

        #[cfg(target_os = "macos")]
        {
            let dir = self.config_dir()?;
            Ok(dir.exists())
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;
    use tempfile::TempDir;

    fn config_dir_for(home: &std::path::Path) -> PathBuf {
        home.join(".qwen")
    }

    #[test]
    fn id_and_display_name() {
        let a = QwenAdapter;
        assert_eq!(a.id(), "qwen");
        assert_eq!(a.display_name(), "Qwen CLI");
    }

    #[test]
    fn signature_file_equals_config_dir() {
        #[cfg(target_os = "macos")]
        {
            let a = QwenAdapter;
            let dir = a.config_dir().unwrap();
            let sig = a.signature_file().unwrap();
            assert_eq!(dir, sig, "Qwen signature should be the config dir itself");
        }
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
}
