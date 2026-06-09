//! Project-file filesystem helpers (catique-2, disk-backed rewrite).
//!
//! Plain CRUD over markdown files in a project's root folder. The
//! application layer (`application::project_files`) owns the policy:
//! resolving a space's `project_folder_path`, validating filenames, and
//! merging the on-disk listing with the connected providers' expected
//! filenames. This module only touches the filesystem.
//!
//! Writes are atomic (`<name>.<rand>.tmp` + rename) so a concurrent
//! agent reading the file observes either the old or new content, never a
//! torn write.

use std::fs;
use std::io;
use std::path::{Component, Path, PathBuf};
use std::time::{SystemTime, UNIX_EPOCH};

/// One markdown file read from a project folder.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ProjectFileEntry {
    /// Single-segment filename (e.g. `AGENTS.md`).
    pub name: String,
    /// On-disk content, or empty string when the file does not exist.
    pub content: String,
    /// `true` when the file currently exists.
    pub exists: bool,
    /// mtime in epoch millis, `0` when the file does not exist.
    pub updated_at: i64,
}

/// Reject anything that is not a single, safe path segment — no
/// separators, no `..`, no absolute roots. Keeps writes confined to the
/// project folder.
fn is_safe_name(name: &str) -> bool {
    if name.is_empty() {
        return false;
    }
    let p = Path::new(name);
    let mut comps = p.components();
    matches!(
        (comps.next(), comps.next()),
        (Some(Component::Normal(_)), None)
    )
}

fn unsafe_name_err(name: &str) -> io::Error {
    io::Error::new(
        io::ErrorKind::InvalidInput,
        format!("unsafe project-file name: {name}"),
    )
}

fn mtime_millis(meta: &fs::Metadata) -> i64 {
    meta.modified()
        .ok()
        .and_then(|t| t.duration_since(UNIX_EPOCH).ok())
        .and_then(|d| i64::try_from(d.as_millis()).ok())
        .unwrap_or(0)
}

/// List root-level `*.md` filenames in `base`, sorted. Returns an empty
/// vec when `base` does not exist or is not a directory.
///
/// # Errors
///
/// Surfaces unexpected IO errors (permission denied, etc.). A missing
/// directory is NOT an error — it yields an empty list.
pub fn list_markdown(base: &Path) -> io::Result<Vec<String>> {
    let entries = match fs::read_dir(base) {
        Ok(rd) => rd,
        Err(e) if e.kind() == io::ErrorKind::NotFound => return Ok(Vec::new()),
        Err(e) => return Err(e),
    };
    let mut out = Vec::new();
    for entry in entries {
        let entry = entry?;
        if !entry.file_type()?.is_file() {
            continue;
        }
        let name = entry.file_name().to_string_lossy().into_owned();
        if name.to_ascii_lowercase().ends_with(".md") {
            out.push(name);
        }
    }
    out.sort();
    Ok(out)
}

/// Read one file. Returns an entry with `exists = false` and empty
/// content when the file is absent.
///
/// # Errors
///
/// [`io::ErrorKind::InvalidInput`] for an unsafe name; other IO errors
/// surface unchanged.
pub fn read(base: &Path, name: &str) -> io::Result<ProjectFileEntry> {
    if !is_safe_name(name) {
        return Err(unsafe_name_err(name));
    }
    let path = base.join(name);
    match fs::metadata(&path) {
        Ok(meta) if meta.is_file() => {
            let content = fs::read_to_string(&path)?;
            Ok(ProjectFileEntry {
                name: name.to_owned(),
                content,
                exists: true,
                updated_at: mtime_millis(&meta),
            })
        }
        Ok(_) | Err(_) => Ok(ProjectFileEntry {
            name: name.to_owned(),
            content: String::new(),
            exists: false,
            updated_at: 0,
        }),
    }
}

/// Write one file atomically (tmp + rename). Creates the file when
/// absent; overwrites otherwise. The base folder must already exist.
///
/// # Errors
///
/// [`io::ErrorKind::InvalidInput`] for an unsafe name;
/// [`io::ErrorKind::NotFound`] when `base` does not exist; other IO
/// errors surface unchanged.
pub fn write(base: &Path, name: &str, content: &str) -> io::Result<ProjectFileEntry> {
    if !is_safe_name(name) {
        return Err(unsafe_name_err(name));
    }
    if !base.is_dir() {
        return Err(io::Error::new(
            io::ErrorKind::NotFound,
            format!("project folder does not exist: {}", base.display()),
        ));
    }
    let final_path = base.join(name);
    let tmp_path = tmp_sibling(&final_path);
    fs::write(&tmp_path, content)?;
    // rename is atomic on the same filesystem; clean up the tmp on
    // failure so a botched write doesn't litter the folder.
    if let Err(e) = fs::rename(&tmp_path, &final_path) {
        let _ = fs::remove_file(&tmp_path);
        return Err(e);
    }
    let updated_at = fs::metadata(&final_path)
        .as_ref()
        .map(mtime_millis)
        .unwrap_or(0);
    Ok(ProjectFileEntry {
        name: name.to_owned(),
        content: content.to_owned(),
        exists: true,
        updated_at,
    })
}

/// Delete one file. Returns `true` when a file was removed, `false` when
/// it was already absent.
///
/// # Errors
///
/// [`io::ErrorKind::InvalidInput`] for an unsafe name; other IO errors
/// surface unchanged.
pub fn delete(base: &Path, name: &str) -> io::Result<bool> {
    if !is_safe_name(name) {
        return Err(unsafe_name_err(name));
    }
    match fs::remove_file(base.join(name)) {
        Ok(()) => Ok(true),
        Err(e) if e.kind() == io::ErrorKind::NotFound => Ok(false),
        Err(e) => Err(e),
    }
}

/// Build a temp sibling path next to `final_path`. Uses a nanosecond
/// timestamp so concurrent writers don't collide on the tmp name.
fn tmp_sibling(final_path: &Path) -> PathBuf {
    let nanos = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_nanos())
        .unwrap_or(0);
    let file_name = final_path
        .file_name()
        .map_or_else(|| "tmp".to_owned(), |n| n.to_string_lossy().into_owned());
    final_path.with_file_name(format!(".{file_name}.{nanos}.tmp"))
}

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::TempDir;

    #[test]
    fn write_read_roundtrip() {
        let dir = TempDir::new().unwrap();
        let written = write(dir.path(), "AGENTS.md", "# hi").unwrap();
        assert!(written.exists);
        let read_back = read(dir.path(), "AGENTS.md").unwrap();
        assert_eq!(read_back.content, "# hi");
        assert!(read_back.exists);
    }

    #[test]
    fn read_missing_returns_not_exists() {
        let dir = TempDir::new().unwrap();
        let entry = read(dir.path(), "CLAUDE.md").unwrap();
        assert!(!entry.exists);
        assert_eq!(entry.content, "");
    }

    #[test]
    fn list_markdown_filters_and_sorts() {
        let dir = TempDir::new().unwrap();
        write(dir.path(), "b.md", "").unwrap();
        write(dir.path(), "a.md", "").unwrap();
        fs::write(dir.path().join("notes.txt"), "x").unwrap();
        assert_eq!(list_markdown(dir.path()).unwrap(), vec!["a.md", "b.md"]);
    }

    #[test]
    fn delete_reports_presence() {
        let dir = TempDir::new().unwrap();
        write(dir.path(), "X.md", "y").unwrap();
        assert!(delete(dir.path(), "X.md").unwrap());
        assert!(!delete(dir.path(), "X.md").unwrap());
    }

    #[test]
    fn unsafe_names_rejected() {
        let dir = TempDir::new().unwrap();
        assert!(read(dir.path(), "../escape.md").is_err());
        assert!(write(dir.path(), "sub/dir.md", "x").is_err());
        assert!(delete(dir.path(), "/abs.md").is_err());
    }

    #[test]
    fn write_to_missing_folder_errors() {
        let dir = TempDir::new().unwrap();
        let missing = dir.path().join("nope");
        assert_eq!(
            write(&missing, "A.md", "x").unwrap_err().kind(),
            io::ErrorKind::NotFound
        );
    }
}
