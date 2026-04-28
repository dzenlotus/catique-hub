//! Catique HUB — Tauri 2.x shell entry point.
//!
//! Wave-E1.2 (Olga): the original single-crate scaffold has been split
//! into a 5-crate workspace (see workspace `Cargo.toml`). The shell here
//! does only what Tauri requires:
//!   1. Build the `tauri::Builder`.
//!   2. Register IPC commands via `tauri::generate_handler!` — the only
//!      place where the per-domain modules from `catique-api` get
//!      collapsed back into a flat list (Tauri requirement).
//!   3. Run the event loop.
//!
//! E2 will add: setup hooks (DB-pool init via
//! `catique-infrastructure::db`, ts-rs codegen check), more handlers
//! across the per-domain modules, AppState management.

// Lints configured via [lints.clippy] in Cargo.toml.

use catique_api::handlers;

/// Entrypoint invoked by `main.rs` (and on mobile by
/// `tauri::mobile_entry_point`).
///
/// # Panics
///
/// Tauri's `Builder::run` returns `Err` only if the runtime fails to
/// initialise (typically: missing icons, malformed `tauri.conf.json`).
/// We surface that as a panic at startup — there is no UI to recover
/// into. NFR §3.1 panic-recovery covers post-startup panics in
/// command handlers, not the shell-init phase.
#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .setup(|_app| Ok(()))
        .invoke_handler(tauri::generate_handler![
            // ---------------- settings ----------------
            handlers::settings::ping,
            // E2 will append commands per domain, alphabetised within
            // each handlers::<domain>:: block; comment-banner separates
            // domains for grep-ability.
        ])
        .run(tauri::generate_context!())
        .expect("error while running Catique HUB");
}
