//! Application state shared with every Tauri command.
//!
//! Tauri injects `tauri::State<'_, AppState>` into each
//! `#[tauri::command]` that requests it; the underlying value is
//! created once in the shell (`src-tauri/src/lib.rs`) and stored via
//! `tauri::Builder::manage`.
//!
//! Wave-E2 (Olga). Only the SQLite pool lives here so far.
//!
//! Wave-E2.5 (Katya): adds `app_handle: OnceCell<AppHandle>`. The
//! handle is set exactly once from the Tauri `setup` callback and read
//! by every handler that needs to emit a realtime event (see
//! [`crate::events`]). `OnceCell` is the right primitive because:
//!
//! 1. AppState is shared via `tauri::State` (only `&AppState` is
//!    available in handlers), so we need interior mutability.
//! 2. The handle is initialised once and never replaced, so we don't
//!    need the heavier `RwLock` machinery.
//! 3. Tests construct an AppState without a Tauri app — leaving the
//!    cell empty makes [`crate::events::emit`] a silent no-op, which
//!    is exactly the behaviour we want for the existing unit suites.
//!
//! ADR-0002 spike (ctq-56): adds `sidecar: SidecarManager` and
//! `sidecar_dir: PathBuf`. These are set during shell startup and read
//! by the three sidecar IPC handlers. The real E5 implementation will
//! likely move this into a dedicated `SidecarState` wrapper.

use std::path::PathBuf;

use catique_infrastructure::db::pool::Pool;
use catique_sidecar::SidecarManager;
use once_cell::sync::OnceCell;
use tauri::AppHandle;

/// Shared, send+sync state. r2d2's [`Pool`] is `Clone` (Arc-internal),
/// so cloning the wrapper is the cheap way to hand a pool reference to
/// a use-case constructor inside a handler.
///
/// `app_handle` is `OnceCell<AppHandle>`: empty in tests (events become
/// no-ops), populated by the Tauri shell's `setup` callback in
/// production.
///
/// `sidecar` + `sidecar_dir` are the ADR-0002 spike additions (ctq-56).
/// Real E5 work will refine these into a proper `SidecarState` struct.
#[derive(Clone)]
pub struct AppState {
    pub pool: Pool,
    /// Tauri AppHandle slot. Set exactly once during shell startup;
    /// read by [`crate::events::emit`] to publish realtime events.
    pub app_handle: OnceCell<AppHandle>,
    /// ADR-0002 spike: sidecar lifecycle manager.
    pub sidecar: SidecarManager,
    /// ADR-0002 spike: resolved path to the sidecar directory.
    /// Used by `sidecar_restart` to re-spawn after a crash.
    pub sidecar_dir: PathBuf,
}

impl AppState {
    /// Construct from a pre-built pool. The shell layer is responsible
    /// for running migrations *before* wrapping it; this type makes no
    /// schema guarantees.
    ///
    /// `app_handle` is left empty — the Tauri shell calls
    /// [`AppState::set_app_handle`] from its `setup` callback.
    ///
    /// `sidecar` starts in the `Stopped` state; the shell calls
    /// [`SidecarManager::start`] from its `setup` callback.
    #[must_use]
    pub fn new(pool: Pool, sidecar_dir: PathBuf) -> Self {
        Self {
            pool,
            app_handle: OnceCell::new(),
            sidecar: SidecarManager::new(),
            sidecar_dir,
        }
    }

    /// Install the Tauri AppHandle. Idempotent: subsequent calls are
    /// silently dropped (the second `set` would return `Err` from
    /// OnceCell, which we collapse — startup-phase contract is "set
    /// once" so a second call is a programmer error we don't want to
    /// panic over).
    pub fn set_app_handle(&self, handle: AppHandle) {
        // Discarding the `Err(handle)` returned on a second set is
        // intentional — we don't panic on startup-phase double-init
        // (NFR §3.1). Logging is via the shell's eprintln! convention.
        if self.app_handle.set(handle).is_err() {
            eprintln!("[catique-hub] AppState::set_app_handle called more than once; ignored");
        }
    }
}
