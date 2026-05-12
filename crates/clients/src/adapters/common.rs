//! Shared helpers used by every provider implementation.
//!
//! Three concerns live here:
//!
//! 1. Atomic file writes (tmp+rename), expressed once so providers
//!    don't drift on the temp-name convention.
//! 2. YAML frontmatter rendering for the markdown agent-file flavour
//!    (Claude Code + OpenCode). Codex Skills get their own renderer
//!    in [`super::codex`] because the Skills spec uses different
//!    frontmatter keys.
//! 3. Frontmatter detection — deciding whether a `catique-*` file on
//!    disk is genuinely catique-managed (carries `catique_managed:
//!    true`) before we delete or overwrite it.
//!
//! Everything in here is `pub(crate)` — no public surface.

use std::path::Path;

use tokio::io::AsyncWriteExt;

use crate::{ProviderError, ResolvedRole, CATIQUE_FILE_PREFIX, CATIQUE_MANAGED_KEY};

/// Resolve the user's home directory or surface a typed error.
pub(crate) fn home_dir() -> Result<std::path::PathBuf, ProviderError> {
    dirs::home_dir().ok_or(ProviderError::HomeDirUnavailable)
}

/// Atomically write `bytes` to `target`. Creates the parent directory
/// if missing. The temp file lives next to `target` to keep the rename
/// on the same filesystem (POSIX guarantees an atomic same-FS rename).
pub(crate) async fn atomic_write(target: &Path, bytes: &[u8]) -> Result<(), ProviderError> {
    if let Some(parent) = target.parent() {
        tokio::fs::create_dir_all(parent).await?;
    }
    // Distinct temp-name per call so two concurrent syncs (shouldn't
    // happen — orchestrator coalesces — but defence in depth) don't
    // race on the same scratch path.
    let pid = std::process::id();
    let nonce: u128 = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_nanos())
        .unwrap_or(0);
    let tmp = target.with_file_name(format!(
        "{}.catique-{pid}-{nonce}.tmp",
        target
            .file_name()
            .and_then(|n| n.to_str())
            .unwrap_or("scratch"),
    ));
    {
        let mut f = tokio::fs::File::create(&tmp).await?;
        f.write_all(bytes).await?;
        f.flush().await?;
        f.sync_all().await?;
    }
    // tokio::fs::rename is platform-correct: same-FS atomic on POSIX,
    // ReplaceFileW-equivalent on Windows.
    if let Err(e) = tokio::fs::rename(&tmp, target).await {
        // Best-effort cleanup of the dangling tmp.
        let _ = tokio::fs::remove_file(&tmp).await;
        return Err(ProviderError::Io(e));
    }
    Ok(())
}

/// Render a Catique role to a markdown body with YAML frontmatter.
///
/// Used by Claude Code (`~/.claude/agents/`) and OpenCode
/// (`~/.config/opencode/agents/`). Codex Skills override this in
/// [`super::codex`] because the Skills spec uses a different schema.
///
/// The frontmatter intentionally keeps the *catique*-marker key
/// (`catique_managed: true`) plus the user-friendly `name` /
/// `description` fields the providers themselves expect (`name` is the
/// agent display name; `description` carries a short summary the
/// provider may surface in pickers).
pub(crate) fn render_md_agent(role: &ResolvedRole, now_ms: i64) -> String {
    use std::fmt::Write as _;
    let mut out = String::new();
    out.push_str("---\n");
    // YAML-safe quoting: escape backslashes + double-quotes only — no
    // newlines reach this path because role names are single-line.
    let safe_name = yaml_double_quote(&role.name);
    let _ = writeln!(out, "name: {safe_name}");
    // The `description` slot mirrors the role's first non-empty line of
    // content as a short summary. Empty body → empty description.
    let description = role
        .content
        .lines()
        .find(|l| !l.trim().is_empty())
        .unwrap_or("");
    let safe_desc = yaml_double_quote(description);
    let _ = writeln!(out, "description: {safe_desc}");
    let _ = writeln!(out, "{CATIQUE_MANAGED_KEY}: true");
    let _ = writeln!(out, "catique_role_id: {}", role.id);
    let _ = writeln!(out, "catique_role_slug: {}", role.slug);
    let _ = writeln!(out, "catique_synced_at: {now_ms}");
    out.push_str("---\n");

    if !role.content.is_empty() {
        out.push('\n');
        out.push_str(&role.content);
        if !role.content.ends_with('\n') {
            out.push('\n');
        }
    }

    for prompt in &role.prompts {
        out.push_str("\n## ");
        out.push_str(&prompt.name);
        out.push_str("\n\n");
        out.push_str(&prompt.content);
        if !prompt.content.ends_with('\n') {
            out.push('\n');
        }
    }

    out
}

/// YAML double-quoted-flow scalar. We deliberately don't try to be
/// clever about plain-style strings — quoting is always safe and the
/// 4-byte overhead per role-name is irrelevant to the on-disk size.
pub(crate) fn yaml_double_quote(s: &str) -> String {
    let mut out = String::with_capacity(s.len() + 2);
    out.push('"');
    for c in s.chars() {
        match c {
            '"' => out.push_str("\\\""),
            '\\' => out.push_str("\\\\"),
            '\n' => out.push_str("\\n"),
            '\r' => out.push_str("\\r"),
            '\t' => out.push_str("\\t"),
            other => out.push(other),
        }
    }
    out.push('"');
    out
}

/// `true` when `content`'s YAML frontmatter contains `catique_managed:
/// true`. Used by the agent-file scan to decide whether a `catique-*`
/// file on disk is genuinely catique-owned (defence in depth).
pub(crate) fn is_catique_managed(content: &str) -> bool {
    let mut lines = content.lines();
    if lines.next().map(str::trim) != Some("---") {
        return false;
    }
    for line in lines {
        let trimmed = line.trim();
        if trimmed == "---" {
            break;
        }
        if let Some(rest) = trimmed.strip_prefix(CATIQUE_MANAGED_KEY) {
            // Accept `key: true` and `key:true`, tolerate trailing
            // whitespace + comments.
            let after = rest.trim_start_matches(':').trim();
            // Stop at the first whitespace / `#` so e.g. `true # …` works.
            let value: &str = after
                .split(|c: char| c.is_whitespace() || c == '#')
                .next()
                .unwrap_or("");
            return value.eq_ignore_ascii_case("true");
        }
    }
    false
}

/// Validate that a filename in the agents directory carries the
/// catique-managed prefix. Used as the cheap first-stage filter before
/// reading the file body.
pub(crate) fn has_catique_prefix(filename: &str) -> bool {
    filename.starts_with(CATIQUE_FILE_PREFIX)
}

/// Wall-clock now as Unix ms. Used for the `catique_synced_at`
/// frontmatter slot so out-of-band tools can tell when the file was
/// last refreshed.
pub(crate) fn now_unix_ms() -> i64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| i64::try_from(d.as_millis()).unwrap_or(i64::MAX))
        .unwrap_or(0)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn yaml_quote_escapes_double_quote() {
        assert_eq!(yaml_double_quote("hello"), "\"hello\"");
        assert_eq!(yaml_double_quote("a\"b"), "\"a\\\"b\"");
        assert_eq!(yaml_double_quote("a\\b"), "\"a\\\\b\"");
    }

    #[test]
    fn detects_catique_marker_with_various_spacings() {
        assert!(is_catique_managed("---\ncatique_managed: true\n---\nbody"));
        assert!(is_catique_managed("---\ncatique_managed:true\n---\nbody"));
        assert!(is_catique_managed(
            "---\ncatique_managed:   true # synced\n---\nbody"
        ));
    }

    #[test]
    fn rejects_missing_marker_or_false_value() {
        assert!(!is_catique_managed("---\nname: foo\n---\nbody"));
        assert!(!is_catique_managed(
            "---\ncatique_managed: false\n---\nbody"
        ));
        assert!(!is_catique_managed("no frontmatter at all"));
    }

    #[tokio::test]
    async fn atomic_write_creates_parent_and_writes() {
        let tmp = tempfile::TempDir::new().unwrap();
        let path = tmp.path().join("a").join("b").join("c.txt");
        atomic_write(&path, b"hello").await.unwrap();
        assert_eq!(tokio::fs::read_to_string(&path).await.unwrap(), "hello");
    }

    #[tokio::test]
    async fn atomic_write_overwrites_existing_file() {
        let tmp = tempfile::TempDir::new().unwrap();
        let path = tmp.path().join("c.txt");
        atomic_write(&path, b"first").await.unwrap();
        atomic_write(&path, b"second").await.unwrap();
        assert_eq!(tokio::fs::read_to_string(&path).await.unwrap(), "second");
    }

    #[test]
    fn render_md_agent_carries_marker() {
        let role = ResolvedRole {
            id: "r-1".into(),
            slug: "reviewer".into(),
            name: "Code Reviewer".into(),
            content: "Review code carefully.".into(),
            prompts: vec![],
        };
        let body = render_md_agent(&role, 1_700_000_000_000);
        assert!(body.contains("catique_managed: true"));
        assert!(body.contains("catique_role_slug: reviewer"));
        assert!(body.contains("name: \"Code Reviewer\""));
        assert!(body.contains("Review code carefully."));
    }
}
