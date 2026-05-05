//! Single typed error enum returned by every IPC command.
//!
//! Variants are fixed by ADR-0001 §Условия выбора-3 (cross-checked
//! against NFR §3 reliability + §4 security). Adding a variant requires
//! a decision-log entry; the discriminant set is part of the IPC
//! contract.
//!
//! `AppError` derives `Serialize` so Tauri can flatten it into the
//! `invoke` Promise's reject value. It also derives `TS` so the UI gets
//! a typed union — see `bindings/AppError.ts` after `cargo test
//! -p catique-application`.
//!
//! ## Why does this live in `catique-application`, not `catique-api`?
//!
//! Wave-E1 (Olga) put it under `crates/api/src/error.rs` because at
//! that time api was the only crate that needed it. E2 introduces a
//! `BoardsUseCase` whose methods return `Result<_, AppError>` so the api
//! handler can `?`-propagate without converting. To keep the dependency
//! arrow strictly application → infrastructure → domain (and api on top
//! of all three), the type now lives in the use-case layer; the api
//! crate re-exports it for its `pub use` ergonomics.
//! No public surface change for downstream callers.

use serde::{Deserialize, Serialize};
use thiserror::Error;
use ts_rs::TS;

/// All errors crossing the Rust↔TS IPC boundary.
///
/// Each variant carries enough context for the UI to render a useful
/// message without leaking internal state (e.g. raw SQL strings, secret
/// values — see NFR §4.1 redaction rule).
#[derive(TS, Serialize, Deserialize, Error, Clone, Debug, PartialEq, Eq)]
#[ts(export, export_to = "../../../bindings/", rename_all = "camelCase")]
#[serde(tag = "kind", content = "data", rename_all = "camelCase")]
pub enum AppError {
    /// Payload failed structural or business-rule validation
    /// (NFR §4.2). `field` names the offending JSON pointer fragment;
    /// `reason` is a human-readable explanation.
    #[error("validation failed on `{field}`: {reason}")]
    Validation { field: String, reason: String },

    /// A multi-write DB transaction was rolled back due to a constraint
    /// violation, FK error, or runtime check (NFR §3.2).
    #[error("transaction rolled back: {reason}")]
    TransactionRolledBack { reason: String },

    /// SQLite reported `SQLITE_BUSY` and our 500 ms `busy_timeout`
    /// elapsed without acquiring the lock (NFR §3.3).
    #[error("database busy; retry recommended")]
    DbBusy,

    /// A non-DB lock (sidecar lockfile, attachment-upload semaphore)
    /// could not be acquired within its timeout (NFR §3.3).
    #[error("lock acquire timed out: {resource}")]
    LockTimeout { resource: String },

    /// A handler panicked and was caught by the per-command
    /// `catch_unwind` shim (NFR §3.1). `handler` identifies the command;
    /// `message` is the panic payload string-cast.
    #[error("internal panic in `{handler}`: {message}")]
    InternalPanic { handler: String, message: String },

    /// Entity addressed by ID does not exist (or was filtered out by a
    /// scope predicate the caller did not satisfy).
    #[error("`{entity}` not found: {id}")]
    NotFound { entity: String, id: String },

    /// State-level conflict (e.g. unique-name violation that the schema
    /// catches but the user-facing error is friendlier than a raw
    /// constraint error).
    #[error("conflict on `{entity}`: {reason}")]
    Conflict { entity: String, reason: String },

    /// Secret read/write rejected by the OS keychain (NFR §4.1).
    /// `secret_ref` is a UUID, never the secret value itself.
    #[error("secret access denied for `{secret_ref}`")]
    SecretAccessDenied {
        // Explicit per-field rename: variant-body fields don't pick up
        // the enum-level `rename_all = "camelCase"` (serde applies that
        // to variant *names*; field-rename needs the v1.0.181+
        // `rename_all_fields` which ts-rs 8.x doesn't yet honour).
        #[serde(rename = "secretRef")]
        #[ts(rename = "secretRef")]
        secret_ref: String,
    },

    /// Action targets a resource the caller is not allowed to mutate —
    /// e.g. attempting to delete an `is_system` row seeded by a
    /// migration. Distinct from `Validation` so the UI can render a
    /// different affordance (lock icon vs. inline form error).
    #[error("forbidden: {reason}")]
    Forbidden { reason: String },

    /// Request payload is structurally valid but semantically rejected
    /// at the use-case layer — e.g. supplying a coordinator role where
    /// only an owner role is allowed. Distinct from `Validation` (which
    /// targets a single `field`) and `Conflict` (which is a state-level
    /// collision, not a request-shape issue).
    #[error("bad request: {reason}")]
    BadRequest { reason: String },
}
