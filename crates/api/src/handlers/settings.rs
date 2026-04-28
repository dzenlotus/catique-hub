//! `settings` domain handlers (`get_setting`, `set_setting`, ...).
//!
//! Wave-E1 stub: only the `ping` smoke-test command is wired.

/// E2 will populate per-domain initialisation here (e.g. preload the
/// `settings` table cache).
pub fn register() {}

/// IPC smoke-test. Returns a fixed string so the Tauri shell can verify
/// the handler is reachable from JS without any DB / FS dependency.
#[tauri::command]
#[must_use]
pub fn ping() -> &'static str {
    "catique-hub: alive"
}
