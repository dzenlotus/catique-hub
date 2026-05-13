//! Integration test for SKILL-S11: per-skill `<skill>` XML blocks in
//! the rendered role file.
//!
//! ## Why we construct the bundle by hand
//!
//! SKILL-S11 ships ahead of SKILL-S10 (paired commit). The
//! `skill_attachments` table + IPC live on a sibling branch and have
//! not landed in this commit's tree. The renderer's XML format is the
//! load-bearing contract; the bundle-shape contract is owned by the
//! application layer.
//!
//! To exercise the renderer end-to-end through every provider
//! (`claude_code`, `codex`, `opencode`) we build a [`RoleBundle`] in
//! memory and pass it straight to each provider's
//! `ClientProvider::sync`. This bypasses `build_bundle_for_test` —
//! once SKILL-S10 lands and `resolve_skill_attachments` is wired to
//! the DB, the cherry-picker can swap this fixture for a SQL-seeded
//! one without touching the assertions.
//!
//! ## Asserts (per adapter)
//!
//! * The role file contains exactly two `<skill>` blocks.
//! * Block order: `analytics` then `bash-runner` (alphabetical).
//! * `analytics` has one `<file>` child AND one `<git>` child.
//! * `bash-runner` has one `<file>` child.
//! * Every `<file>` element's `path=` attribute starts with the
//!   `<temp>/skills/<skill_id>/` prefix and ends with the filename.

use std::path::{Path, PathBuf};
use std::sync::OnceLock;

use catique_clients::adapters::claude_code::ClaudeCodeProvider;
use catique_clients::adapters::codex::CodexProvider;
use catique_clients::adapters::opencode::OpenCodeProvider;
use catique_clients::{
    ClientProvider, McpEntry, ResolvedRole, ResolvedSkill, ResolvedSkillAttachment,
    ResolvedSkillAttachmentKind, RoleBundle,
};
use tokio::sync::Mutex;

/// Process-wide async-aware guard around `$HOME` mutation. `cargo test`
/// runs `#[test]` functions in parallel by default — multiple tests
/// independently flipping `$HOME` would race. Mirrors the pattern in
/// `tests/role_sync_mcp_tools.rs`; we use a Tokio mutex so the guard
/// can be held across `.await` without blocking the runtime.
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

/// Skill id used for `analytics` — drives the `<file>` path prefix
/// assertion below.
const SKILL_ID_ANALYTICS: &str = "skill-analytics";
/// Skill id used for `bash-runner`.
const SKILL_ID_BASH: &str = "skill-bash-runner";

/// Build the file-path the renderer ships for a given skill file.
/// Mirrors the layout the SKILL-S10 cherry-pick will resolve out of
/// the DB: `<app_data_dir>/skills/<skill_id>/<storage_path>`. We
/// substitute `tmp.path().join("skills")` for `<app_data_dir>/skills`
/// so the test is hermetic.
fn file_path(skills_root: &Path, skill_id: &str, filename: &str) -> String {
    let p: PathBuf = skills_root.join(skill_id).join(filename);
    p.to_string_lossy().into_owned()
}

/// Build the in-memory [`RoleBundle`] the assertions consume. Returns
/// the bundle and the `skills_root` so the per-file path-prefix check
/// has a stable reference.
fn make_bundle(skills_root: &Path) -> RoleBundle {
    let analytics_file = ResolvedSkillAttachment {
        id: "att-analytics-file".into(),
        kind: ResolvedSkillAttachmentKind::File,
        filename: Some("report.py".into()),
        mime_type: Some("text/x-python".into()),
        absolute_path: Some(file_path(skills_root, SKILL_ID_ANALYTICS, "report.py")),
        git_url: None,
        git_ref: None,
        git_path: None,
    };
    let analytics_git = ResolvedSkillAttachment {
        id: "att-analytics-git".into(),
        kind: ResolvedSkillAttachmentKind::Git,
        filename: None,
        mime_type: None,
        absolute_path: None,
        git_url: Some("https://github.com/example/analytics".into()),
        git_ref: Some("main".into()),
        git_path: Some("scripts/run.sh".into()),
    };
    let bash_file = ResolvedSkillAttachment {
        id: "att-bash-file".into(),
        kind: ResolvedSkillAttachmentKind::File,
        filename: Some("run.sh".into()),
        mime_type: Some("text/x-shellscript".into()),
        absolute_path: Some(file_path(skills_root, SKILL_ID_BASH, "run.sh")),
        git_url: None,
        git_ref: None,
        git_path: None,
    };

    let analytics = ResolvedSkill {
        id: SKILL_ID_ANALYTICS.into(),
        name: "analytics".into(),
        description: Some("Crunch numbers".into()),
        steps: vec![],
        attachments: vec![analytics_file, analytics_git],
    };
    let bash_runner = ResolvedSkill {
        id: SKILL_ID_BASH.into(),
        name: "bash-runner".into(),
        description: Some("Execute bash commands locally".into()),
        steps: vec![],
        attachments: vec![bash_file],
    };

    let role = ResolvedRole {
        id: "role-engineer".into(),
        slug: "engineer".into(),
        name: "Engineer".into(),
        content: "Be precise.".into(),
        prompts: vec![],
        mcp_tools: vec![],
        // Constructor-order intentionally inverted (`bash-runner`
        // before `analytics`) so a renderer that skipped its
        // alphabetical sort would fail the order assertion.
        skills: vec![bash_runner, analytics],
    };

    RoleBundle {
        roles: vec![role],
        mcp: Some(McpEntry {
            command: "catique-hub-mcp".into(),
            args: vec!["--stdio".into()],
            env: vec![],
        }),
    }
}

/// Shared block of assertions every provider's rendered file must
/// satisfy. `skills_root` is whatever the test-bundle pointed
/// `absolute_path` at — providers ship the path verbatim, so the
/// assertion is provider-agnostic.
fn assert_skill_block_shape(body: &str, skills_root: &Path) {
    // Exactly two `<skill>` blocks.
    assert_eq!(
        body.matches("<skill ").count(),
        2,
        "expected 2 <skill> blocks, body:\n{body}",
    );
    assert_eq!(body.matches("</skill>").count(), 2);

    // Alphabetical order: `analytics` before `bash-runner`.
    let i_analytics = body
        .find(r#"<skill name="analytics">"#)
        .expect("`analytics` block missing");
    let i_bash = body
        .find(r#"<skill name="bash-runner">"#)
        .expect("`bash-runner` block missing");
    assert!(
        i_analytics < i_bash,
        "skill blocks must be alphabetical; body:\n{body}",
    );

    // Both descriptions land verbatim.
    assert!(body.contains("<description>Crunch numbers</description>"));
    assert!(body.contains("<description>Execute bash commands locally</description>"));

    // Per-skill attachment counts.
    let analytics_slice = &body[i_analytics..i_bash];
    let bash_slice = &body[i_bash..];
    assert_eq!(
        analytics_slice.matches("<file ").count(),
        1,
        "analytics must have exactly 1 <file>, slice:\n{analytics_slice}",
    );
    assert_eq!(
        analytics_slice.matches("<git ").count(),
        1,
        "analytics must have exactly 1 <git>, slice:\n{analytics_slice}",
    );
    assert_eq!(
        bash_slice.matches("<file ").count(),
        1,
        "bash-runner must have exactly 1 <file>, slice:\n{bash_slice}",
    );
    assert_eq!(
        bash_slice.matches("<git ").count(),
        0,
        "bash-runner must have no <git> children, slice:\n{bash_slice}",
    );

    // Path-prefix check: every `<file>` element's path attribute starts
    // with `<skills_root>/<skill_id>/` and ends with the filename.
    let analytics_prefix = skills_root
        .join(SKILL_ID_ANALYTICS)
        .to_string_lossy()
        .into_owned();
    let bash_prefix = skills_root
        .join(SKILL_ID_BASH)
        .to_string_lossy()
        .into_owned();
    assert!(
        body.contains(&format!(r#"path="{analytics_prefix}/report.py""#)),
        "analytics <file path=…> must start with {analytics_prefix}/ and end with report.py, body:\n{body}",
    );
    assert!(
        body.contains(&format!(r#"path="{bash_prefix}/run.sh""#)),
        "bash-runner <file path=…> must start with {bash_prefix}/ and end with run.sh, body:\n{body}",
    );

    // Git element well-formed.
    assert!(body.contains(
        r#"<git url="https://github.com/example/analytics" ref="main" path="scripts/run.sh" />"#
    ));

    // catique-managed marker still leads the frontmatter — defence in
    // depth that the renderer didn't bulldoze the YAML preamble while
    // appending the new blocks.
    assert!(body.contains("catique_managed: true"));
}

#[tokio::test]
async fn claude_code_sync_writes_skill_blocks() {
    let fake_home = tempfile::TempDir::new().unwrap();
    let skills_root = fake_home.path().join("skills");
    let bundle = make_bundle(&skills_root);

    with_home_override(&fake_home, || async {
        let provider = ClaudeCodeProvider;
        provider.sync(&bundle).await.expect("sync should succeed");
    })
    .await;

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
    assert_skill_block_shape(&body, &skills_root);
}

#[tokio::test]
async fn codex_sync_writes_skill_blocks() {
    let fake_home = tempfile::TempDir::new().unwrap();
    let skills_root = fake_home.path().join("skills");
    let bundle = make_bundle(&skills_root);

    with_home_override(&fake_home, || async {
        let provider = CodexProvider;
        provider.sync(&bundle).await.expect("sync should succeed");
    })
    .await;

    let skill_md = fake_home
        .path()
        .join(".agents")
        .join("skills")
        .join("catique-engineer")
        .join("SKILL.md");
    assert!(
        skill_md.exists(),
        "SKILL.md must be written at {}",
        skill_md.display(),
    );
    let body = std::fs::read_to_string(&skill_md).unwrap();
    assert_skill_block_shape(&body, &skills_root);
}

#[tokio::test]
async fn opencode_sync_writes_skill_blocks() {
    let fake_home = tempfile::TempDir::new().unwrap();
    let skills_root = fake_home.path().join("skills");
    let bundle = make_bundle(&skills_root);

    with_home_override(&fake_home, || async {
        let provider = OpenCodeProvider;
        provider.sync(&bundle).await.expect("sync should succeed");
    })
    .await;

    let agent_file = fake_home
        .path()
        .join(".config")
        .join("opencode")
        .join("agents")
        .join("catique-engineer.md");
    assert!(
        agent_file.exists(),
        "agent file must be written at {}",
        agent_file.display(),
    );
    let body = std::fs::read_to_string(&agent_file).unwrap();
    assert_skill_block_shape(&body, &skills_root);
}
