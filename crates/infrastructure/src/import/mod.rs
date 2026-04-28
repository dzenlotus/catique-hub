//! Promptery v0.4 → Catique import primitives.
//!
//! Wave-E2.7 (Olga, 2026-04-28). Implements the migration plan v0.5
//! (D-027) at the storage layer:
//!
//! * [`schema`] — embedded Promptery v0.4 schema bundle + canonical
//!   D-019 hash for compile-time PF-4 validation.
//! * [`copy`] — read-only snapshot of the source DB into the target's
//!   `.import-tmp/` working directory.
//! * [`preflight`] — the 10 PF checks (PF-1..PF-10) that must all pass
//!   before any data is touched.
//! * [`sequencer`] — the canonical 28-step FK-import order, single
//!   `BEGIN IMMEDIATE TRANSACTION`, plus the FTS double-insert fix
//!   (D-025 #4 / D-027 §3.2a footer).
//! * [`attachments`] — recursive filesystem copy of
//!   `~/.promptery/attachments/`, byte-size verified.
//!
//! ## Telemetry
//!
//! Per D-021 Q-4 (closed in D-027), the import module emits **zero**
//! telemetry events. All forensic data flows through the `ImportReport`
//! that the use-case layer returns to the UI; the same record is
//! written locally to `$APPLOCALDATA/catique/logs/`. No network calls.

pub mod attachments;
pub mod copy;
pub mod preflight;
pub mod schema;
pub mod sequencer;

pub use attachments::{copy_attachments, AttachmentsCopyOutcome};
pub use copy::{snapshot_source, SnapshotOutcome};
pub use preflight::{run_preflight, PreflightContext, PreflightOutcome};
pub use schema::{compute_source_schema_hash, EXPECTED_SOURCE_SCHEMA_HASH};
pub use sequencer::{run_import_transaction, SequencerOutcome};

/// Errors produced by the import pipeline.
///
/// Wraps `rusqlite::Error` and `std::io::Error` plus a free-form
/// `Validation` variant for preflight failures and contract checks
/// (e.g. schema-hash drift).
#[derive(Debug, thiserror::Error)]
pub enum ImportError {
    /// Validation / contract failure with a human-readable reason
    /// (passed straight through to `AppError::Validation` upstream).
    #[error("import validation failed: {reason}")]
    Validation { reason: String },

    /// Filesystem error during snapshot, attachments copy, or rename.
    #[error("io: {0}")]
    Io(#[from] std::io::Error),

    /// SQLite error during preflight, sequencer, or schema-apply.
    #[error("sqlite: {0}")]
    Sqlite(#[from] rusqlite::Error),

    /// `r2d2` pool acquisition timed out.
    #[error("pool timeout")]
    PoolTimeout,
}

impl From<crate::db::pool::DbError> for ImportError {
    fn from(value: crate::db::pool::DbError) -> Self {
        match value {
            crate::db::pool::DbError::PoolTimeout(_) | crate::db::pool::DbError::Pool(_) => {
                Self::PoolTimeout
            }
            crate::db::pool::DbError::Sqlite(e) => Self::Sqlite(e),
            crate::db::pool::DbError::Io(e) => Self::Io(e),
        }
    }
}
