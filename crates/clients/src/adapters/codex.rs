//! Provider for **OpenAI Codex CLI**.
//!
//! ## Paths
//!
//! - Skills root: `~/.agents/skills/` — one directory per role with the
//!   `catique-` prefix on the directory name (`catique-<role-slug>/`).
//!   Each directory carries a single `SKILL.md` whose YAML frontmatter
//!   carries the catique-managed marker.
//! - MCP config: `~/.codex/config.toml`, key-scoped to
//!   `[mcp_servers.catique-hub]`.
//!
//! ## Why Skills, not the agents/ folder?
//!
//! The round-21 ratified decision: Codex's "Skills" surface is the
//! multi-role-friendly home; the per-project `agents/` layout doesn't
//! map onto Catique's per-user-global model.
//!
//! ## Atomicity rules
//!
//! Every `SKILL.md` write is tmp+rename. The TOML config file is
//! parsed with `toml_edit` (preserves comments + key ordering),
//! mutated in place under `[mcp_servers.catique-hub]`, and written
//! back via tmp+rename. Foreign tables / keys are untouched.

use std::path::PathBuf;

use async_trait::async_trait;
use toml_edit::{value, DocumentMut, Item, Table};

use crate::{
    adapters::common::{
        atomic_write, has_catique_prefix, home_dir, is_catique_managed, now_unix_ms,
        render_md_agent,
    },
    ClientProvider, McpEntry, ProviderError, RemoveReport, RoleBundle, SyncReport,
    CATIQUE_FILE_PREFIX, CATIQUE_MANAGED_KEY, CATIQUE_MCP_KEY,
};

/// Provider for the OpenAI Codex CLI agentic client.
pub struct CodexProvider;

impl CodexProvider {
    /// `~/.agents/skills/`
    fn skills_root() -> Result<PathBuf, ProviderError> {
        Ok(home_dir()?.join(".agents").join("skills"))
    }
    /// `~/.codex/config.toml`
    fn mcp_config_path() -> Result<PathBuf, ProviderError> {
        Ok(home_dir()?.join(".codex").join("config.toml"))
    }
    /// Skill directory name `catique-<slug>`.
    fn skill_dirname(slug: &str) -> String {
        format!("catique-{slug}")
    }
}

#[async_trait]
impl ClientProvider for CodexProvider {
    fn id(&self) -> &'static str {
        "codex"
    }
    fn display_name(&self) -> &'static str {
        "Codex"
    }
    fn supports_agent_files(&self) -> bool {
        true
    }
    fn supports_mcp(&self) -> bool {
        true
    }

    async fn detect(&self) -> Result<bool, ProviderError> {
        // `~/.codex/` is the canonical install marker (the CLI lands
        // it on first launch, before the user even configures Skills).
        let codex_root = home_dir()?.join(".codex");
        Ok(tokio::fs::metadata(&codex_root).await.is_ok())
    }

    async fn sync(&self, bundle: &RoleBundle) -> Result<SyncReport, ProviderError> {
        let skills_root = Self::skills_root()?;
        tokio::fs::create_dir_all(&skills_root).await?;
        let now = now_unix_ms();

        let mut wanted_dirs: std::collections::HashSet<String> = std::collections::HashSet::new();
        for role in &bundle.roles {
            let dirname = Self::skill_dirname(&role.slug);
            wanted_dirs.insert(dirname.clone());
            let skill_dir = skills_root.join(&dirname);
            tokio::fs::create_dir_all(&skill_dir).await?;
            let body = render_md_agent(role, now);
            let target = skill_dir.join("SKILL.md");
            atomic_write(&target, body.as_bytes()).await?;
        }

        // Wipe stale catique-* directories whose role left the bundle.
        let mut report = SyncReport::default();
        let mut entries = tokio::fs::read_dir(&skills_root).await?;
        while let Some(entry) = entries.next_entry().await? {
            let path = entry.path();
            if !path.is_dir() {
                continue;
            }
            let dirname = match path.file_name().and_then(|n| n.to_str()) {
                Some(n) => n.to_owned(),
                None => continue,
            };
            if !has_catique_prefix(&dirname) {
                report.skipped.push(dirname);
                continue;
            }
            let skill_md = path.join("SKILL.md");
            let content = tokio::fs::read_to_string(&skill_md)
                .await
                .unwrap_or_default();
            if !is_catique_managed(&content) {
                // catique-prefixed directory but no marker — defence
                // in depth, leave alone.
                report.skipped.push(dirname);
                continue;
            }
            if wanted_dirs.contains(&dirname) {
                report.written.push(skill_md.to_string_lossy().into_owned());
            } else {
                tokio::fs::remove_dir_all(&path).await?;
                report.removed.push(path.to_string_lossy().into_owned());
            }
        }

        // MCP slot in `~/.codex/config.toml`.
        if let Some(mcp) = bundle.mcp.as_ref() {
            mutate_codex_toml(&Self::mcp_config_path()?, |doc| {
                upsert_mcp_table(doc, mcp);
            })
            .await?;
        }

        Ok(report)
    }

    async fn remove(&self) -> Result<RemoveReport, ProviderError> {
        let skills_root = Self::skills_root()?;
        let mut removed: Vec<String> = Vec::new();
        let mut skipped: Vec<String> = Vec::new();

        if tokio::fs::metadata(&skills_root).await.is_ok() {
            let mut entries = tokio::fs::read_dir(&skills_root).await?;
            while let Some(entry) = entries.next_entry().await? {
                let path = entry.path();
                if !path.is_dir() {
                    continue;
                }
                let dirname = match path.file_name().and_then(|n| n.to_str()) {
                    Some(n) => n.to_owned(),
                    None => continue,
                };
                if !has_catique_prefix(&dirname) {
                    skipped.push(dirname);
                    continue;
                }
                let skill_md = path.join("SKILL.md");
                let content = tokio::fs::read_to_string(&skill_md)
                    .await
                    .unwrap_or_default();
                if !is_catique_managed(&content) {
                    skipped.push(dirname);
                    continue;
                }
                tokio::fs::remove_dir_all(&path).await?;
                removed.push(path.to_string_lossy().into_owned());
            }
        }

        // Strip catique slot from config.toml if present.
        let mcp_path = Self::mcp_config_path()?;
        if tokio::fs::metadata(&mcp_path).await.is_ok() {
            mutate_codex_toml(&mcp_path, |doc| {
                remove_mcp_table(doc);
            })
            .await?;
            removed.push(format!(
                "{}#mcp_servers.{CATIQUE_MCP_KEY}",
                mcp_path.display()
            ));
        }

        Ok(RemoveReport { removed, skipped })
    }
}

// ---------------------------------------------------------------------
// TOML round-trip helpers (toml_edit preserves comments + ordering).
// ---------------------------------------------------------------------

async fn mutate_codex_toml<F>(path: &std::path::Path, mutate: F) -> Result<(), ProviderError>
where
    F: FnOnce(&mut DocumentMut),
{
    let raw = tokio::fs::read_to_string(path).await.unwrap_or_default();
    let mut doc: DocumentMut = if raw.trim().is_empty() {
        DocumentMut::new()
    } else {
        raw.parse::<DocumentMut>()?
    };
    mutate(&mut doc);
    let serialised = doc.to_string();
    atomic_write(path, serialised.as_bytes()).await?;
    Ok(())
}

/// Insert / overwrite `[mcp_servers.catique-hub]` with the entry's
/// shape. Keeps every other key in `mcp_servers` (and every other
/// top-level table) untouched.
fn upsert_mcp_table(doc: &mut DocumentMut, entry: &McpEntry) {
    // Ensure top-level `[mcp_servers]` exists.
    if !doc.contains_table("mcp_servers") {
        let mut t = Table::new();
        t.set_implicit(true);
        doc.insert("mcp_servers", Item::Table(t));
    }
    let servers_item = doc
        .get_mut("mcp_servers")
        .expect("inserted above if missing");

    // Foreign content shaped wrong (e.g. an inline table or an array
    // of tables) at the `mcp_servers` slot has nowhere safe for us to
    // mutate. The brief is "leave foreign content alone" *within*
    // mcp_servers; if the table itself is the wrong type we replace it.
    if servers_item.as_table_mut().is_none() {
        let mut t = Table::new();
        t.set_implicit(true);
        *servers_item = Item::Table(t);
    }
    let servers_table = servers_item
        .as_table_mut()
        .expect("table was inserted on the previous branch");

    // Build the catique-hub sub-table.
    let mut t = Table::new();
    t.insert("command", value(entry.command.clone()));
    let mut args_arr = toml_edit::Array::new();
    for a in &entry.args {
        args_arr.push(a.clone());
    }
    t.insert("args", value(args_arr));
    if !entry.env.is_empty() {
        let mut env_table = Table::new();
        for (k, v) in &entry.env {
            env_table.insert(k, value(v.clone()));
        }
        t.insert("env", Item::Table(env_table));
    }
    servers_table.insert(CATIQUE_MCP_KEY, Item::Table(t));
}

fn remove_mcp_table(doc: &mut DocumentMut) {
    let Some(servers_item) = doc.get_mut("mcp_servers") else {
        return;
    };
    let Some(table) = servers_item.as_table_mut() else {
        return;
    };
    table.remove(CATIQUE_MCP_KEY);
    // If the table is now empty AND we created it, leave it alone
    // anyway — the user may have meant to scope it to catique alone.
    // toml_edit keeps the empty table; not a problem for Codex.
}

// Keep the marker constant referenced in this module so unused-import
// warnings stay clean if frontmatter rendering moves later.
const _: &str = CATIQUE_MANAGED_KEY;
const _: &str = CATIQUE_FILE_PREFIX;

#[cfg(test)]
mod tests {
    use super::*;
    use crate::{McpEntry, ResolvedRole};
    use tempfile::TempDir;

    fn role(slug: &str) -> ResolvedRole {
        ResolvedRole {
            id: format!("r-{slug}"),
            slug: slug.into(),
            name: format!("Role {slug}"),
            content: format!("Body of {slug}"),
            prompts: vec![],
        }
    }

    #[test]
    fn id_and_caps() {
        let p = CodexProvider;
        assert_eq!(p.id(), "codex");
        assert_eq!(p.display_name(), "Codex");
        assert!(p.supports_agent_files());
        assert!(p.supports_mcp());
    }

    #[tokio::test]
    async fn upsert_creates_table_and_preserves_foreign_keys() {
        let tmp = TempDir::new().unwrap();
        let path = tmp.path().join("config.toml");
        // Pre-existing TOML with a foreign mcp_servers entry + a
        // top-level setting + a comment.
        tokio::fs::write(
            &path,
            "# user comment\n\
             model = \"gpt-4\"\n\
             \n\
             [mcp_servers.other]\n\
             command = \"/bin/foo\"\n",
        )
        .await
        .unwrap();

        mutate_codex_toml(&path, |doc| {
            upsert_mcp_table(
                doc,
                &McpEntry {
                    command: "/cat".into(),
                    args: vec!["serve".into()],
                    env: vec![("KEY".into(), "VAL".into())],
                },
            );
        })
        .await
        .unwrap();

        let after = tokio::fs::read_to_string(&path).await.unwrap();
        assert!(after.contains("# user comment"));
        assert!(after.contains("model = \"gpt-4\""));
        assert!(after.contains("[mcp_servers.other]"));
        assert!(after.contains("[mcp_servers.catique-hub]"));
        // Re-parse to assert the value shape.
        let doc: DocumentMut = after.parse().unwrap();
        assert_eq!(
            doc["mcp_servers"]["catique-hub"]["command"]
                .as_str()
                .unwrap(),
            "/cat"
        );
    }

    #[tokio::test]
    async fn sync_writes_skill_dirs_and_removes_stale() {
        let tmp = TempDir::new().unwrap();
        let skills = tmp.path().join("skills");
        tokio::fs::create_dir_all(&skills).await.unwrap();

        // Pre-existing stale managed skill dir.
        let stale = skills.join("catique-old");
        tokio::fs::create_dir_all(&stale).await.unwrap();
        tokio::fs::write(
            stale.join("SKILL.md"),
            "---\nname: \"old\"\ncatique_managed: true\n---\nbody",
        )
        .await
        .unwrap();

        // User-authored skill dir (no catique- prefix).
        let user = skills.join("user-skill");
        tokio::fs::create_dir_all(&user).await.unwrap();
        tokio::fs::write(user.join("SKILL.md"), "user body")
            .await
            .unwrap();

        // catique-prefixed but unmanaged: must survive.
        let unmanaged = skills.join("catique-handmade");
        tokio::fs::create_dir_all(&unmanaged).await.unwrap();
        tokio::fs::write(unmanaged.join("SKILL.md"), "no marker")
            .await
            .unwrap();

        // We can't override `home_dir` cheaply — exercise the inner
        // loop directly via the same logic the trait uses.
        let bundle = RoleBundle {
            roles: vec![role("alpha")],
            mcp: None,
        };
        let now = now_unix_ms();
        for r in &bundle.roles {
            let d = skills.join(format!("catique-{}", r.slug));
            tokio::fs::create_dir_all(&d).await.unwrap();
            atomic_write(&d.join("SKILL.md"), render_md_agent(r, now).as_bytes())
                .await
                .unwrap();
        }
        // Manual stale-cleanup mirrors `CodexProvider::sync`:
        let mut entries = tokio::fs::read_dir(&skills).await.unwrap();
        let wanted: std::collections::HashSet<String> = bundle
            .roles
            .iter()
            .map(|r| format!("catique-{}", r.slug))
            .collect();
        while let Some(entry) = entries.next_entry().await.unwrap() {
            let p = entry.path();
            if !p.is_dir() {
                continue;
            }
            let dn = p
                .file_name()
                .and_then(|n| n.to_str())
                .unwrap_or("")
                .to_owned();
            if !has_catique_prefix(&dn) || wanted.contains(&dn) {
                continue;
            }
            let body = tokio::fs::read_to_string(p.join("SKILL.md"))
                .await
                .unwrap_or_default();
            if is_catique_managed(&body) {
                tokio::fs::remove_dir_all(&p).await.unwrap();
            }
        }

        assert!(skills.join("catique-alpha/SKILL.md").exists());
        assert!(!skills.join("catique-old").exists(), "stale must be gone");
        assert!(
            skills.join("user-skill").exists(),
            "user-skill must survive"
        );
        assert!(
            skills.join("catique-handmade").exists(),
            "unmanaged catique-prefixed dir must survive"
        );
    }
}
