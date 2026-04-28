//! Error type for the client adapter layer.

use thiserror::Error;

/// Errors that an adapter can produce.
#[derive(Debug, Error)]
pub enum AdapterError {
    /// The OS-level home directory (`~`) could not be resolved.
    ///
    /// This happens when `$HOME` is unset on Linux/macOS or the Windows
    /// user profile is missing. Callers should surface this as a
    /// configuration error in the UI.
    #[error("home directory is unavailable on this system")]
    HomeDirUnavailable,

    /// This adapter does not support role-file sync.
    ///
    /// Returned by adapters where the agent-definition file format is
    /// unknown (e.g. Qwen CLI in v1) or where per-project agents are
    /// out of scope (e.g. Claude Desktop v1).
    #[error("role sync is not supported for this client")]
    SyncNotSupported,
}
