//! Provider for **Claude Code** (Anthropic CLI).
//!
//! ## Paths
//!
//! - Config root: `~/.claude/`
//! - Agent files: `~/.claude/agents/catique-<role-slug>.md`
//! - MCP config:  `~/.claude.json`, key-scoped to
//!   `mcpServers["catique-hub"]`.
//!
//! ## Atomicity rules
//!
//! Every agent file is written via tmp+rename. `~/.claude.json` ALSO
//! holds Claude Code's UI state — we MUST read the entire JSON
//! document, mutate the single `mcpServers["catique-hub"]` key, and
//! write back via tmp+rename. Foreign keys (and other entries inside
//! `mcpServers`) are preserved verbatim.
//!
//! Reference: <https://docs.anthropic.com/en/docs/claude-code>

use std::path::PathBuf;

use async_trait::async_trait;
use serde_json::{Map, Value};

use crate::{
    adapters::common::{
        atomic_write, has_catique_prefix, home_dir, is_catique_managed, now_unix_ms,
        render_md_agent,
    },
    ClientProvider, McpEntry, ProviderError, RemoveReport, RoleBundle, SyncReport, CATIQUE_MCP_KEY,
};

/// Provider for Anthropic's Claude Code CLI.
pub struct ClaudeCodeProvider;

impl ClaudeCodeProvider {
    /// `~/.claude/`
    fn config_dir() -> Result<PathBuf, ProviderError> {
        Ok(home_dir()?.join(".claude"))
    }

    /// `~/.claude/agents/`
    fn agents_dir() -> Result<PathBuf, ProviderError> {
        Ok(Self::config_dir()?.join("agents"))
    }

    /// `~/.claude.json`
    fn mcp_config_path() -> Result<PathBuf, ProviderError> {
        Ok(home_dir()?.join(".claude.json"))
    }

    /// `catique-<slug>.md`
    fn agent_filename(slug: &str) -> String {
        format!("catique-{slug}.md")
    }
}

#[async_trait]
impl ClientProvider for ClaudeCodeProvider {
    fn id(&self) -> &'static str {
        "claude-code"
    }
    fn display_name(&self) -> &'static str {
        "Claude Code"
    }
    fn supports_agent_files(&self) -> bool {
        true
    }
    fn supports_mcp(&self) -> bool {
        true
    }

    async fn detect(&self) -> Result<bool, ProviderError> {
        // The `~/.claude/` directory is sufficient evidence of an
        // installation — it lands on first launch of the CLI.
        let dir = Self::config_dir()?;
        Ok(tokio::fs::metadata(&dir).await.is_ok())
    }

    async fn sync(&self, bundle: &RoleBundle) -> Result<SyncReport, ProviderError> {
        let agents_dir = Self::agents_dir()?;
        sync_md_agents(&agents_dir, bundle, ClaudeCodeProvider::agent_filename).await?;
        let report = build_sync_report(&agents_dir, bundle).await?;

        // MCP slot.
        if let Some(mcp) = bundle.mcp.as_ref() {
            mutate_claude_json(&Self::mcp_config_path()?, |servers| {
                servers.insert(CATIQUE_MCP_KEY.to_string(), mcp_entry_to_value(mcp));
            })
            .await?;
        }

        Ok(report)
    }

    async fn remove(&self) -> Result<RemoveReport, ProviderError> {
        let agents_dir = Self::agents_dir()?;
        let mut removed: Vec<String> = Vec::new();
        let mut skipped: Vec<String> = Vec::new();
        if tokio::fs::metadata(&agents_dir).await.is_ok() {
            let (rm, sk) = remove_managed_files_in_dir(&agents_dir).await?;
            removed.extend(rm);
            skipped.extend(sk);
        }

        // Strip the catique-owned MCP slot. If the file doesn't exist
        // there is nothing to do — leave foreign Claude state alone.
        let mcp_path = Self::mcp_config_path()?;
        if tokio::fs::metadata(&mcp_path).await.is_ok() {
            mutate_claude_json(&mcp_path, |servers| {
                servers.remove(CATIQUE_MCP_KEY);
            })
            .await?;
            removed.push(format!(
                "{}#mcpServers.{CATIQUE_MCP_KEY}",
                mcp_path.display()
            ));
        }

        Ok(RemoveReport { removed, skipped })
    }
}

// ---------------------------------------------------------------------
// Shared helpers reused by Claude Code + OpenCode (same agent-file
// flavour). Codex Skills get their own renderer because the directory
// + filename layout differ.
// ---------------------------------------------------------------------

/// Generic agent-file sync for the Claude-style markdown flavour.
/// Writes one file per role to `<agents_dir>/<filename(slug)>`.
pub(crate) async fn sync_md_agents<F>(
    agents_dir: &std::path::Path,
    bundle: &RoleBundle,
    filename: F,
) -> Result<(), ProviderError>
where
    F: Fn(&str) -> String,
{
    tokio::fs::create_dir_all(agents_dir).await?;
    let now = now_unix_ms();

    // 1. Write every role.
    let mut wanted_filenames: std::collections::HashSet<String> = std::collections::HashSet::new();
    for role in &bundle.roles {
        let body = render_md_agent(role, now);
        let fname = filename(&role.slug);
        wanted_filenames.insert(fname.clone());
        let target = agents_dir.join(&fname);
        atomic_write(&target, body.as_bytes()).await?;
    }

    // 2. Delete stale catique-managed files.
    let mut entries = match tokio::fs::read_dir(agents_dir).await {
        Ok(e) => e,
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => return Ok(()),
        Err(e) => return Err(ProviderError::Io(e)),
    };
    while let Some(entry) = entries.next_entry().await? {
        let path = entry.path();
        let fname = match path.file_name().and_then(|n| n.to_str()) {
            Some(n) => n.to_owned(),
            None => continue,
        };
        if !has_catique_prefix(&fname) {
            continue;
        }
        if wanted_filenames.contains(&fname) {
            continue;
        }
        let content = tokio::fs::read_to_string(&path).await.unwrap_or_default();
        if !is_catique_managed(&content) {
            continue;
        }
        tokio::fs::remove_file(&path).await?;
    }

    Ok(())
}

/// After [`sync_md_agents`] has written what the bundle requested,
/// produce a [`SyncReport`] by re-scanning the directory. The scan is
/// cheap (one stat-per-file) and gives us an authoritative `removed` /
/// `skipped` set without the orchestrator needing to thread a pre-sync
/// snapshot through.
pub(crate) async fn build_sync_report(
    agents_dir: &std::path::Path,
    bundle: &RoleBundle,
) -> Result<SyncReport, ProviderError> {
    let mut report = SyncReport::default();

    // Wanted set, by what the bundle asks for.
    let wanted_slugs: std::collections::HashSet<&str> =
        bundle.roles.iter().map(|r| r.slug.as_str()).collect();

    let mut entries = match tokio::fs::read_dir(agents_dir).await {
        Ok(e) => e,
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => return Ok(report),
        Err(e) => return Err(ProviderError::Io(e)),
    };

    while let Some(entry) = entries.next_entry().await? {
        let path = entry.path();
        let fname = match path.file_name().and_then(|n| n.to_str()) {
            Some(n) => n.to_owned(),
            None => continue,
        };
        if !has_catique_prefix(&fname) {
            report.skipped.push(fname);
            continue;
        }
        // Confirm file is catique-managed before claiming it.
        let content = tokio::fs::read_to_string(&path).await.unwrap_or_default();
        if !is_catique_managed(&content) {
            report.skipped.push(fname);
            continue;
        }
        // Recover the slug from the filename "catique-<slug>.md".
        let slug = fname
            .strip_prefix(crate::CATIQUE_FILE_PREFIX)
            .and_then(|s| s.rsplit_once('.').map(|(name, _ext)| name.to_owned()))
            .unwrap_or_default();
        if wanted_slugs.contains(slug.as_str()) {
            report.written.push(path.to_string_lossy().into_owned());
        } else {
            report.removed.push(path.to_string_lossy().into_owned());
        }
    }
    Ok(report)
}

/// Remove every catique-managed file in `dir`. Returns
/// `(removed, skipped)` lists.
pub(crate) async fn remove_managed_files_in_dir(
    dir: &std::path::Path,
) -> Result<(Vec<String>, Vec<String>), ProviderError> {
    let mut removed = Vec::new();
    let mut skipped = Vec::new();
    let mut entries = tokio::fs::read_dir(dir).await?;
    while let Some(entry) = entries.next_entry().await? {
        let path = entry.path();
        let fname = match path.file_name().and_then(|n| n.to_str()) {
            Some(n) => n.to_owned(),
            None => continue,
        };
        if !has_catique_prefix(&fname) {
            skipped.push(fname);
            continue;
        }
        let content = tokio::fs::read_to_string(&path).await.unwrap_or_default();
        if !is_catique_managed(&content) {
            skipped.push(fname);
            continue;
        }
        tokio::fs::remove_file(&path).await?;
        removed.push(path.to_string_lossy().into_owned());
    }
    Ok((removed, skipped))
}

/// Read `~/.claude.json` (or create an empty object if missing), find
/// `mcpServers` (or insert a fresh empty object), pass it to the
/// `mutate` closure, and write the whole document back atomically.
///
/// Foreign keys at the top level (`projects`, `customApiKeyResponses`,
/// every UI-state field) are preserved verbatim.
pub(crate) async fn mutate_claude_json<F>(
    path: &std::path::Path,
    mutate: F,
) -> Result<(), ProviderError>
where
    F: FnOnce(&mut Map<String, Value>),
{
    let mut root: Value = if let Ok(raw) = tokio::fs::read_to_string(path).await {
        if raw.trim().is_empty() {
            Value::Object(Map::new())
        } else {
            serde_json::from_str(&raw)?
        }
    } else {
        Value::Object(Map::new())
    };

    let obj = root
        .as_object_mut()
        .ok_or_else(|| ProviderError::Malformed("~/.claude.json is not a JSON object".into()))?;

    // Ensure `mcpServers` exists and is an object.
    let servers_entry = obj
        .entry("mcpServers")
        .or_insert_with(|| Value::Object(Map::new()));
    let servers = servers_entry.as_object_mut().ok_or_else(|| {
        ProviderError::Malformed("`mcpServers` in ~/.claude.json is not an object".into())
    })?;
    mutate(servers);

    // If the catique mutation cleared the catique slot AND the
    // resulting `mcpServers` is empty, leave the empty object in place
    // — Claude Code accepts it. Removing the whole `mcpServers` key
    // would exceed our "leave foreign content alone" contract.

    let serialised = serde_json::to_vec_pretty(&root)?;
    atomic_write(path, &serialised).await?;
    Ok(())
}

/// Project an [`McpEntry`] into Claude Code's JSON shape.
fn mcp_entry_to_value(entry: &McpEntry) -> Value {
    let mut obj = Map::new();
    obj.insert("command".into(), Value::String(entry.command.clone()));
    obj.insert(
        "args".into(),
        Value::Array(entry.args.iter().cloned().map(Value::String).collect()),
    );
    if !entry.env.is_empty() {
        let mut env = Map::new();
        for (k, v) in &entry.env {
            env.insert(k.clone(), Value::String(v.clone()));
        }
        obj.insert("env".into(), Value::Object(env));
    }
    Value::Object(obj)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::{ResolvedPrompt, ResolvedRole};
    use tempfile::TempDir;

    fn make_role(id: &str, slug: &str) -> ResolvedRole {
        ResolvedRole {
            id: id.into(),
            slug: slug.into(),
            name: format!("Role {slug}"),
            content: format!("Body for {slug}.\nSecond line."),
            prompts: vec![ResolvedPrompt {
                id: format!("{slug}-p1"),
                name: "Style".into(),
                content: "Use snake_case.".into(),
            }],
            mcp_tools: vec![],
            skills: vec![],
        }
    }

    #[test]
    fn id_and_display_name() {
        let p = ClaudeCodeProvider;
        assert_eq!(p.id(), "claude-code");
        assert_eq!(p.display_name(), "Claude Code");
        assert!(p.supports_agent_files());
        assert!(p.supports_mcp());
    }

    #[tokio::test]
    async fn sync_writes_one_md_per_role_with_marker() {
        let tmp = TempDir::new().unwrap();
        let agents_dir = tmp.path().join("agents");
        let bundle = RoleBundle {
            roles: vec![make_role("r-1", "alpha"), make_role("r-2", "beta")],
            mcp: None,
        };
        sync_md_agents(&agents_dir, &bundle, ClaudeCodeProvider::agent_filename)
            .await
            .unwrap();
        let alpha = agents_dir.join("catique-alpha.md");
        let beta = agents_dir.join("catique-beta.md");
        assert!(alpha.exists());
        assert!(beta.exists());
        let body = tokio::fs::read_to_string(&alpha).await.unwrap();
        assert!(body.contains("catique_managed: true"));
        assert!(body.contains("Body for alpha."));
        assert!(body.contains("## Style"));
    }

    #[tokio::test]
    async fn sync_removes_stale_catique_files_only() {
        let tmp = TempDir::new().unwrap();
        let agents_dir = tmp.path().join("agents");
        tokio::fs::create_dir_all(&agents_dir).await.unwrap();
        // Pre-existing catique-managed file (will go stale).
        tokio::fs::write(
            agents_dir.join("catique-old.md"),
            "---\ncatique_managed: true\n---\nold body",
        )
        .await
        .unwrap();
        // User-authored file with no prefix (must survive).
        tokio::fs::write(agents_dir.join("my-agent.md"), "user content")
            .await
            .unwrap();
        // catique-prefixed but NOT managed (must survive — defence in depth).
        tokio::fs::write(
            agents_dir.join("catique-handmade.md"),
            "---\nname: foo\n---\nbody",
        )
        .await
        .unwrap();

        let bundle = RoleBundle {
            roles: vec![make_role("r-1", "alpha")],
            mcp: None,
        };
        sync_md_agents(&agents_dir, &bundle, ClaudeCodeProvider::agent_filename)
            .await
            .unwrap();

        assert!(agents_dir.join("catique-alpha.md").exists());
        assert!(!agents_dir.join("catique-old.md").exists());
        assert!(agents_dir.join("my-agent.md").exists());
        assert!(agents_dir.join("catique-handmade.md").exists());
    }

    #[tokio::test]
    async fn mutate_claude_json_preserves_foreign_keys() {
        let tmp = TempDir::new().unwrap();
        let path = tmp.path().join(".claude.json");
        // Pre-existing, with foreign UI state.
        let pre = serde_json::json!({
            "projects": {"p1": {"foo": "bar"}},
            "userId": "abc",
            "mcpServers": {
                "other-server": {"command": "/usr/bin/foo"}
            }
        });
        tokio::fs::write(&path, serde_json::to_string_pretty(&pre).unwrap())
            .await
            .unwrap();

        mutate_claude_json(&path, |servers| {
            servers.insert(
                CATIQUE_MCP_KEY.into(),
                serde_json::json!({"command": "/cat/bin", "args": []}),
            );
        })
        .await
        .unwrap();

        let raw = tokio::fs::read_to_string(&path).await.unwrap();
        let root: serde_json::Value = serde_json::from_str(&raw).unwrap();
        assert_eq!(root["projects"]["p1"]["foo"], "bar");
        assert_eq!(root["userId"], "abc");
        assert_eq!(
            root["mcpServers"]["other-server"]["command"],
            "/usr/bin/foo"
        );
        assert_eq!(root["mcpServers"]["catique-hub"]["command"], "/cat/bin");
    }

    #[tokio::test]
    async fn mutate_claude_json_creates_file_when_missing() {
        let tmp = TempDir::new().unwrap();
        let path = tmp.path().join(".claude.json");
        mutate_claude_json(&path, |servers| {
            servers.insert(
                CATIQUE_MCP_KEY.into(),
                serde_json::json!({"command": "/cat", "args": []}),
            );
        })
        .await
        .unwrap();
        let raw = tokio::fs::read_to_string(&path).await.unwrap();
        let root: serde_json::Value = serde_json::from_str(&raw).unwrap();
        assert_eq!(root["mcpServers"]["catique-hub"]["command"], "/cat");
    }

    #[tokio::test]
    async fn remove_managed_files_skips_user_files() {
        let tmp = TempDir::new().unwrap();
        let dir = tmp.path();
        tokio::fs::write(
            dir.join("catique-a.md"),
            "---\ncatique_managed: true\n---\n",
        )
        .await
        .unwrap();
        tokio::fs::write(dir.join("catique-handmade.md"), "no marker")
            .await
            .unwrap();
        tokio::fs::write(dir.join("user.md"), "no prefix")
            .await
            .unwrap();
        let (removed, skipped) = remove_managed_files_in_dir(dir).await.unwrap();
        assert_eq!(removed.len(), 1);
        assert_eq!(skipped.len(), 2);
        assert!(!dir.join("catique-a.md").exists());
        assert!(dir.join("catique-handmade.md").exists());
        assert!(dir.join("user.md").exists());
    }
}
