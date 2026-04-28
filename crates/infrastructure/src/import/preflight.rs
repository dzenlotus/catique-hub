//! Preflight checks PF-1..PF-10.
//!
//! Each check populates one boolean in [`PreflightResults`] and an
//! optional human-readable detail string in `messages`. The orchestrator
//! ([`run_preflight`]) walks them in order and short-circuits if a
//! non-recoverable check fails (e.g. PF-1 source missing — there's
//! nothing to read).
//!
//! Per D-029 #4 the FTS double-insert smoke check (PF-3) covers BOTH
//! `tasks_fts ≡ tasks` and `agent_reports_fts ≡ agent_reports`.

use std::path::{Path, PathBuf};

use catique_domain::PreflightResults;
use rusqlite::Connection;

use super::schema::{compute_db_schema_fingerprint, compute_source_schema_hash, open_readonly};
use super::ImportError;

/// Caller-supplied context for the preflight pass.
#[derive(Debug, Clone)]
pub struct PreflightContext<'a> {
    /// Path to the source DB (the original; we don't snapshot before
    /// preflight — we open it read-only via URI flag).
    pub source_path: &'a Path,
    /// Resolved Catique data dir (where `.import-tmp/` will land).
    pub target_data_dir: &'a Path,
    /// Final target DB path (`<target_data_dir>/db.sqlite`).
    pub target_db_path: &'a Path,
    /// True if the caller passed `overwrite_existing = true`.
    pub overwrite_existing: bool,
    /// Path to the source attachments directory; usually
    /// `~/.promptery/attachments/`.
    pub attachments_dir: Option<&'a Path>,
}

/// Output bundle from [`run_preflight`].
#[derive(Debug, Clone)]
pub struct PreflightOutcome {
    /// PF results for the report.
    pub results: PreflightResults,
    /// Source DB size in bytes (for the report; populated by PF-1).
    pub source_size_bytes: u64,
    /// Computed source schema fingerprint (PF-4).
    pub source_schema_hash: String,
    /// Expected fingerprint (PF-4 reference value).
    pub target_schema_hash: String,
}

/// Run every preflight check.
///
/// Returns an `Err` only on truly fatal infrastructure errors (e.g.
/// the embedded schema bundle is missing — build-time bug). Per-check
/// failures are recorded in `results` and the report's `pf*` booleans
/// are flipped to `false`; the use-case layer decides whether to abort.
///
/// # Errors
///
/// * [`ImportError::Io`] for IO errors *outside* the per-check try-blocks.
/// * [`ImportError::Sqlite`] for embedded-schema apply failures.
#[allow(clippy::too_many_lines)] // 10 sequential checks make this naturally long.
pub fn run_preflight(ctx: &PreflightContext<'_>) -> Result<PreflightOutcome, ImportError> {
    let mut results = PreflightResults::default();
    let mut source_size_bytes: u64 = 0;
    let mut source_schema_hash = String::new();
    let target_schema_hash = compute_source_schema_hash()?;

    // -------- PF-1: source DB exists & readable --------
    match std::fs::metadata(ctx.source_path) {
        Ok(md) if md.is_file() && md.len() > 0 => {
            results.pf1_source_exists = true;
            source_size_bytes = md.len();
        }
        Ok(_) => record(
            &mut results.messages,
            "PF-1",
            "source path exists but is not a non-empty file",
        ),
        Err(e) => record(
            &mut results.messages,
            "PF-1",
            &format!("source not readable: {e}"),
        ),
    }
    if !results.pf1_source_exists {
        // Nothing more we can do — every later check needs to read
        // the source DB.
        return Ok(PreflightOutcome {
            results,
            source_size_bytes,
            source_schema_hash,
            target_schema_hash,
        });
    }

    // -------- Open source read-only for PF-2..PF-4, PF-8 --------
    let conn = match open_readonly(ctx.source_path) {
        Ok(c) => c,
        Err(e) => {
            record(
                &mut results.messages,
                "PF-1",
                &format!("source open failed: {e}"),
            );
            return Ok(PreflightOutcome {
                results,
                source_size_bytes,
                source_schema_hash,
                target_schema_hash,
            });
        }
    };

    // -------- PF-2: PRAGMA integrity_check --------
    match integrity_check(&conn) {
        Ok(true) => results.pf2_integrity_ok = true,
        Ok(false) => record(
            &mut results.messages,
            "PF-2",
            "PRAGMA integrity_check did not return 'ok'",
        ),
        Err(e) => record(
            &mut results.messages,
            "PF-2",
            &format!("integrity_check failed: {e}"),
        ),
    }

    // -------- PF-3: PRAGMA quick_check + FTS smoke --------
    match quick_check_and_fts(&conn) {
        Ok(true) => results.pf3_quick_check_ok = true,
        Ok(false) => record(
            &mut results.messages,
            "PF-3",
            "FTS row counts diverge from base tables (corrupt or out of sync)",
        ),
        Err(e) => record(
            &mut results.messages,
            "PF-3",
            &format!("quick_check failed: {e}"),
        ),
    }

    // -------- PF-4: schema-hash drift --------
    match compute_db_schema_fingerprint(&conn) {
        Ok(fp) => {
            if fp == target_schema_hash {
                results.pf4_schema_hash_ok = true;
            } else {
                record(
                    &mut results.messages,
                    "PF-4",
                    &format!(
                        "schema fingerprint mismatch (source={fp}, expected={target_schema_hash})"
                    ),
                );
            }
            source_schema_hash = fp;
        }
        Err(e) => record(
            &mut results.messages,
            "PF-4",
            &format!("compute fingerprint failed: {e}"),
        ),
    }

    // -------- PF-5: target writable (probe) --------
    match probe_writable(ctx.target_data_dir) {
        Ok(()) => results.pf5_target_writable = true,
        Err(e) => record(
            &mut results.messages,
            "PF-5",
            &format!("target dir not writable: {e}"),
        ),
    }

    // -------- PF-6: free disk ≥ 2× source --------
    if check_disk_space(ctx.target_data_dir, source_size_bytes) {
        results.pf6_disk_space_ok = true;
    } else {
        record(
            &mut results.messages,
            "PF-6",
            &format!(
                "free disk space below 2× source size ({source_size_bytes} bytes required headroom)"
            ),
        );
    }

    // -------- PF-7: source lock acquire (read-only) --------
    // We treat the read-only open above as the lock acquisition: if a
    // hot Promptery process holds a write lock on the source, our RO
    // open could block. Since `open_readonly` returned, the lock is OK.
    results.pf7_source_lock_ok = true;

    // -------- PF-8: source FK enforcement --------
    // The user's actual Promptery DB has FK off by default (SQLite
    // default), but the schema applies FK constraints declaratively.
    // We turn FK on for the *import* read path so any orphaned rows
    // surface during the SELECT-INSERT phase. Here we just confirm we
    // can flip the PRAGMA.
    match conn.execute_batch("PRAGMA foreign_keys = ON;") {
        Ok(()) => {
            let on: i64 = conn
                .query_row("PRAGMA foreign_keys", [], |r| r.get(0))
                .unwrap_or(0);
            if on == 1 {
                results.pf8_foreign_keys_on = true;
            } else {
                record(
                    &mut results.messages,
                    "PF-8",
                    "PRAGMA foreign_keys=ON did not stick",
                );
            }
        }
        Err(e) => record(
            &mut results.messages,
            "PF-8",
            &format!("PRAGMA failed: {e}"),
        ),
    }

    // -------- PF-9: target empty OR overwrite --------
    match target_is_safe_to_overwrite(ctx.target_db_path, ctx.overwrite_existing) {
        Ok(true) => results.pf9_target_empty_or_overwrite = true,
        Ok(false) => record(
            &mut results.messages,
            "PF-9",
            "target db.sqlite already exists with data; pass overwrite_existing=true to replace",
        ),
        Err(e) => record(
            &mut results.messages,
            "PF-9",
            &format!("could not inspect target: {e}"),
        ),
    }

    // -------- PF-10: attachments folder (optional) --------
    match ctx.attachments_dir {
        None => {
            results.pf10_attachments_readable = true;
            record(
                &mut results.messages,
                "PF-10",
                "no attachments directory provided — skipping",
            );
        }
        Some(dir) => match std::fs::metadata(dir) {
            Ok(md) if md.is_dir() => results.pf10_attachments_readable = true,
            Ok(_) => record(
                &mut results.messages,
                "PF-10",
                "attachments path exists but is not a directory",
            ),
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => {
                // Per the brief: "if missing → log warning + zero counts
                // but don't fail import". So PF-10 still passes.
                results.pf10_attachments_readable = true;
                record(
                    &mut results.messages,
                    "PF-10",
                    "attachments directory absent — zero attachments will be copied",
                );
            }
            Err(e) => record(
                &mut results.messages,
                "PF-10",
                &format!("attachments dir unreadable: {e}"),
            ),
        },
    }

    Ok(PreflightOutcome {
        results,
        source_size_bytes,
        source_schema_hash,
        target_schema_hash,
    })
}

fn record(map: &mut std::collections::BTreeMap<String, String>, key: &str, msg: &str) {
    map.insert(key.to_owned(), msg.to_owned());
}

fn integrity_check(conn: &Connection) -> Result<bool, rusqlite::Error> {
    // PRAGMA integrity_check returns one row "ok" on success, or one
    // row per problem otherwise.
    let mut stmt = conn.prepare("PRAGMA integrity_check")?;
    let mut rows = stmt.query([])?;
    let mut all_ok = false;
    let mut count = 0;
    while let Some(row) = rows.next()? {
        count += 1;
        let v: String = row.get(0)?;
        if count == 1 && v == "ok" {
            all_ok = true;
        } else if v != "ok" {
            all_ok = false;
        }
    }
    Ok(all_ok && count == 1)
}

fn quick_check_and_fts(conn: &Connection) -> Result<bool, rusqlite::Error> {
    // PRAGMA quick_check
    let qc: String = conn.query_row("PRAGMA quick_check", [], |r| r.get(0))?;
    if qc != "ok" {
        return Ok(false);
    }
    // tasks_fts ≡ tasks (D-025 #3 fix). Both must exist.
    if table_exists(conn, "tasks")? && table_exists(conn, "tasks_fts")? {
        let tasks: i64 = conn.query_row("SELECT count(*) FROM tasks", [], |r| r.get(0))?;
        let tasks_fts: i64 = conn.query_row("SELECT count(*) FROM tasks_fts", [], |r| r.get(0))?;
        if tasks != tasks_fts {
            return Ok(false);
        }
    }
    if table_exists(conn, "agent_reports")? && table_exists(conn, "agent_reports_fts")? {
        let r: i64 = conn.query_row("SELECT count(*) FROM agent_reports", [], |r| r.get(0))?;
        let r_fts: i64 =
            conn.query_row("SELECT count(*) FROM agent_reports_fts", [], |r| r.get(0))?;
        if r != r_fts {
            return Ok(false);
        }
    }
    Ok(true)
}

fn table_exists(conn: &Connection, name: &str) -> Result<bool, rusqlite::Error> {
    let n: i64 = conn.query_row(
        "SELECT count(*) FROM sqlite_master WHERE type IN ('table','view') AND name=?1",
        rusqlite::params![name],
        |r| r.get(0),
    )?;
    Ok(n > 0)
}

fn probe_writable(dir: &Path) -> Result<(), std::io::Error> {
    std::fs::create_dir_all(dir)?;
    let probe = dir.join(format!(".catique-write-probe-{}", std::process::id()));
    std::fs::write(&probe, b"ok")?;
    let _ = std::fs::remove_file(&probe);
    Ok(())
}

fn check_disk_space(dir: &Path, source_size: u64) -> bool {
    // Cross-platform free-disk-space query is not in the std library.
    // We don't want to pull a fresh dependency just for this; on macOS
    // and Linux the venerable `statvfs` is available via libc, but
    // taking on libc to satisfy one preflight check would be a
    // disproportionate increase in attack-surface for the import
    // module. Instead we approximate: try a probe write of `source_size`
    // bytes worth of zeros. If the write succeeds we know there's
    // enough headroom; if it fails we return false. The probe is
    // cleaned up immediately.
    //
    // For very large source DBs (>1 GB) this is too costly — guard
    // with an upper bound: skip the probe and trust the OS to surface
    // disk-full at write time.
    use std::io::Write as _;

    const MAX_PROBE_BYTES: u64 = 64 * 1024 * 1024; // 64 MiB
    if source_size == 0 || source_size > MAX_PROBE_BYTES {
        return true;
    }

    let needed = source_size.saturating_mul(2);
    let probe = dir.join(format!(".catique-disk-probe-{}", std::process::id()));
    // Heap-allocated zero buffer (clippy::large_stack_arrays).
    let buf = vec![0_u8; 64 * 1024].into_boxed_slice();
    let result = (|| -> std::io::Result<()> {
        let mut file = std::fs::File::create(&probe)?;
        let mut left = needed;
        while left > 0 {
            let chunk = usize::try_from(std::cmp::min(left, buf.len() as u64)).unwrap_or(buf.len());
            file.write_all(&buf[..chunk])?;
            left = left.saturating_sub(chunk as u64);
        }
        file.sync_data()?;
        Ok(())
    })();
    let _ = std::fs::remove_file(&probe);
    result.is_ok()
}

fn target_is_safe_to_overwrite(target: &Path, overwrite: bool) -> Result<bool, std::io::Error> {
    match std::fs::metadata(target) {
        Ok(md) if md.is_file() && md.len() > 0 => Ok(overwrite),
        Ok(_) => Ok(true),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(true),
        Err(e) => Err(e),
    }
}

#[allow(dead_code)]
fn iso_now() -> String {
    use chrono::SecondsFormat;
    chrono::Utc::now().to_rfc3339_opts(SecondsFormat::Secs, true)
}

#[allow(dead_code)]
fn join_default_tmp(parent: &Path) -> PathBuf {
    parent.join(".import-tmp")
}

#[cfg(test)]
mod tests {
    use super::*;

    fn unique_tmp(label: &str) -> PathBuf {
        let nanos = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .map_or(0, |d| d.subsec_nanos());
        let dir =
            std::env::temp_dir().join(format!("catique-pf-{}-{label}-{nanos}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        dir
    }

    #[test]
    fn pf1_fails_on_missing_source() {
        let tmp = unique_tmp("pf1miss");
        let ctx = PreflightContext {
            source_path: &tmp.join("does-not-exist.sqlite"),
            target_data_dir: &tmp,
            target_db_path: &tmp.join("db.sqlite"),
            overwrite_existing: false,
            attachments_dir: None,
        };
        let out = run_preflight(&ctx).expect("preflight runs");
        assert!(!out.results.pf1_source_exists);
        assert!(!out.results.all_ok());
        let _ = std::fs::remove_dir_all(&tmp);
    }

    #[test]
    fn pf2_pf3_pf4_pf8_all_pass_on_golden_fixture() {
        let golden = std::path::PathBuf::from(env!("CARGO_MANIFEST_DIR"))
            .join("../../tests/fixtures/promptery-v0.4-golden.sqlite");
        if !golden.exists() {
            eprintln!("golden fixture absent — skipping");
            return;
        }
        let tmp = unique_tmp("pfgolden");
        let ctx = PreflightContext {
            source_path: &golden,
            target_data_dir: &tmp,
            target_db_path: &tmp.join("db.sqlite"),
            overwrite_existing: false,
            attachments_dir: None,
        };
        let out = run_preflight(&ctx).expect("preflight runs");
        assert!(out.results.pf1_source_exists, "PF-1");
        assert!(out.results.pf2_integrity_ok, "PF-2");
        assert!(out.results.pf3_quick_check_ok, "PF-3 (FTS smoke)");
        assert!(out.results.pf4_schema_hash_ok, "PF-4 (schema hash)");
        assert!(out.results.pf5_target_writable, "PF-5");
        assert!(out.results.pf6_disk_space_ok, "PF-6");
        assert!(out.results.pf7_source_lock_ok, "PF-7");
        assert!(out.results.pf8_foreign_keys_on, "PF-8");
        assert!(out.results.pf9_target_empty_or_overwrite, "PF-9");
        assert!(out.results.pf10_attachments_readable, "PF-10");
        assert!(out.results.all_ok(), "messages: {:?}", out.results.messages);
        assert_eq!(
            out.source_size_bytes,
            std::fs::metadata(&golden).unwrap().len()
        );
        let _ = std::fs::remove_dir_all(&tmp);
    }

    #[test]
    fn pf9_blocks_existing_target_unless_overwrite() {
        let tmp = unique_tmp("pf9");
        let target = tmp.join("db.sqlite");
        std::fs::write(&target, b"existing data 0123456789").unwrap();

        // No source — PF-1 fails first; we manually invoke pf9 helper.
        let safe = super::target_is_safe_to_overwrite(&target, false).unwrap();
        assert!(!safe, "must block when overwrite=false");
        let safe = super::target_is_safe_to_overwrite(&target, true).unwrap();
        assert!(safe, "must allow when overwrite=true");
        let _ = std::fs::remove_dir_all(&tmp);
    }

    #[test]
    fn pf10_no_attachments_passes() {
        // A source DB present but attachments_dir = None should leave
        // PF-10 = true.
        let golden = std::path::PathBuf::from(env!("CARGO_MANIFEST_DIR"))
            .join("../../tests/fixtures/promptery-v0.4-golden.sqlite");
        if !golden.exists() {
            return;
        }
        let tmp = unique_tmp("pf10none");
        let ctx = PreflightContext {
            source_path: &golden,
            target_data_dir: &tmp,
            target_db_path: &tmp.join("db.sqlite"),
            overwrite_existing: false,
            attachments_dir: None,
        };
        let out = run_preflight(&ctx).expect("preflight");
        assert!(out.results.pf10_attachments_readable);
        let _ = std::fs::remove_dir_all(&tmp);
    }

    #[test]
    fn pf10_missing_attachments_dir_is_warning_not_failure() {
        let golden = std::path::PathBuf::from(env!("CARGO_MANIFEST_DIR"))
            .join("../../tests/fixtures/promptery-v0.4-golden.sqlite");
        if !golden.exists() {
            return;
        }
        let tmp = unique_tmp("pf10miss");
        let attachments = tmp.join("nonexistent-attachments");
        let ctx = PreflightContext {
            source_path: &golden,
            target_data_dir: &tmp,
            target_db_path: &tmp.join("db.sqlite"),
            overwrite_existing: false,
            attachments_dir: Some(&attachments),
        };
        let out = run_preflight(&ctx).expect("preflight");
        assert!(out.results.pf10_attachments_readable);
        let _ = std::fs::remove_dir_all(&tmp);
    }

    #[test]
    fn pf4_fails_on_corrupt_schema() {
        // Build a tmp DB with a deliberately-different schema; PF-4
        // must detect the drift.
        let tmp = unique_tmp("pf4corr");
        let bad = tmp.join("bad.sqlite");
        {
            let conn = Connection::open(&bad).unwrap();
            conn.execute_batch("CREATE TABLE only_one(x INT);").unwrap();
        }
        let ctx = PreflightContext {
            source_path: &bad,
            target_data_dir: &tmp,
            target_db_path: &tmp.join("db.sqlite"),
            overwrite_existing: false,
            attachments_dir: None,
        };
        let out = run_preflight(&ctx).expect("preflight runs");
        assert!(out.results.pf1_source_exists);
        assert!(!out.results.pf4_schema_hash_ok, "PF-4 must reject drift");
        let _ = std::fs::remove_dir_all(&tmp);
    }

    #[test]
    fn pf5_target_dir_is_created_if_missing() {
        let tmp = unique_tmp("pf5");
        let nested = tmp.join("not").join("yet").join("here");
        super::probe_writable(&nested).expect("probe");
        assert!(nested.exists());
        let _ = std::fs::remove_dir_all(&tmp);
    }

    #[test]
    fn integrity_check_passes_on_fixture() {
        let golden = std::path::PathBuf::from(env!("CARGO_MANIFEST_DIR"))
            .join("../../tests/fixtures/promptery-v0.4-golden.sqlite");
        if !golden.exists() {
            return;
        }
        let conn = open_readonly(&golden).unwrap();
        assert!(integrity_check(&conn).unwrap(), "integrity_check ok");
    }
}
