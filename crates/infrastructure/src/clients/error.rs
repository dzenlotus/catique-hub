//! Registry error type.

use thiserror::Error;

/// Errors that can occur when loading or saving the client registry.
#[derive(Debug, Error)]
pub enum RegistryError {
    /// `dirs::home_dir()` returned `None`.
    #[error("home directory is unavailable")]
    HomeDirUnavailable,

    /// Filesystem I/O failure (read, write, rename, mkdir).
    #[error("registry I/O error: {0}")]
    Io(#[from] std::io::Error),

    /// JSON serialization or deserialization failure.
    #[error("registry JSON error: {0}")]
    Json(#[from] serde_json::Error),
}
