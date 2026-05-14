//! Integration test for ADR-0008 / ADR-0005 round-21 amendment:
//! per-tool `<mcp-tool>` XML blocks in the rendered role file and the
//! single-entry `mcp.json` shape per provider.
//!
//! Seeds:
//! * one role `Engineer` with content + zero prompts;
//! * two MCP servers: `atlassian` (HTTP) with two upstream tools and
//!   `github` (stdio) with one upstream tool;
//! * one Manual tool `legacy_search` attached to the same role.
//!
//! Asserts:
//! * `build_bundle_for_test` resolves four `ResolvedMcpTool` entries
//!   with the qualified-name rule (`{server}.{upstream}` for upstream
//!   rows, bare `name` for manual);
//! * Claude Code's `sync(&bundle)` writes a role file containing four
//!   `<mcp-tool>` blocks in alphabetical order, with XML escaping
//!   applied to descriptions that contain markup;
//! * each provider's `mcp.json` (or equivalent) carries EXACTLY ONE
//!   catique-hub entry — verified end-to-end on a `$HOME`-override
//!   temp directory.

use std::sync::OnceLock;

use catique_application::connected_providers::build_bundle_for_test;
use catique_clients::adapters::claude_code::ClaudeCodeProvider;
use catique_clients::adapters::codex::CodexProvider;
use catique_clients::adapters::opencode::OpenCodeProvider;
use catique_clients::{ClientProvider, ResolvedRole};
use catique_infrastructure::db::pool::{memory_pool_for_tests, Pool};
use catique_infrastructure::db::runner::run_pending;
use serde_json::Value;
use tokio::sync::Mutex;

/// Process-wide async-aware guard around `$HOME` mutation. `cargo
/// test` runs `#[test]` functions in parallel by default — multiple
/// tests independently flipping `$HOME` would race. We use a Tokio
/// mutex so the guard can be held across `.await` without blocking
/// the runtime (every test body in this file is async).
fn home_lock() -> &'static Mutex<()> {
    static LOCK: OnceLock<Mutex<()>> = OnceLock::new();
    LOCK.get_or_init(|| Mutex::new(()))
}

/// Run `f` with `$HOME` temporarily pointed at `tmp.path()`. Restores
/// the prior `$HOME` value (or removes it) before returning. The
/// `home_lock` mutex is held for the duration of the closure so
/// parallel test threads queue rather than racing.
async fn with_home_override<F, Fut, T>(tmp: &tempfile::TempDir, f: F) -> T
where
    F: FnOnce() -> Fut,
    Fut: std::future::Future<Output = T>,
{
    let _guard = home_lock().lock().await;
    let prev = std::env::var_os("HOME");
    // Safety: the `_guard` lock above serialises every concurrent
    // `set_var` from sibling tests in this file. Other test files in
    // the workspace do not write to `$HOME`.
    std::env::set_var("HOME", tmp.path());
    let result = f().await;
    match prev {
        Some(v) => std::env::set_var("HOME", v),
        None => std::env::remove_var("HOME"),
    }
    result
}

fn fresh_pool() -> Pool {
    let pool = memory_pool_for_tests();
    let mut conn = pool.get().unwrap();
    run_pending(&mut conn).unwrap();
    drop(conn);
    pool
}

/// Seed the four-tool fixture the ADR-0008 brief calls for.
///
/// Returns the role id so the assertions can pick the right entry out
/// of the bundle (system-seeded roles share the same table).
fn seed_role_with_mcp_tools(pool: &Pool) -> String {
    let conn = pool.get().unwrap();

    // The role itself. Slug derived by the resolver from `name`.
    conn.execute(
        "INSERT INTO roles (id, name, content, color, created_at, updated_at) \
         VALUES ('role-engineer', 'Engineer', 'Be precise.', NULL, 0, 0)",
        [],
    )
    .unwrap();

    // Two MCP servers — one HTTP, one stdio — covering both transports.
    conn.execute(
        "INSERT INTO mcp_servers (id, name, transport, url, command, auth_json, enabled, created_at, updated_at) \
         VALUES ('srv-atlassian', 'atlassian', 'http', 'https://example.com/mcp', NULL, NULL, 1, 0, 0)",
        [],
    )
    .unwrap();
    conn.execute(
        "INSERT INTO mcp_servers (id, name, transport, url, command, auth_json, enabled, created_at, updated_at) \
         VALUES ('srv-github', 'github', 'stdio', NULL, '/usr/local/bin/github-mcp', NULL, 1, 0, 0)",
        [],
    )
    .unwrap();

    // Three upstream tools — two on atlassian, one on github. The
    // local `name` column intentionally differs from `upstream_name`
    // so a renderer that accidentally uses `name` for an upstream row
    // would fail the alphabetical-order assertion below.
    conn.execute(
        "INSERT INTO mcp_tools \
           (id, name, description, schema_json, color, position, \
            server_id, upstream_name, source, last_synced_at, \
            created_at, updated_at) \
         VALUES ('tool-atl-create', 'atl_local_create', 'Create a Jira issue', \
                 '{\"type\":\"object\",\"properties\":{\"summary\":{\"type\":\"string\"}}}', \
                 NULL, 1.0, 'srv-atlassian', 'create_issue', 'upstream', 1, 0, 0)",
        [],
    )
    .unwrap();
    conn.execute(
        "INSERT INTO mcp_tools \
           (id, name, description, schema_json, color, position, \
            server_id, upstream_name, source, last_synced_at, \
            created_at, updated_at) \
         VALUES ('tool-atl-list', 'atl_local_list', 'List Jira issues', \
                 '{\"type\":\"object\"}', \
                 NULL, 2.0, 'srv-atlassian', 'list_issues', 'upstream', 1, 0, 0)",
        [],
    )
    .unwrap();
    conn.execute(
        "INSERT INTO mcp_tools \
           (id, name, description, schema_json, color, position, \
            server_id, upstream_name, source, last_synced_at, \
            created_at, updated_at) \
         VALUES ('tool-gh-search', 'gh_local_search', 'Search GitHub <code>', \
                 '{\"type\":\"object\",\"properties\":{\"q\":{\"type\":\"string\"}}}', \
                 NULL, 3.0, 'srv-github', 'search', 'upstream', 1, 0, 0)",
        [],
    )
    .unwrap();

    // One manual tool. No server, no upstream_name — qualified name
    // collapses to `name`.
    conn.execute(
        "INSERT INTO mcp_tools \
           (id, name, description, schema_json, color, position, \
            server_id, upstream_name, source, last_synced_at, \
            created_at, updated_at) \
         VALUES ('tool-manual', 'legacy_search', 'Legacy search shim', \
                 '{\"type\":\"object\"}', \
                 NULL, 4.0, NULL, NULL, 'manual', NULL, 0, 0)",
        [],
    )
    .unwrap();

    // Attach all four to the role.
    for (tid, pos) in [
        ("tool-atl-create", 1.0_f64),
        ("tool-atl-list", 2.0),
        ("tool-gh-search", 3.0),
        ("tool-manual", 4.0),
    ] {
        conn.execute(
            "INSERT INTO role_mcp_tools (role_id, mcp_tool_id, position) \
             VALUES (?1, ?2, ?3)",
            rusqlite::params!["role-engineer", tid, pos],
        )
        .unwrap();
    }

    drop(conn);
    "role-engineer".to_owned()
}

#[tokio::test]
async fn bundle_resolves_qualified_names_for_upstream_and_manual_tools() {
    let pool = fresh_pool();
    let role_id = seed_role_with_mcp_tools(&pool);

    let bundle = build_bundle_for_test(&pool).expect("build bundle");
    let role: &ResolvedRole = bundle
        .roles
        .iter()
        .find(|r| r.id == role_id)
        .expect("seeded role must round-trip into the bundle");

    let names: Vec<&str> = role
        .mcp_tools
        .iter()
        .map(|t| t.qualified_name.as_str())
        .collect();

    // The resolver emits tools in `role_mcp_tools.position ASC` order;
    // the renderer is the layer that sorts alphabetically. Here we
    // assert presence — order is the renderer's contract, asserted
    // by the rendering test below.
    assert_eq!(role.mcp_tools.len(), 4, "expected 4 tools, got {names:?}");
    assert!(names.contains(&"atlassian.create_issue"));
    assert!(names.contains(&"atlassian.list_issues"));
    assert!(names.contains(&"github.search"));
    // Manual rows ship without server prefix — see ADR-0005 amendment §1.
    assert!(names.contains(&"legacy_search"));
}

/// Drive Claude Code's `sync` end-to-end on a `$HOME`-override and
/// inspect the rendered agent file plus the single-entry `~/.claude.json`.
#[tokio::test]
async fn claude_code_sync_writes_agent_file_with_sorted_blocks_and_single_mcp_entry() {
    let pool = fresh_pool();
    let _role_id = seed_role_with_mcp_tools(&pool);
    let bundle = build_bundle_for_test(&pool).expect("build bundle");
    assert!(
        bundle.mcp.is_some(),
        "bundle must carry the catique-hub McpEntry"
    );

    let fake_home = tempfile::TempDir::new().unwrap();
    with_home_override(&fake_home, || async {
        let provider = ClaudeCodeProvider;
        provider.sync(&bundle).await.expect("sync should succeed");
    })
    .await;

    // The slug for `Engineer` is `engineer`.
    let agent_file = fake_home
        .path()
        .join(".claude")
        .join("agents")
        .join("catique-engineer.md");
    assert!(
        agent_file.exists(),
        "agent file must be written at {}",
        agent_file.display(),
    );
    let body = std::fs::read_to_string(&agent_file).unwrap();

    // Exactly four `<mcp-tool>` blocks.
    assert_eq!(
        body.matches("<mcp-tool ").count(),
        4,
        "expected 4 <mcp-tool> blocks, body:\n{body}",
    );
    assert_eq!(body.matches("</mcp-tool>").count(), 4);

    // Alphabetical order by qualified name.
    let i_atlassian_create = body
        .find(r#"name="atlassian.create_issue""#)
        .expect("atlassian.create_issue missing");
    let i_atlassian_list = body
        .find(r#"name="atlassian.list_issues""#)
        .expect("atlassian.list_issues missing");
    let i_github_search = body
        .find(r#"name="github.search""#)
        .expect("github.search missing");
    let i_legacy = body
        .find(r#"name="legacy_search""#)
        .expect("legacy_search missing");
    assert!(i_atlassian_create < i_atlassian_list);
    assert!(i_atlassian_list < i_github_search);
    assert!(i_github_search < i_legacy);

    // XML well-formedness: every `<mcp-tool …>` opener is followed
    // by `<description>` → `<input-schema>` → `</mcp-tool>` lines.
    let lines: Vec<&str> = body.lines().collect();
    let openers: Vec<usize> = lines
        .iter()
        .enumerate()
        .filter(|(_, l)| l.starts_with("<mcp-tool "))
        .map(|(i, _)| i)
        .collect();
    assert_eq!(openers.len(), 4);
    for &start in &openers {
        assert!(
            lines[start + 1].trim_start().starts_with("<description>"),
            "block at line {start}: expected <description>, got {:?}",
            lines.get(start + 1),
        );
        assert!(
            lines[start + 2].trim_start().starts_with("<input-schema>"),
            "block at line {start}: expected <input-schema>, got {:?}",
            lines.get(start + 2),
        );
        assert!(
            lines[start + 3].starts_with("</mcp-tool>"),
            "block at line {start}: expected </mcp-tool>, got {:?}",
            lines.get(start + 3),
        );
    }

    // XML escaping: the github description carries `<code>` which
    // must land as `&lt;code&gt;`.
    assert!(
        body.contains("Search GitHub &lt;code&gt;"),
        "<code> must be escaped, body:\n{body}",
    );
    // Embedded JSON characters that are safe in XML survive verbatim.
    assert!(body.contains(r#"{"type":"object","properties":{"q":{"type":"string"}}}"#));

    // The catique-managed marker still leads the frontmatter.
    assert!(body.contains("catique_managed: true"));

    // Single MCP config entry — keyed `catique-hub`.
    let mcp_json_path = fake_home.path().join(".claude.json");
    assert!(mcp_json_path.exists());
    let root: Value = serde_json::from_str(&std::fs::read_to_string(&mcp_json_path).unwrap())
        .expect("valid JSON");
    let servers = root["mcpServers"]
        .as_object()
        .expect("mcpServers must be an object");
    assert_eq!(servers.len(), 1, "expected single entry, got {servers:?}");
    assert!(servers.contains_key("catique-hub"));
    assert!(servers["catique-hub"]["command"].as_str().is_some());
}

/// OpenCode mirror of the Claude Code single-entry assertion.
#[tokio::test]
async fn opencode_mcp_config_writes_single_catique_hub_entry() {
    let pool = fresh_pool();
    let _role_id = seed_role_with_mcp_tools(&pool);
    let bundle = build_bundle_for_test(&pool).expect("build bundle");

    let fake_home = tempfile::TempDir::new().unwrap();
    with_home_override(&fake_home, || async {
        let provider = OpenCodeProvider;
        provider.sync(&bundle).await.expect("sync should succeed");
    })
    .await;

    let mcp_json_path = fake_home
        .path()
        .join(".config")
        .join("opencode")
        .join("opencode.json");
    assert!(mcp_json_path.exists(), "opencode.json must be written");
    let root: Value = serde_json::from_str(&std::fs::read_to_string(&mcp_json_path).unwrap())
        .expect("valid JSON");
    let mcp = root["mcp"].as_object().expect("`mcp` must be an object");
    assert_eq!(mcp.len(), 1, "expected single entry, got {mcp:?}");
    assert!(mcp.contains_key("catique-hub"));
}

/// Codex mirror: the catique slot is `[mcp_servers.catique-hub]` in
/// the TOML config and must be the only sub-table inside the
/// `mcp_servers` table on a fresh write.
#[tokio::test]
async fn codex_mcp_config_writes_single_catique_hub_table() {
    let pool = fresh_pool();
    let _role_id = seed_role_with_mcp_tools(&pool);
    let bundle = build_bundle_for_test(&pool).expect("build bundle");

    let fake_home = tempfile::TempDir::new().unwrap();
    with_home_override(&fake_home, || async {
        let provider = CodexProvider;
        provider.sync(&bundle).await.expect("sync should succeed");
    })
    .await;

    let toml_path = fake_home.path().join(".codex").join("config.toml");
    assert!(toml_path.exists(), "~/.codex/config.toml must be written");
    let raw = std::fs::read_to_string(&toml_path).unwrap();
    // Count the catique-hub key inside `[mcp_servers]`. A simple
    // substring check is enough — the file is small and known-shaped.
    assert_eq!(
        raw.matches("[mcp_servers.catique-hub]").count(),
        1,
        "expected exactly one [mcp_servers.catique-hub] table, got:\n{raw}",
    );
    // No other catique-* tables landed.
    let other_catique_tables: Vec<&str> = raw
        .lines()
        .filter(|l| l.starts_with("[mcp_servers.") && !l.contains("catique-hub"))
        .collect();
    assert!(
        other_catique_tables.is_empty(),
        "no other [mcp_servers.*] tables expected, got: {other_catique_tables:?}",
    );

    // Sanity: the agent file for the seeded role exists at
    // `~/.agents/skills/catique-engineer/SKILL.md` with the four
    // `<mcp-tool>` blocks too (codex uses the same `render_md_agent`).
    let skill_md = fake_home
        .path()
        .join(".agents")
        .join("skills")
        .join("catique-engineer")
        .join("SKILL.md");
    assert!(skill_md.exists());
    let body = std::fs::read_to_string(&skill_md).unwrap();
    assert_eq!(body.matches("<mcp-tool ").count(), 4);
}
