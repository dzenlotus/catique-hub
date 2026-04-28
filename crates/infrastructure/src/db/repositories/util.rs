//! Tiny shared helpers used by every repository.
//!
//! Keeping these in one place avoids the same `now_millis` / `new_id`
//! pair appearing in eight different files; if we ever swap nanoid for
//! ULID, or switch to a monotonic clock, only one site changes.
//!
//! No public re-exports from `mod.rs` — these are crate-internal.

use std::time::{SystemTime, UNIX_EPOCH};

/// Wall-clock epoch milliseconds. Returns `0` for pre-1970 system clocks
/// or `i64`-overflow at year 292M — both are clock pathologies the
/// caller cannot recover from anyway, so we silently floor.
#[must_use]
pub(crate) fn now_millis() -> i64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .ok()
        .and_then(|d| i64::try_from(d.as_millis()).ok())
        .unwrap_or(0)
}

/// 21-char URL-safe identifier (nanoid default alphabet). Collision
/// probability for the desktop scale we target is negligible — see
/// nanoid's collision-calc table.
#[must_use]
pub(crate) fn new_id() -> String {
    nanoid::nanoid!()
}
