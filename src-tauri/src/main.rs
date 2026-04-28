// Prevents additional console window on Windows in release; do NOT remove.
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    catique_hub_lib::run();
}
