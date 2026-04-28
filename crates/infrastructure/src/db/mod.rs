//! SQLite-backed storage subsystem.
//!
//! Wave-E2 (Olga, 2026-04-28). Three sibling modules:
//!
//! * [`pool`] — r2d2 connection pool with per-connection PRAGMA setup
//!   (NFR §3.3: `journal_mode=WAL`, `foreign_keys=ON`, `busy_timeout=5000`).
//! * [`runner`] — embedded migration runner backed by `include_dir!`.
//!   Each migration applies inside `BEGIN IMMEDIATE TRANSACTION` and is
//!   recorded with a SHA-256 of its source for tamper detection.
//! * [`repositories`] — pure synchronous repos over `&Connection`. The
//!   use-case layer wraps them with pool-acquire + error mapping.
//!
//! The folder is the storage seam. The use-case layer
//! (`catique-application`) talks to repositories; nothing outside this
//! crate touches `rusqlite::Connection` directly.

pub mod pool;
pub mod repositories;
pub mod runner;

pub use pool::{open as open_pool, DbError, Pool};
pub use runner::{run_pending, MigrationApplied, MigrationError};
