//! Source-side snapshot helper.
//!
//! Per migration plan v0.5 §6.1 + D-029 #3: the source DB
//! `~/.promptery/db.sqlite` is **never mutated** by the import. We copy
//! it bit-for-bit into `<target_data_dir>/.import-tmp/promptery-source.sqlite`
//! before any read.
//!
//! The copy proceeds via `std::fs::copy` (single syscall, atomic at the
//! kernel level for a single file). After the copy we hash both the
//! original and the copy with SHA-256 and assert they match — catches
//! read-time corruption that `fs::copy` itself can swallow on some
//! filesystems.

use std::fs;
use std::path::{Path, PathBuf};

use sha2::{Digest, Sha256};

use super::ImportError;

/// Result of [`snapshot_source`].
#[derive(Debug, Clone)]
pub struct SnapshotOutcome {
    /// Where the copy was written.
    pub copy_path: PathBuf,
    /// Bytes copied.
    pub size_bytes: u64,
    /// SHA-256 of the source (= the copy, asserted equal).
    pub sha256: String,
}

/// Copy the source DB into the target's `.import-tmp/` directory and
/// verify byte-equality.
///
/// `tmp_dir` must already exist OR be creatable (we run
/// `create_dir_all`). The copy lands at `<tmp_dir>/promptery-source.sqlite`.
///
/// # Errors
///
/// * [`ImportError::Io`] — source unreadable, tmp dir uncreatable, copy
///   failed, or post-copy hash mismatch.
pub fn snapshot_source(source: &Path, tmp_dir: &Path) -> Result<SnapshotOutcome, ImportError> {
    fs::create_dir_all(tmp_dir)?;
    let copy_path = tmp_dir.join("promptery-source.sqlite");
    let size = fs::copy(source, &copy_path)?;
    let src_hash = hash_file(source)?;
    let dst_hash = hash_file(&copy_path)?;
    if src_hash != dst_hash {
        return Err(ImportError::Validation {
            reason: format!(
                "snapshot hash mismatch: src={src_hash} dst={dst_hash} — corrupt copy"
            ),
        });
    }
    Ok(SnapshotOutcome {
        copy_path,
        size_bytes: size,
        sha256: src_hash,
    })
}

/// Stream the file through SHA-256 in 64 KiB chunks. Avoids slurping
/// the whole file into RAM; the golden fixture is small (1.14 MB) but
/// real Promptery DBs can be 50–100 MB+ for power users.
fn hash_file(path: &Path) -> Result<String, ImportError> {
    use std::fmt::Write as _;
    use std::io::Read;
    let mut file = fs::File::open(path)?;
    let mut hasher = Sha256::new();
    // Heap-allocated buffer — clippy::large_stack_arrays nags at 64 KiB
    // on the stack; the heap allocation is once-per-hash so the cost is
    // negligible.
    let mut buf = vec![0_u8; 64 * 1024].into_boxed_slice();
    loop {
        let read = file.read(&mut buf)?;
        if read == 0 {
            break;
        }
        hasher.update(&buf[..read]);
    }
    let digest = hasher.finalize();
    let mut out = String::with_capacity(digest.len() * 2);
    for b in digest {
        let _ = write!(&mut out, "{b:02x}");
    }
    Ok(out)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn unique_tmp() -> PathBuf {
        let nanos = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .map_or(0, |d| d.subsec_nanos());
        let dir = std::env::temp_dir().join(format!(
            "catique-snapshot-{}-{nanos}",
            std::process::id()
        ));
        fs::create_dir_all(&dir).expect("tmp");
        dir
    }

    #[test]
    fn snapshot_copies_and_verifies() {
        let tmp = unique_tmp();
        let src = tmp.join("source.sqlite");
        fs::write(&src, b"hello catique snapshot").unwrap();
        let out = snapshot_source(&src, &tmp.join("import")).expect("snapshot");
        assert_eq!(out.size_bytes, 22);
        assert!(out.copy_path.exists());
        // copy contents equal source
        let copy = fs::read(&out.copy_path).unwrap();
        assert_eq!(copy, b"hello catique snapshot");
        let _ = fs::remove_dir_all(&tmp);
    }

    #[test]
    fn snapshot_creates_tmp_dir_if_missing() {
        let tmp = unique_tmp();
        let src = tmp.join("source.sqlite");
        fs::write(&src, b"x").unwrap();
        let import = tmp.join("nested").join("import-tmp");
        assert!(!import.exists());
        snapshot_source(&src, &import).expect("snapshot");
        assert!(import.exists());
        let _ = fs::remove_dir_all(&tmp);
    }
}
