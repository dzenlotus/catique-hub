//! Catique HUB — Tauri 2.x shell entry point.
//!
//! Wave-E2 (Olga, 2026-04-28): the shell now resolves the DB path,
//! opens an r2d2 connection pool, runs pending migrations, and stores
//! the result as `AppState` for handlers to borrow. Per NFR §3.1
//! ("panic semantics"), startup-phase errors **do not panic**: we log
//! and return cleanly so the dev launcher can show a useful message.

// Lints configured via [lints.clippy] in Cargo.toml.

use catique_api::{handlers, AppState};
use catique_infrastructure::db::{open_pool, run_pending};
use catique_infrastructure::paths::db_path;

/// Entrypoint invoked by `main.rs` (and on mobile by
/// `tauri::mobile_entry_point`).
#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let state = match init_state() {
        Ok(state) => state,
        Err(reason) => {
            // NFR §3.1: don't panic on startup-phase failures. Log and
            // return cleanly — the dev runner / packaged app launcher
            // surfaces a "DB unavailable" badge to the user.
            eprintln!("[catique-hub] startup aborted: {reason}");
            return;
        }
    };

    if let Err(err) = tauri::Builder::default()
        .manage(state)
        .setup(|_app| Ok(()))
        .invoke_handler(tauri::generate_handler![
            // ---------------- boards (E2.1) ----------------
            handlers::boards::create_board,
            handlers::boards::get_board,
            handlers::boards::list_boards,
            // ---------------- settings ----------------
            handlers::settings::ping,
            // E2.2+ will append commands per domain, alphabetised within
            // each handlers::<domain>:: block; comment-banner separates
            // domains for grep-ability.
        ])
        .run(tauri::generate_context!())
    {
        eprintln!("[catique-hub] tauri runtime exited: {err}");
    }
}

/// Side-effect-bearing init: resolve path → open pool → run migrations.
/// Folded into a small helper so `run()` stays linear and testable
/// at the call-site level (via integration tests in E2.7).
fn init_state() -> Result<AppState, String> {
    let path = db_path().map_err(|e| format!("resolve db path: {e}"))?;
    let pool = open_pool(&path).map_err(|e| format!("open sqlite pool at {}: {e}", path.display()))?;

    let mut conn = pool
        .get()
        .map_err(|e| format!("acquire migration connection: {e}"))?;
    let applied = run_pending(&mut conn).map_err(|e| format!("run migrations: {e}"))?;
    drop(conn);

    if !applied.is_empty() {
        let names: Vec<&str> = applied.iter().map(|m| m.name.as_str()).collect();
        eprintln!("[catique-hub] applied migrations: {names:?}");
    }
    Ok(AppState::new(pool))
}
