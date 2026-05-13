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
    ProviderError, ResolvedMcpTool, ResolvedRole, ResolvedSkill, ResolvedSkillAttachment,
    ResolvedSkillAttachmentKind, ResolvedSkillStep, CATIQUE_FILE_PREFIX, CATIQUE_MANAGED_KEY,
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

    // ctq-137 / MEM-S1: `## Memory` paragraph documenting the
    // per-role retrospective store. Slot AFTER the role body /
    // prompts, BEFORE the `<mcp-tool>` and `<skill>` XML blocks.
    // Stable position so file diffs stay readable across syncs. The
    // `<this-role-id>` placeholder is templated at render time from
    // `role.id` so the agent does not have to guess its own id.
    out.push('\n');
    out.push_str(&render_memory_paragraph(&role.id));

    // ADR-0008 + ADR-0005 round-21 amendment: per-tool `<mcp-tool>`
    // blocks at the end of the body so the LLM agent learns which
    // tools are reachable through the Catique HUB MCP endpoint.
    if !role.mcp_tools.is_empty() {
        out.push('\n');
        out.push_str(&render_mcp_tool_blocks(&role.mcp_tools));
    }

    // SKILL-S11: per-skill `<skill>` blocks rendered after the
    // `<mcp-tool>` section. Stable position so file diffs stay readable
    // across syncs; alphabetical ordering by skill name handled inside
    // the renderer.
    if !role.skills.is_empty() {
        out.push('\n');
        out.push_str(&render_skill_blocks(&role.skills));
    }

    out
}

/// Render the ctq-137 / MEM-S1 `## Memory` paragraph injected between
/// the role's prompts and the `<mcp-tool>` / `<skill>` XML blocks.
///
/// The placeholder for the agent's own role id is substituted from
/// `role_id` so the tool calls are self-contained — the agent does
/// not have to look its id up.
pub(crate) fn render_memory_paragraph(role_id: &str) -> String {
    // Triple-newline framing keeps the section visually distinct in the
    // raw markdown without leaning on heading-level conventions the
    // role body might already use.
    format!(
        "## Memory\n\
\n\
You have a personal retrospective memory store scoped to this role.\n\
Use these tools to consult and write to it:\n\
\n\
- `list_role_tags(role_id=\"{role_id}\")` — see what tags this role already has. \
Prefer reusing existing tags over inventing new ones.\n\
- `recall_role_notes(role_id=\"{role_id}\", tags=[...])` — load past notes by tag \
overlap BEFORE starting work.\n\
- `add_role_note(role_id=\"{role_id}\", body=..., tags=[...])` — write a retrospective \
AFTER the user rates the task. Cover: what was done, what failed, what went well, \
what went badly, what to do differently next time. Tags should be drawn from \
`list_role_tags` first; only invent new tags when no existing one fits.\n\
\n\
Pinned notes always load; the user curates priority and removes obsolete entries.\n\
",
    )
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

/// Render every attached skill as a `<skill>` block (SKILL-S11), sorted
/// alphabetically by `name` for deterministic round-trips. Per-skill
/// attachments are sorted alphabetically by `filename` (File kind) then
/// `git_url` (Git kind) so file diffs stay readable across syncs.
///
/// Format:
///
/// ```xml
/// <skill name="bash-runner">
///   <description>Execute bash commands locally</description>
///   <file path="/abs/path/to/run.sh" filename="run.sh" mime="text/x-shellscript" />
///   <git url="https://github.com/user/repo" ref="main" path="scripts/run.sh" />
/// </skill>
/// ```
///
/// Rules:
///
/// * One `<skill>` block per skill — even when `attachments` is empty,
///   the `<description>` alone carries useful context to the agent.
/// * `<description>` is always emitted (empty body when None / blank)
///   so the block shape is uniform.
/// * `<file>` is self-closing; `path` / `filename` / `mime` attributes
///   are emitted only when the corresponding field is `Some` so the
///   output stays terse.
/// * `<git>` is self-closing; `url` is required, `ref` and `path` are
///   conditional. Emitting an empty attribute would be noisy.
/// * Every attribute value is run through [`xml_escape_attr`]; the
///   description body through [`xml_escape_text`].
///
/// Returns an empty string when `skills` is empty — the caller skips
/// the leading newline in that case.
pub(crate) fn render_skill_blocks(skills: &[ResolvedSkill]) -> String {
    use std::fmt::Write as _;

    if skills.is_empty() {
        return String::new();
    }
    // Alphabetical by name — diff-stable across syncs.
    let mut sorted: Vec<&ResolvedSkill> = skills.iter().collect();
    sorted.sort_by(|a, b| a.name.cmp(&b.name));

    let mut out = String::new();
    for skill in sorted {
        let name = xml_escape_attr(&skill.name);
        let _ = writeln!(out, "<skill name=\"{name}\">");
        let description = skill.description.as_deref().unwrap_or("");
        let _ = writeln!(
            out,
            "  <description>{}</description>",
            xml_escape_text(description)
        );

        // SKILL-V2-A: emit `<step>` children BEFORE attachments — steps
        // describe the work, attachments are supporting material. Sort
        // by position so the on-disk render is deterministic across
        // syncs. Old skills with no steps render the `<description>` +
        // attachments shape unchanged (backwards-compat).
        let mut steps: Vec<&ResolvedSkillStep> = skill.steps.iter().collect();
        steps.sort_by(|a, b| {
            a.position
                .partial_cmp(&b.position)
                .unwrap_or(std::cmp::Ordering::Equal)
        });
        for (idx, step) in steps.iter().enumerate() {
            // 1-indexed order so the rendered attribute matches the
            // human convention agents expect.
            let order = idx + 1;
            let _ = writeln!(
                out,
                "  <step order=\"{order}\" title=\"{}\">",
                xml_escape_attr(&step.title)
            );
            if !step.body.is_empty() {
                let _ = writeln!(out, "    {}", xml_escape_text(&step.body));
            }
            if let Some(outcome) = step.expected_outcome.as_deref() {
                let _ = writeln!(
                    out,
                    "    <expected-outcome>{}</expected-outcome>",
                    xml_escape_text(outcome)
                );
            }
            out.push_str("  </step>\n");
        }

        // Alphabetical sort key per attachment: filename for File kind,
        // git_url for Git kind. Falls back to id so identical filenames
        // (or missing keys) stay deterministic.
        let mut atts: Vec<&ResolvedSkillAttachment> = skill.attachments.iter().collect();
        atts.sort_by(|a, b| {
            let key_a = attachment_sort_key(a);
            let key_b = attachment_sort_key(b);
            key_a.cmp(&key_b)
        });
        for att in atts {
            match att.kind {
                ResolvedSkillAttachmentKind::File => {
                    let line = render_file_attachment(att);
                    if !line.is_empty() {
                        let _ = writeln!(out, "  {line}");
                    }
                }
                ResolvedSkillAttachmentKind::Git => {
                    let line = render_git_attachment(att);
                    if !line.is_empty() {
                        let _ = writeln!(out, "  {line}");
                    }
                }
            }
        }

        out.push_str("</skill>\n");
    }
    out
}

/// Build the alphabetical sort key for a `ResolvedSkillAttachment`.
/// File kind keys on `filename`; Git kind keys on `git_url`. Falls back
/// to `id` for missing fields so the order is total.
fn attachment_sort_key(att: &ResolvedSkillAttachment) -> String {
    match att.kind {
        ResolvedSkillAttachmentKind::File => att.filename.clone().unwrap_or_else(|| att.id.clone()),
        ResolvedSkillAttachmentKind::Git => att.git_url.clone().unwrap_or_else(|| att.id.clone()),
    }
}

/// Render a `<file …/>` self-closing element. Skips emission entirely
/// when none of `absolute_path` / `filename` / `mime_type` is set — a
/// completely empty `<file/>` element would carry no actionable info
/// for the agent.
fn render_file_attachment(att: &ResolvedSkillAttachment) -> String {
    use std::fmt::Write as _;
    let mut attrs = String::new();
    if let Some(path) = &att.absolute_path {
        let _ = write!(attrs, " path=\"{}\"", xml_escape_attr(path));
    }
    if let Some(filename) = &att.filename {
        let _ = write!(attrs, " filename=\"{}\"", xml_escape_attr(filename));
    }
    if let Some(mime) = &att.mime_type {
        let _ = write!(attrs, " mime=\"{}\"", xml_escape_attr(mime));
    }
    if attrs.is_empty() {
        return String::new();
    }
    format!("<file{attrs} />")
}

/// Render a `<git …/>` self-closing element. Skips emission entirely
/// when `git_url` is missing — a `<git>` element without a URL has no
/// way for the agent to resolve the reference.
fn render_git_attachment(att: &ResolvedSkillAttachment) -> String {
    use std::fmt::Write as _;
    let Some(url) = &att.git_url else {
        return String::new();
    };
    let mut attrs = format!(" url=\"{}\"", xml_escape_attr(url));
    if let Some(git_ref) = &att.git_ref {
        let _ = write!(attrs, " ref=\"{}\"", xml_escape_attr(git_ref));
    }
    if let Some(path) = &att.git_path {
        let _ = write!(attrs, " path=\"{}\"", xml_escape_attr(path));
    }
    format!("<git{attrs} />")
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
    use crate::ResolvedPrompt;

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
            skills: vec![],
        };
        let body = render_md_agent(&role, 1_700_000_000_000);
        assert!(body.contains("catique_managed: true"));
        assert!(body.contains("catique_role_slug: reviewer"));
        assert!(body.contains("name: \"Code Reviewer\""));
        assert!(body.contains("Review code carefully."));
        // No tools attached → no `<mcp-tool>` blocks rendered.
        assert!(!body.contains("<mcp-tool"));
        // No skills attached → no `<skill>` blocks rendered.
        assert!(!body.contains("<skill "));
    }

    #[test]
    fn render_md_agent_injects_memory_paragraph_after_prompts() {
        // ctq-137 / MEM-S1: the `## Memory` section sits between the
        // role body / prompts and the XML tool blocks. The agent's own
        // role id is templated into every tool example so the agent
        // does not have to look it up.
        let role = ResolvedRole {
            id: "role-xyz".into(),
            slug: "reviewer".into(),
            name: "Code Reviewer".into(),
            content: "Review code carefully.".into(),
            prompts: vec![ResolvedPrompt {
                id: "p1".into(),
                name: "Style".into(),
                content: "no unwrap".into(),
            }],
            mcp_tools: vec![ResolvedMcpTool {
                qualified_name: "github.search".into(),
                description: Some("Search code".into()),
                input_schema_json: "{}".into(),
            }],
            skills: vec![],
        };
        let body = render_md_agent(&role, 0);

        // Header + every load-bearing tool name present.
        assert!(body.contains("## Memory"));
        assert!(body.contains("list_role_tags(role_id=\"role-xyz\")"));
        assert!(body.contains("recall_role_notes(role_id=\"role-xyz\""));
        assert!(body.contains("add_role_note(role_id=\"role-xyz\""));

        // Ordering: prompts < memory < mcp tools.
        let i_prompt = body.find("## Style").expect("prompt heading");
        let i_memory = body.find("## Memory").expect("memory heading");
        let i_mcp = body.find("<mcp-tool").expect("mcp tool block");
        assert!(
            i_prompt < i_memory,
            "memory section must follow the prompts; body:\n{body}",
        );
        assert!(
            i_memory < i_mcp,
            "memory section must precede mcp-tool blocks; body:\n{body}",
        );
    }

    #[test]
    fn render_memory_paragraph_templates_role_id_literally() {
        let para = render_memory_paragraph("role-7");
        assert!(para.starts_with("## Memory"));
        assert!(para.contains("role_id=\"role-7\""));
        // Three tool references — list, recall, add.
        assert_eq!(para.matches("role_id=\"role-7\"").count(), 3);
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
            skills: vec![],
        };
        let body = render_md_agent(&role, 0);
        assert!(body.contains(r#"<mcp-tool server="catique" name="github.search">"#));
        assert!(body.contains("<description>Search code</description>"));
        assert!(body.contains(r#"<input-schema>{"type":"object"}</input-schema>"#));
    }

    // -- SKILL-S11 unit tests --------------------------------------

    fn file_att(
        id: &str,
        filename: &str,
        path: &str,
        mime: Option<&str>,
    ) -> ResolvedSkillAttachment {
        ResolvedSkillAttachment {
            id: id.into(),
            kind: ResolvedSkillAttachmentKind::File,
            filename: Some(filename.into()),
            mime_type: mime.map(str::to_owned),
            absolute_path: Some(path.into()),
            git_url: None,
            git_ref: None,
            git_path: None,
        }
    }

    fn git_att(
        id: &str,
        url: &str,
        gref: Option<&str>,
        path: Option<&str>,
    ) -> ResolvedSkillAttachment {
        ResolvedSkillAttachment {
            id: id.into(),
            kind: ResolvedSkillAttachmentKind::Git,
            filename: None,
            mime_type: None,
            absolute_path: None,
            git_url: Some(url.into()),
            git_ref: gref.map(str::to_owned),
            git_path: path.map(str::to_owned),
        }
    }

    #[test]
    fn render_skill_blocks_empty_returns_empty_string() {
        assert_eq!(render_skill_blocks(&[]), "");
    }

    #[test]
    fn render_skill_blocks_sorts_alphabetically_by_name() {
        let skills = vec![
            ResolvedSkill {
                id: "s-b".into(),
                name: "bash-runner".into(),
                description: Some("Run bash".into()),
                steps: vec![],
                attachments: vec![file_att(
                    "a1",
                    "run.sh",
                    "/abs/skills/s-b/run.sh",
                    Some("text/x-shellscript"),
                )],
            },
            ResolvedSkill {
                id: "s-a".into(),
                name: "analytics".into(),
                description: Some("Crunch numbers <fast>".into()),
                steps: vec![],
                attachments: vec![
                    file_att(
                        "a2",
                        "report.py",
                        "/abs/skills/s-a/report.py",
                        Some("text/x-python"),
                    ),
                    git_att(
                        "a3",
                        "https://github.com/user/repo",
                        Some("main"),
                        Some("scripts/run.sh"),
                    ),
                ],
            },
        ];
        let out = render_skill_blocks(&skills);

        // Skill order: analytics before bash-runner.
        let i_analytics = out.find(r#"<skill name="analytics">"#).unwrap();
        let i_bash = out.find(r#"<skill name="bash-runner">"#).unwrap();
        assert!(i_analytics < i_bash);

        // XML escaping in description.
        assert!(out.contains("Crunch numbers &lt;fast&gt;"));

        // <file> + <git> children for analytics.
        assert!(out.contains(
            r#"<file path="/abs/skills/s-a/report.py" filename="report.py" mime="text/x-python" />"#
        ));
        assert!(out.contains(
            r#"<git url="https://github.com/user/repo" ref="main" path="scripts/run.sh" />"#
        ));

        // bash-runner has one <file> child.
        assert!(out.contains(
            r#"<file path="/abs/skills/s-b/run.sh" filename="run.sh" mime="text/x-shellscript" />"#
        ));

        // Exactly two <skill> blocks.
        assert_eq!(out.matches("<skill ").count(), 2);
        assert_eq!(out.matches("</skill>").count(), 2);
        // Every block carries a <description>.
        assert_eq!(out.matches("<description>").count(), 2);
    }

    #[test]
    fn render_skill_blocks_emits_block_when_attachments_empty() {
        let skills = vec![ResolvedSkill {
            id: "s".into(),
            name: "lonely".into(),
            description: None,
            steps: vec![],
            attachments: vec![],
        }];
        let out = render_skill_blocks(&skills);
        // Description body is empty but the element is present.
        assert!(out.contains(r#"<skill name="lonely">"#));
        assert!(out.contains("<description></description>"));
        assert!(out.contains("</skill>"));
        assert!(!out.contains("<file"));
        assert!(!out.contains("<git"));
    }

    #[test]
    fn render_skill_blocks_omits_empty_git_attrs() {
        let skills = vec![ResolvedSkill {
            id: "s".into(),
            name: "g".into(),
            description: None,
            steps: vec![],
            attachments: vec![git_att("a", "https://example.com/r", None, None)],
        }];
        let out = render_skill_blocks(&skills);
        assert!(out.contains(r#"<git url="https://example.com/r" />"#));
        // No empty `ref=""` / `path=""` attributes leaked through.
        assert!(!out.contains("ref=\"\""));
        assert!(!out.contains("path=\"\""));
    }

    #[test]
    fn render_skill_blocks_xml_escapes_url_and_path() {
        let skills = vec![ResolvedSkill {
            id: "s".into(),
            name: "tricky".into(),
            description: None,
            steps: vec![],
            attachments: vec![
                file_att("a1", "a&b.sh", r#"/abs/skills/s/a"b.sh"#, None),
                git_att("a2", "https://example.com/<x>", Some("v&w"), None),
            ],
        }];
        let out = render_skill_blocks(&skills);
        // Double-quote in path → `&quot;` per `xml_escape_attr`.
        assert!(out.contains(r#"path="/abs/skills/s/a&quot;b.sh""#));
        // Ampersand in filename.
        assert!(out.contains(r#"filename="a&amp;b.sh""#));
        // Angle bracket in git URL.
        assert!(out.contains(r#"url="https://example.com/&lt;x&gt;""#));
        // Ampersand in git ref.
        assert!(out.contains(r#"ref="v&amp;w""#));
    }

    #[test]
    fn render_md_agent_appends_skill_blocks_after_mcp_tools() {
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
            skills: vec![ResolvedSkill {
                id: "s".into(),
                name: "bash-runner".into(),
                description: Some("Run bash".into()),
                steps: vec![],
                attachments: vec![file_att(
                    "a",
                    "run.sh",
                    "/abs/skills/s/run.sh",
                    Some("text/x-shellscript"),
                )],
            }],
        };
        let body = render_md_agent(&role, 0);
        let i_mcp = body
            .find("<mcp-tool")
            .expect("mcp-tool block must be present");
        let i_skill = body.find("<skill ").expect("skill block must be present");
        assert!(
            i_mcp < i_skill,
            "skill blocks must appear after mcp-tool blocks; body:\n{body}",
        );
        assert!(body.contains(r#"<skill name="bash-runner">"#));
        assert!(body.contains("<description>Run bash</description>"));
        assert!(body.contains(r#"<file path="/abs/skills/s/run.sh""#));
    }

    // -- SKILL-V2-A unit tests --------------------------------------

    #[test]
    fn render_skill_blocks_emits_steps_before_attachments_in_position_order() {
        // Out-of-order positions intentionally — sort must happen
        // inside the renderer so the rendered XML is deterministic
        // across syncs.
        let skill = ResolvedSkill {
            id: "s".into(),
            name: "deploy".into(),
            description: Some("Push to prod".into()),
            steps: vec![
                ResolvedSkillStep {
                    position: 2.0,
                    title: "Run command".into(),
                    body: "kubectl apply".into(),
                    expected_outcome: None,
                },
                ResolvedSkillStep {
                    position: 1.0,
                    title: "Validate input".into(),
                    body: "Check the YAML".into(),
                    expected_outcome: Some("YAML parses cleanly".into()),
                },
            ],
            attachments: vec![file_att(
                "a",
                "deploy.sh",
                "/abs/skills/s/deploy.sh",
                Some("text/x-shellscript"),
            )],
        };
        let out = render_skill_blocks(std::slice::from_ref(&skill));

        // Both steps emitted, in position order (Validate < Run).
        let i_validate = out
            .find(r#"<step order="1" title="Validate input">"#)
            .unwrap();
        let i_run = out.find(r#"<step order="2" title="Run command">"#).unwrap();
        assert!(i_validate < i_run);

        // Expected-outcome carried verbatim, XML-escaped if needed.
        assert!(out.contains("<expected-outcome>YAML parses cleanly</expected-outcome>"));

        // Step block precedes the attachment block.
        let i_step = out.find("<step ").unwrap();
        let i_file = out.find("<file ").unwrap();
        assert!(i_step < i_file, "<step> must precede <file> attachments");
    }

    #[test]
    fn render_skill_blocks_xml_escapes_step_fields() {
        let skill = ResolvedSkill {
            id: "s".into(),
            name: "tricky".into(),
            description: None,
            steps: vec![ResolvedSkillStep {
                position: 1.0,
                title: r#"Run "evil & nasty" <script>"#.into(),
                body: "echo <hello & bye>".into(),
                expected_outcome: Some("a < b".into()),
            }],
            attachments: vec![],
        };
        let out = render_skill_blocks(std::slice::from_ref(&skill));
        // Attribute escaping: double-quote, ampersand, angle brackets.
        assert!(out.contains(r#"title="Run &quot;evil &amp; nasty&quot; &lt;script&gt;""#));
        // Text-node escaping: `<`, `>`, `&`.
        assert!(out.contains("echo &lt;hello &amp; bye&gt;"));
        assert!(out.contains("<expected-outcome>a &lt; b</expected-outcome>"));
    }

    #[test]
    fn render_skill_blocks_zero_steps_renders_legacy_shape() {
        // Backwards-compat: old skills (no steps) render the
        // pre-SKILL-V2-A `<description>` + attachments shape.
        let skill = ResolvedSkill {
            id: "s".into(),
            name: "legacy".into(),
            description: Some("Old skill".into()),
            steps: vec![],
            attachments: vec![git_att("a", "https://example.com/r", None, None)],
        };
        let out = render_skill_blocks(std::slice::from_ref(&skill));
        assert!(!out.contains("<step "));
        assert!(out.contains(r#"<skill name="legacy">"#));
        assert!(out.contains("<description>Old skill</description>"));
        assert!(out.contains(r#"<git url="https://example.com/r" />"#));
    }
}
