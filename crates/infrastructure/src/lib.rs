//! Catique HUB — infrastructure layer.
//!
//! SQLite (via rusqlite-bundled), filesystem, and secret-store adapters.
//! Wave-E1 stub: module skeleton + the `paths::app_data_dir()` helper.
//! E2 populates the rest (connection pool, migration runner, FS helpers,
//! keychain wrapper).

// Lints configured via [lints.clippy] in Cargo.toml.

pub mod db;
pub mod fs;
pub mod import;
pub mod paths;
