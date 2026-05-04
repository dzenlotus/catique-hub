//! Catique HUB — agentic client adapter layer (ctq-67).
//!
//! Each agentic client (Claude Code, Claude Desktop, Cursor, Qwen CLI) is
//! represented by a small `ClientAdapter` implementation (~50 LOC). The
//! adapter probes the filesystem to determine whether the client is
//! installed on the current machine.
//!
//! ## Adding a new client
//!
//! 1. Create `src/adapters/<name>.rs` implementing [`ClientAdapter`].
//! 2. Add it to the [`all_adapters`] factory below.
//! 3. No other changes required — the registry, use case, and IPC handler
//!    all iterate `all_adapters()`.
//!
//! ## Platform semantics
//!
//! All adapters are macOS-first (the product ships macOS-only in v1).
//! Each adapter's [`ClientAdapter::detect`] returns `Ok(false)` on
//! non-macOS targets without probing the filesystem.

pub mod adapters;
mod error;

pub use error::AdapterError;

use std::path::PathBuf;

/// Minimal contract every client adapter must satisfy.
///
/// Implementations live under [`adapters`]. The trait is object-safe so
/// the registry can hold a `Vec<Box<dyn ClientAdapter>>`.
pub trait ClientAdapter: Send + Sync {
    /// Stable kebab-case identifier, e.g. `"claude-code"`.
    fn id(&self) -> &'static str;

    /// Human-readable display name shown in the Settings UI.
    fn display_name(&self) -> &'static str;

    /// Absolute path to the client's config directory.
    ///
    /// On non-macOS this still returns the expected path (useful for
    /// rendering in the UI) but [`detect`] will return `Ok(false)`.
    ///
    /// # Errors
    ///
    /// [`AdapterError::HomeDirUnavailable`] when `dirs::home_dir()`
    /// returns `None`.
    fn config_dir(&self) -> Result<PathBuf, AdapterError>;

    /// Absolute path to the signature file probed by [`detect`].
    ///
    /// # Errors
    ///
    /// Propagates [`config_dir`]'s error.
    fn signature_file(&self) -> Result<PathBuf, AdapterError>;

    /// Returns `true` when the signature file exists on disk.
    ///
    /// Always returns `Ok(false)` on non-macOS targets without touching
    /// the filesystem.
    ///
    /// # Errors
    ///
    /// [`AdapterError::HomeDirUnavailable`] when the home directory
    /// cannot be resolved.
    fn detect(&self) -> Result<bool, AdapterError>;

    /// Absolute path to the canonical "global instructions" file for
    /// this client.
    ///
    /// Per-client mapping (v1):
    ///
    /// | Client         | Path                                                       |
    /// |----------------|------------------------------------------------------------|
    /// | Claude Code    | `~/.claude/CLAUDE.md`                                      |
    /// | Claude Desktop | `~/Library/Application Support/Claude/CLAUDE.md`           |
    /// | Cursor         | `~/.cursor/rules.mdc`                                      |
    /// | Qwen CLI       | `~/.qwen/QWEN.md`                                          |
    ///
    /// If the file does not exist on disk, callers should treat reads as
    /// an empty string — this method only returns the *expected* path; it
    /// never errors because the file is absent.
    ///
    /// # Errors
    ///
    /// Propagates [`config_dir`]'s error
    /// ([`AdapterError::HomeDirUnavailable`]).
    fn instructions_file(&self) -> Result<PathBuf, AdapterError>;

    // ── Role-sync extension (ctq-69) ───────────────────────────────────────

    /// `true` when this adapter supports one-way role-file sync from
    /// Catique Hub.
    ///
    /// Per-client v1 support matrix:
    ///
    /// | Client         | supported |
    /// |----------------|-----------|
    /// | Claude Code    | true      |
    /// | Claude Desktop | false     |
    /// | Cursor         | true      |
    /// | Qwen CLI       | false     |
    fn supports_role_sync(&self) -> bool;

    /// Directory where managed agent-definition files are written.
    ///
    /// Only called when [`supports_role_sync`] returns `true`.
    ///
    /// | Client      | Path                  |
    /// |-------------|-----------------------|
    /// | Claude Code | `~/.claude/agents/`   |
    /// | Cursor      | `~/.cursor/rules/`    |
    ///
    /// # Errors
    ///
    /// - [`AdapterError::SyncNotSupported`] when the adapter does not
    ///   support sync.
    /// - [`AdapterError::HomeDirUnavailable`] propagated from
    ///   [`config_dir`].
    fn agents_dir(&self) -> Result<PathBuf, AdapterError>;

    /// Filename for the managed file for a given `role_id`.
    ///
    /// Includes the `catique-` prefix (defence-in-depth: files are
    /// identifiable even if frontmatter is hand-edited away) and the
    /// correct extension per client format.
    ///
    /// | Client      | Pattern                   |
    /// |-------------|---------------------------|
    /// | Claude Code | `catique-{role_id}.md`    |
    /// | Cursor      | `catique-{role_id}.mdc`   |
    ///
    /// Always returns a valid filename string (no path separators).
    fn agent_filename(&self, role_id: &str) -> String;
}

/// Build the canonical ordered list of v1 adapters.
///
/// The order determines display order in the Settings UI and in the
/// registry JSON on disk.
#[must_use]
pub fn all_adapters() -> Vec<Box<dyn ClientAdapter>> {
    vec![
        Box::new(adapters::claude_code::ClaudeCodeAdapter),
        Box::new(adapters::claude_desktop::ClaudeDesktopAdapter),
        Box::new(adapters::codex::CodexAdapter),
        Box::new(adapters::cursor::CursorAdapter),
        Box::new(adapters::opencode::OpenCodeAdapter),
        Box::new(adapters::qwen::QwenAdapter),
    ]
}
