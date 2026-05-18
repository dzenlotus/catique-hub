//! Tauri shell build script.
//!
//! W1 (catique-hub-mcp standalone binary, 2026-05-14): the Tauri bundle
//! ships a sibling Rust binary (the MCP server) via `externalBin`.
//! Tauri's bundler looks for each entry under
//! `binaries/<base>-<target-triple>{,.exe}`.
//!
//! Because `catique-mcp-server-bin` is a workspace member, the normal
//! `cargo build --workspace` (and `cargo tauri build`, which forwards
//! to it) produces the binary at
//! `target/<target?>/<profile>/catique-hub-mcp`. This build script
//! does NOT invoke cargo recursively — that would deadlock on the
//! per-workspace target lock. Instead it locates the freshly-built
//! binary and copies it into the staging directory the bundler scans.
//!
//! If the binary is missing the script emits a `cargo:warning=` and
//! continues. The .app bundle build will then fail with a clearer
//! "external binary not found" error from Tauri's bundler downstream,
//! which is the expected behaviour when the caller has not yet run
//! `cargo build --bin catique-hub-mcp` first.

use std::env;
use std::fs;
use std::path::{Path, PathBuf};

fn main() {
    if let Err(err) = stage_mcp_external_bin() {
        println!("cargo:warning=catique-hub-mcp staging skipped: {err}");
    }
    tauri_build::build();
}

fn stage_mcp_external_bin() -> Result<(), String> {
    let manifest_dir = PathBuf::from(env::var("CARGO_MANIFEST_DIR").map_err(|e| e.to_string())?);
    let workspace_root = manifest_dir
        .parent()
        .ok_or("CARGO_MANIFEST_DIR has no parent")?;
    let target = env::var("TARGET").map_err(|e| e.to_string())?;
    let profile = env::var("PROFILE").map_err(|e| e.to_string())?;

    // Cargo writes per-target binaries under
    // `target/<triple>/<profile>/` when `--target` is supplied, and
    // under `target/<profile>/` otherwise. We probe both.
    let exe_suffix = if cfg!(windows) { ".exe" } else { "" };
    let candidates = [
        workspace_root
            .join("target")
            .join(&target)
            .join(&profile)
            .join(format!("catique-hub-mcp{exe_suffix}")),
        workspace_root
            .join("target")
            .join(&profile)
            .join(format!("catique-hub-mcp{exe_suffix}")),
    ];
    let built_path = candidates
        .iter()
        .find(|p| p.exists())
        .ok_or_else(|| {
            format!(
                "expected catique-hub-mcp under target/{{{target},}}/{profile}/; run `cargo build --bin catique-hub-mcp` first"
            )
        })?;

    // Stage into `src-tauri/binaries/`. Tauri appends the target
    // triple to the externalBin base name when locating the source.
    let staging_dir = manifest_dir.join("binaries");
    fs::create_dir_all(&staging_dir).map_err(|e| format!("create staging dir: {e}"))?;
    let staged_path = staging_dir.join(format!("catique-hub-mcp-{target}{exe_suffix}"));
    copy_if_changed(built_path, &staged_path).map_err(|e| format!("stage MCP binary: {e}"))?;

    // Re-run the build script if either side changes.
    println!("cargo:rerun-if-changed={}", built_path.display());
    println!("cargo:rerun-if-changed={}", staged_path.display());
    Ok(())
}

fn copy_if_changed(src: &Path, dst: &Path) -> std::io::Result<()> {
    if let (Ok(src_meta), Ok(dst_meta)) = (fs::metadata(src), fs::metadata(dst)) {
        if src_meta.len() == dst_meta.len() {
            if let (Ok(src_mtime), Ok(dst_mtime)) = (src_meta.modified(), dst_meta.modified()) {
                if src_mtime <= dst_mtime {
                    return Ok(());
                }
            }
        }
    }
    fs::copy(src, dst).map(|_| ())
}
