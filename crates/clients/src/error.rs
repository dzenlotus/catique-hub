//! Error type for the connected-provider layer.
//!
//! Round-21 (Connected Providers refactor) renamed `AdapterError` →
//! `ProviderError` and shed the `SyncNotSupported` variant: every
//! provider in the v1 set supports both agent files AND MCP, so a
//! "support" question is now a `bool` query on the trait, not an error
//! discriminant.

use thiserror::Error;

/// Errors that a [`crate::ClientProvider`] can surface.
#[derive(Debug, Error)]
pub enum ProviderError {
    /// The OS-level home directory (`~`) could not be resolved.
    #[error("home directory is unavailable on this system")]
    HomeDirUnavailable,

    /// Filesystem read / write / rename failed.
    ///
    /// Wraps the original `io::Error` for observability; callers should
    /// surface a generic "failed to write provider files" message in the
    /// UI rather than leaking the raw path.
    #[error("filesystem error: {0}")]
    Io(#[from] std::io::Error),

    /// JSON parse / serialise failed (Claude Code's `~/.claude.json`,
    /// OpenCode's `opencode.json`).
    #[error("json error: {0}")]
    Json(#[from] serde_json::Error),

    /// TOML parse failed (Codex's `~/.codex/config.toml`).
    #[error("toml parse error: {0}")]
    TomlParse(#[from] toml_edit::TomlError),

    /// Provider's on-disk state is malformed beyond recovery.
    ///
    /// Used when, for instance, `~/.claude.json` is not a JSON object at
    /// the top level, or the `[mcp_servers]` table in Codex's config is
    /// the wrong shape. Callers should fall back to leaving the file
    /// alone and surface a clear "manual cleanup needed" message.
    #[error("provider state malformed: {0}")]
    Malformed(String),
}

/// Compile-time guard that `ProviderError` is `Send + Sync` so the
/// async trait stays object-safe behind `dyn ClientProvider`. The
/// `#[allow(dead_code)]` keeps this assertion live without producing a
/// runtime symbol.
#[allow(dead_code)]
fn _assert_send_sync() {
    fn assert_send_sync<T: Send + Sync>() {}
    assert_send_sync::<ProviderError>();
}
