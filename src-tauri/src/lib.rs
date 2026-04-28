// Catique HUB — Tauri 2.x entry point.
//
// E1.1 (this commit) ships only the bare scaffold. Per ADR D-022 (IPC over Tauri commands),
// domain handlers will be wired in subsequent waves (boards, prompts, agents, ...).
//
// E1.2 (Olga) will split this crate into a 5-crate workspace:
//   catique-core, catique-db, catique-ipc, catique-mcp, catique-app.

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .setup(|_app| Ok(()))
        .run(tauri::generate_context!())
        .expect("error while running Catique HUB");
}
