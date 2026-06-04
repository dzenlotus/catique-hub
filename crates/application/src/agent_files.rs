//! Agent-file synthesiser — catique-1.
//!
//! Writes an idempotent section into a project's `AGENTS.md` /
//! `CLAUDE.md` file when the user binds a Catique HUB space to a
//! project folder. The marker pair lets the writer find and replace
//! the previously-written block without disturbing any other content
//! in the file (hand-edited notes, instructions for other tools, …).
//!
//! ## Marker format
//!
//! ```text
//! <!-- catique-hub:owner:begin -->
//! …body…
//! <!-- catique-hub:owner:end -->
//! ```
//!
//! Both marker lines are HTML comments so they render invisibly in
//! every Markdown previewer we know about. The body between them is
//! always overwritten; anything outside is preserved verbatim.
//!
//! ## Atomicity
//!
//! Writes are atomic-by-tempfile: contents land in a sibling
//! `<file>.catique-tmp`, then `rename` swaps it into place. A crash
//! between write + rename leaves the previous file intact.

use std::fs;
use std::io::Write;
use std::path::{Path, PathBuf};

/// HTML-comment markers that bracket the catique-hub-managed `owner`
/// section. Kept as constants for back-compat with early callers;
/// the generic [`upsert_keyed_section`] / [`remove_keyed_section`]
/// helpers let new callers carve out their own sections by `key`.
pub const BEGIN_MARKER: &str = "<!-- catique-hub:owner:begin -->";
pub const END_MARKER: &str = "<!-- catique-hub:owner:end -->";

/// Build a marker pair for an arbitrary `key`. Keys are kebab-case
/// short identifiers (`owner`, `workflow`, `notes`, …). The writer
/// trusts the caller — invalid characters are passed through as-is.
#[must_use]
pub fn markers_for(key: &str) -> (String, String) {
    (
        format!("<!-- catique-hub:{key}:begin -->"),
        format!("<!-- catique-hub:{key}:end -->"),
    )
}

/// Failure cases for the writer. Kept small + concrete so the IPC
/// layer can render a sensible message rather than passing raw IO.
#[derive(Debug, thiserror::Error)]
pub enum AgentFileError {
    #[error("project folder path is empty")]
    EmptyPath,
    #[error("filesystem error: {0}")]
    Io(#[from] std::io::Error),
}

/// Replace (or insert) the catique-hub-managed section in the file
/// at `target_path`. The file is created if missing.
///
/// The new section body is `body`, exactly as supplied — the writer
/// adds the marker lines and a trailing blank line, nothing else.
///
/// # Errors
///
/// Returns [`AgentFileError::Io`] on filesystem failures and
/// [`AgentFileError::EmptyPath`] when `target_path` has no parent
/// directory (which would make the temp-file dance impossible).
pub fn upsert_section(target_path: &Path, body: &str) -> Result<(), AgentFileError> {
    upsert_keyed_section(target_path, "owner", body)
}

/// Generic version of [`upsert_section`] keyed by `section_key`. Same
/// idempotency / atomicity guarantees; each `key` carves out an
/// independent block that can be re-rendered without touching the
/// others. Used by catique-5 (`workflow`) so the owner block + the
/// workflow block coexist in one file.
///
/// # Errors
///
/// Same as [`upsert_section`].
pub fn upsert_keyed_section(
    target_path: &Path,
    section_key: &str,
    body: &str,
) -> Result<(), AgentFileError> {
    let Some(parent) = target_path.parent() else {
        return Err(AgentFileError::EmptyPath);
    };
    fs::create_dir_all(parent)?;

    let existing = match fs::read_to_string(target_path) {
        Ok(s) => s,
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => String::new(),
        Err(e) => return Err(AgentFileError::Io(e)),
    };

    let (begin, end) = markers_for(section_key);
    let new_body = render_section_with(&begin, &end, body);
    let updated = replace_section_with(&existing, &begin, &end, &new_body);
    atomic_write(target_path, &updated)
}

/// Strip the catique-hub-managed section out of `target_path`. No-op
/// when the file or the section is missing. Useful when the user
/// unlinks a space from its project folder.
///
/// # Errors
///
/// Filesystem failures other than NotFound surface as [`AgentFileError::Io`].
pub fn remove_section(target_path: &Path) -> Result<(), AgentFileError> {
    remove_keyed_section(target_path, "owner")
}

/// Generic version of [`remove_section`] keyed by `section_key`.
///
/// # Errors
///
/// Same as [`remove_section`].
pub fn remove_keyed_section(target_path: &Path, section_key: &str) -> Result<(), AgentFileError> {
    let existing = match fs::read_to_string(target_path) {
        Ok(s) => s,
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => return Ok(()),
        Err(e) => return Err(AgentFileError::Io(e)),
    };
    let (begin, end) = markers_for(section_key);
    let updated = strip_section_with(&existing, &begin, &end);
    if updated == existing {
        return Ok(());
    }
    atomic_write(target_path, &updated)
}

/// Resolve the agent-file path for a project folder. Preference order:
///   1. `AGENTS.md` if it already exists (Claude Code convention).
///   2. `CLAUDE.md` if it already exists (legacy fallback).
///   3. `AGENTS.md` as the default for fresh projects.
#[must_use]
pub fn resolve_agent_file(project_folder: &Path) -> PathBuf {
    let agents = project_folder.join("AGENTS.md");
    if agents.exists() {
        return agents;
    }
    let claude = project_folder.join("CLAUDE.md");
    if claude.exists() {
        return claude;
    }
    agents
}

// ---------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------

fn render_section_with(begin: &str, end: &str, body: &str) -> String {
    let body_trimmed = body.trim_end_matches('\n');
    format!("{begin}\n{body_trimmed}\n{end}\n")
}

fn replace_section_with(existing: &str, begin: &str, end: &str, new_section: &str) -> String {
    if let Some((start, stop)) = find_section_range_with(existing, begin, end) {
        let mut out = String::with_capacity(existing.len() + new_section.len());
        out.push_str(&existing[..start]);
        out.push_str(new_section);
        out.push_str(&existing[stop..]);
        out
    } else {
        // No existing section — append. Leave a blank line between
        // prior content and the section so the .md stays readable.
        let mut out = existing.to_owned();
        if !out.is_empty() && !out.ends_with("\n\n") {
            if !out.ends_with('\n') {
                out.push('\n');
            }
            out.push('\n');
        }
        out.push_str(new_section);
        out
    }
}

fn strip_section_with(existing: &str, begin: &str, end: &str) -> String {
    match find_section_range_with(existing, begin, end) {
        Some((start, stop)) => {
            let mut out = String::with_capacity(existing.len());
            out.push_str(&existing[..start]);
            out.push_str(&existing[stop..]);
            collapse_blank_runs(&out)
        }
        None => existing.to_owned(),
    }
}

fn find_section_range_with(existing: &str, begin: &str, end: &str) -> Option<(usize, usize)> {
    let start = existing.find(begin)?;
    let after_begin = start + begin.len();
    let end_rel = existing[after_begin..].find(end)?;
    let stop = after_begin + end_rel + end.len();
    let stop = if existing.as_bytes().get(stop) == Some(&b'\n') {
        stop + 1
    } else {
        stop
    };
    Some((start, stop))
}

fn collapse_blank_runs(s: &str) -> String {
    let mut out = String::with_capacity(s.len());
    let mut prev_blank = false;
    for line in s.split_inclusive('\n') {
        let is_blank = line.trim().is_empty();
        if is_blank && prev_blank {
            continue;
        }
        out.push_str(line);
        prev_blank = is_blank;
    }
    out
}

fn atomic_write(target: &Path, contents: &str) -> Result<(), AgentFileError> {
    let Some(parent) = target.parent() else {
        return Err(AgentFileError::EmptyPath);
    };
    let file_name = target
        .file_name()
        .ok_or(AgentFileError::EmptyPath)?
        .to_string_lossy()
        .to_string();
    let tmp = parent.join(format!(".{file_name}.catique-tmp"));
    {
        let mut f = fs::File::create(&tmp)?;
        f.write_all(contents.as_bytes())?;
        f.sync_all()?;
    }
    fs::rename(&tmp, target)?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::TempDir;

    fn td() -> TempDir {
        TempDir::new().expect("tempdir")
    }

    #[test]
    fn insert_into_empty_file() {
        let tmp = td();
        let path = tmp.path().join("AGENTS.md");
        upsert_section(&path, "owner body").expect("upsert");
        let contents = fs::read_to_string(&path).unwrap();
        assert!(contents.contains(BEGIN_MARKER));
        assert!(contents.contains("owner body"));
        assert!(contents.contains(END_MARKER));
    }

    #[test]
    fn upsert_is_idempotent() {
        let tmp = td();
        let path = tmp.path().join("AGENTS.md");
        upsert_section(&path, "owner v1").unwrap();
        upsert_section(&path, "owner v1").unwrap();
        let contents = fs::read_to_string(&path).unwrap();
        // exactly one begin and one end marker
        assert_eq!(contents.matches(BEGIN_MARKER).count(), 1);
        assert_eq!(contents.matches(END_MARKER).count(), 1);
    }

    #[test]
    fn upsert_replaces_body_preserving_outside() {
        let tmp = td();
        let path = tmp.path().join("AGENTS.md");
        fs::write(
            &path,
            "# Project notes\n\nManual preamble.\n\n<!-- catique-hub:owner:begin -->\nold body\n<!-- catique-hub:owner:end -->\n\n## After\nKeep me.\n",
        )
        .unwrap();
        upsert_section(&path, "new body").unwrap();
        let contents = fs::read_to_string(&path).unwrap();
        assert!(contents.contains("Manual preamble"));
        assert!(contents.contains("## After"));
        assert!(contents.contains("Keep me"));
        assert!(contents.contains("new body"));
        assert!(!contents.contains("old body"));
    }

    #[test]
    fn remove_section_keeps_outside() {
        let tmp = td();
        let path = tmp.path().join("AGENTS.md");
        fs::write(
            &path,
            "# Notes\n\n<!-- catique-hub:owner:begin -->\nbody\n<!-- catique-hub:owner:end -->\n\nTail.\n",
        )
        .unwrap();
        remove_section(&path).unwrap();
        let contents = fs::read_to_string(&path).unwrap();
        assert!(!contents.contains(BEGIN_MARKER));
        assert!(!contents.contains(END_MARKER));
        assert!(contents.contains("# Notes"));
        assert!(contents.contains("Tail."));
    }

    #[test]
    fn remove_section_on_missing_file_is_noop() {
        let tmp = td();
        let path = tmp.path().join("AGENTS.md");
        remove_section(&path).unwrap();
        assert!(!path.exists());
    }

    #[test]
    fn resolve_picks_agents_then_claude_then_agents() {
        let tmp = td();
        // 1. neither exists → AGENTS.md
        assert_eq!(
            resolve_agent_file(tmp.path()).file_name().unwrap(),
            "AGENTS.md"
        );
        // 2. only CLAUDE.md exists → CLAUDE.md
        fs::write(tmp.path().join("CLAUDE.md"), "x").unwrap();
        assert_eq!(
            resolve_agent_file(tmp.path()).file_name().unwrap(),
            "CLAUDE.md"
        );
        // 3. AGENTS.md also exists → AGENTS.md wins
        fs::write(tmp.path().join("AGENTS.md"), "x").unwrap();
        assert_eq!(
            resolve_agent_file(tmp.path()).file_name().unwrap(),
            "AGENTS.md"
        );
    }
}
