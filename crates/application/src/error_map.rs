//! Shared error-mapping helpers used by every use case.
//!
//! `DbError → AppError` follows a fixed table (NFR §3.3, ADR-0001):
//!
//!   * [`DbError::PoolTimeout`]  → [`AppError::DbBusy`]
//!   * [`DbError::Pool`]         → [`AppError::DbBusy`]
//!   * `Sqlite(constraint)`      → callers usually pre-check, so a raw
//!     constraint becomes [`AppError::TransactionRolledBack`]
//!   * `Sqlite(other)`           → [`AppError::TransactionRolledBack`]
//!   * `Io`                      → [`AppError::TransactionRolledBack`]
//!
//! Use cases can pass a richer translator when they need typed
//! `NotFound` / `Conflict` errors — those calls construct the variant
//! themselves before invoking the repository.

use catique_infrastructure::db::pool::DbError;
use rusqlite::ErrorCode;

use crate::error::AppError;

/// Plain default mapping. Constraint violations become
/// `TransactionRolledBack` — callers that want `NotFound` or
/// `Conflict` must detect the situation BEFORE the SQL call (e.g. via
/// an existence-check helper).
pub(crate) fn map_db_err(err: DbError) -> AppError {
    match err {
        DbError::PoolTimeout(_) | DbError::Pool(_) => AppError::DbBusy,
        DbError::Sqlite(rusqlite::Error::SqliteFailure(code, msg))
            if code.code == ErrorCode::ConstraintViolation =>
        {
            AppError::TransactionRolledBack {
                reason: format!(
                    "constraint violation: {}",
                    msg.unwrap_or_else(|| "(no message)".into())
                ),
            }
        }
        DbError::Sqlite(err) => AppError::TransactionRolledBack {
            reason: err.to_string(),
        },
        DbError::Io(err) => AppError::TransactionRolledBack {
            reason: err.to_string(),
        },
    }
}

/// Variant of [`map_db_err`] that translates `UNIQUE` / `CHECK` /
/// `NOT NULL` violations into [`AppError::Conflict`] under the supplied
/// `entity` name. Use when a downstream repository rejects an insert
/// because a unique-name index fired.
pub(crate) fn map_db_err_unique(err: DbError, entity: &'static str) -> AppError {
    match &err {
        DbError::Sqlite(rusqlite::Error::SqliteFailure(code, msg))
            if code.code == ErrorCode::ConstraintViolation =>
        {
            AppError::Conflict {
                entity: entity.into(),
                reason: msg.clone().unwrap_or_else(|| "constraint violation".into()),
            }
        }
        _ => map_db_err(err),
    }
}

/// Validate a non-empty trimmed `name`-like field. Returns the trimmed
/// value on success, or [`AppError::Validation`] with the supplied
/// `field` name.
pub(crate) fn validate_non_empty(field: &'static str, value: &str) -> Result<String, AppError> {
    let trimmed = value.trim();
    if trimmed.is_empty() {
        return Err(AppError::Validation {
            field: field.into(),
            reason: "must not be empty or whitespace-only".into(),
        });
    }
    if trimmed.len() > 200 {
        return Err(AppError::Validation {
            field: field.into(),
            reason: "must be at most 200 characters".into(),
        });
    }
    Ok(trimmed.to_owned())
}

/// Validate a `#RRGGBB` hex colour string (case-insensitive). Skips
/// validation when the option is `None`.
pub(crate) fn validate_optional_color(
    field: &'static str,
    color: Option<&str>,
) -> Result<(), AppError> {
    let Some(c) = color else {
        return Ok(());
    };
    let bytes = c.as_bytes();
    if bytes.len() != 7 || bytes[0] != b'#' {
        return Err(AppError::Validation {
            field: field.into(),
            reason: "must be `#RRGGBB` (7 chars, leading `#`)".into(),
        });
    }
    if !bytes[1..].iter().all(u8::is_ascii_hexdigit) {
        return Err(AppError::Validation {
            field: field.into(),
            reason: "must contain only hex digits after `#`".into(),
        });
    }
    Ok(())
}
