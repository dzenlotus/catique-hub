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

use crate::{
    ProviderError, ResolvedMcpTool, ResolvedRole, CATIQUE_FILE_PREFIX, CATIQUE_MANAGED_KEY,
};

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

    // ADR-0008 + ADR-0005 round-21 amendment: per-tool `<mcp-tool>`
    // blocks at the end of the body so the LLM agent learns which
    // tools are reachable through the Catique HUB MCP endpoint.
    if !role.mcp_tools.is_empty() {
        out.push('\n');
        out.push_str(&render_mcp_tool_blocks(&role.mcp_tools));
    }

    out
}

/// Render every attached MCP tool as a `<mcp-tool>` block, sorted
/// alphabetically by qualified name for deterministic round-trips.
///
/// Format (per ADR-0005 round-21 amendment):
///
/// ```xml
/// <mcp-tool server="catique" name="{qualified_name}">
///   <description>{description}</description>
///   <input-schema>{input_schema_json}</input-schema>
/// </mcp-tool>
/// ```
///
/// `description` and `input_schema_json` are XML-escaped (`<`, `>`,
/// `&` substituted for entities). The JSON inside `<input-schema>`
/// is shipped verbatim — Catique's `tools/list` already validates it
/// as JSON before persisting; the renderer is the wrong place to
/// re-parse.
///
/// Returns an empty string when the slice is empty (the caller is
/// expected to skip the leading newline in that case).
pub(crate) fn render_mcp_tool_blocks(tools: &[ResolvedMcpTool]) -> String {
    use std::fmt::Write as _;

    if tools.is_empty() {
        return String::new();
    }
    // Stable alphabetical order by qualified name — protects the
    // diff-friendliness invariant ADR-0005 §3 calls out for the
    // overall file shape.
    let mut sorted: Vec<&ResolvedMcpTool> = tools.iter().collect();
    sorted.sort_by(|a, b| a.qualified_name.cmp(&b.qualified_name));

    let mut out = String::new();
    for tool in sorted {
        let name = xml_escape_attr(&tool.qualified_name);
        let _ = writeln!(out, "<mcp-tool server=\"catique\" name=\"{name}\">");
        let description = tool.description.as_deref().unwrap_or("");
        let _ = writeln!(
            out,
            "  <description>{}</description>",
            xml_escape_text(description)
        );
        let _ = writeln!(
            out,
            "  <input-schema>{}</input-schema>",
            xml_escape_text(&tool.input_schema_json)
        );
        out.push_str("</mcp-tool>\n");
    }
    out
}

/// XML-escape character data: `<`, `>`, `&` only. Quotes and
/// apostrophes are safe in element content per XML 1.0 §2.4 and we
/// deliberately keep them verbatim so the embedded JSON does not get
/// pretty-printed twice.
pub(crate) fn xml_escape_text(s: &str) -> String {
    let mut out = String::with_capacity(s.len());
    for c in s.chars() {
        match c {
            '<' => out.push_str("&lt;"),
            '>' => out.push_str("&gt;"),
            '&' => out.push_str("&amp;"),
            other => out.push(other),
        }
    }
    out
}

/// XML-escape an attribute value (`<`, `>`, `&`, `"`). We pick the
/// double-quote attribute style for `name=` / `server=` so the only
/// extra delimiter to escape is `"`.
pub(crate) fn xml_escape_attr(s: &str) -> String {
    let mut out = String::with_capacity(s.len());
    for c in s.chars() {
        match c {
            '<' => out.push_str("&lt;"),
            '>' => out.push_str("&gt;"),
            '&' => out.push_str("&amp;"),
            '"' => out.push_str("&quot;"),
            other => out.push(other),
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
            mcp_tools: vec![],
        };
        let body = render_md_agent(&role, 1_700_000_000_000);
        assert!(body.contains("catique_managed: true"));
        assert!(body.contains("catique_role_slug: reviewer"));
        assert!(body.contains("name: \"Code Reviewer\""));
        assert!(body.contains("Review code carefully."));
        // No tools attached → no `<mcp-tool>` blocks rendered.
        assert!(!body.contains("<mcp-tool"));
    }

    #[test]
    fn xml_escape_text_handles_lt_gt_amp() {
        assert_eq!(xml_escape_text("a<b>c&d"), "a&lt;b&gt;c&amp;d");
        // Quotes are NOT escaped inside character data (XML 1.0 §2.4)
        // so embedded JSON stays readable.
        assert_eq!(xml_escape_text(r#""hello""#), r#""hello""#);
        assert_eq!(xml_escape_text(""), "");
    }

    #[test]
    fn xml_escape_attr_also_escapes_double_quote() {
        assert_eq!(xml_escape_attr(r#"a"b"#), "a&quot;b");
        assert_eq!(xml_escape_attr("a<>&"), "a&lt;&gt;&amp;");
    }

    #[test]
    fn render_mcp_tool_blocks_empty_returns_empty_string() {
        assert_eq!(render_mcp_tool_blocks(&[]), "");
    }

    #[test]
    fn render_mcp_tool_blocks_sorts_alphabetically_by_qualified_name() {
        let tools = vec![
            ResolvedMcpTool {
                qualified_name: "github.search".into(),
                description: Some("Search GitHub".into()),
                input_schema_json: r#"{"type":"object"}"#.into(),
            },
            ResolvedMcpTool {
                qualified_name: "atlassian.create_issue".into(),
                description: None,
                input_schema_json: "{}".into(),
            },
            ResolvedMcpTool {
                qualified_name: "legacy_search".into(),
                description: Some("Old <legacy> tool".into()),
                input_schema_json: r#"{"x":"y & z"}"#.into(),
            },
        ];
        let out = render_mcp_tool_blocks(&tools);

        // Ordering: atlassian.create_issue, github.search, legacy_search.
        let i_atlassian = out.find("atlassian.create_issue").unwrap();
        let i_github = out.find("github.search").unwrap();
        let i_legacy = out.find("legacy_search").unwrap();
        assert!(i_atlassian < i_github);
        assert!(i_github < i_legacy);

        // XML escaping inside description + schema.
        assert!(out.contains("Old &lt;legacy&gt; tool"));
        assert!(out.contains("y &amp; z"));

        // server="catique" attribute on every block.
        assert_eq!(out.matches(r#"server="catique""#).count(), 3);

        // One opening + one closing tag per tool.
        assert_eq!(out.matches("<mcp-tool ").count(), 3);
        assert_eq!(out.matches("</mcp-tool>").count(), 3);
    }

    #[test]
    fn render_md_agent_appends_mcp_tool_blocks() {
        let role = ResolvedRole {
            id: "r-1".into(),
            slug: "reviewer".into(),
            name: "Code Reviewer".into(),
            content: "Review code carefully.".into(),
            prompts: vec![],
            mcp_tools: vec![ResolvedMcpTool {
                qualified_name: "github.search".into(),
                description: Some("Search code".into()),
                input_schema_json: r#"{"type":"object"}"#.into(),
            }],
        };
        let body = render_md_agent(&role, 0);
        assert!(body.contains(r#"<mcp-tool server="catique" name="github.search">"#));
        assert!(body.contains("<description>Search code</description>"));
        assert!(body.contains(r#"<input-schema>{"type":"object"}</input-schema>"#));
    }
}
