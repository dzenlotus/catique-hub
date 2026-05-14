//! Provider for **OpenCode** (community-maintained agentic CLI).
//!
//! ## Paths
//!
//! - Config root: `~/.config/opencode/`
//! - Agent files: `~/.config/opencode/agents/catique-<role-slug>.md`
//! - MCP config:  `~/.config/opencode/opencode.json`, key-scoped to
//!   `mcp.catique-hub`.
//!
//! ## Atomicity rules
//!
//! Same shape as Claude Code: agent files via tmp+rename, JSON config
//! file mutated under the catique-owned key only.

use std::path::PathBuf;

use async_trait::async_trait;
use serde_json::{Map, Value};

use crate::{
    adapters::{
        claude_code::{build_sync_report, remove_managed_files_in_dir, sync_md_agents},
        common::{atomic_write, home_dir},
    },
    ClientProvider, McpEntry, ProviderError, RemoveReport, RoleBundle, SyncReport, CATIQUE_MCP_KEY,
};

/// Provider for the OpenCode agentic CLI.
pub struct OpenCodeProvider;

impl OpenCodeProvider {
    /// `~/.config/opencode/`
    fn config_dir() -> Result<PathBuf, ProviderError> {
        Ok(home_dir()?.join(".config").join("opencode"))
    }
    /// `~/.config/opencode/agents/`
    fn agents_dir() -> Result<PathBuf, ProviderError> {
        Ok(Self::config_dir()?.join("agents"))
    }
    /// `~/.config/opencode/opencode.json`
    fn mcp_config_path() -> Result<PathBuf, ProviderError> {
        Ok(Self::config_dir()?.join("opencode.json"))
    }
    /// `catique-<slug>.md`
    fn agent_filename(slug: &str) -> String {
        format!("catique-{slug}.md")
    }
}

#[async_trait]
impl ClientProvider for OpenCodeProvider {
    fn id(&self) -> &'static str {
        "opencode"
    }
    fn display_name(&self) -> &'static str {
        "OpenCode"
    }
    fn supports_agent_files(&self) -> bool {
        true
    }
    fn supports_mcp(&self) -> bool {
        true
    }

    async fn detect(&self) -> Result<bool, ProviderError> {
        let dir = Self::config_dir()?;
        Ok(tokio::fs::metadata(&dir).await.is_ok())
    }

    async fn sync(&self, bundle: &RoleBundle) -> Result<SyncReport, ProviderError> {
        let agents_dir = Self::agents_dir()?;
        sync_md_agents(&agents_dir, bundle, OpenCodeProvider::agent_filename).await?;
        let report = build_sync_report(&agents_dir, bundle).await?;

        if let Some(mcp) = bundle.mcp.as_ref() {
            mutate_opencode_json(&Self::mcp_config_path()?, |mcp_map| {
                mcp_map.insert(CATIQUE_MCP_KEY.to_string(), mcp_entry_to_value(mcp));
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

        let mcp_path = Self::mcp_config_path()?;
        if tokio::fs::metadata(&mcp_path).await.is_ok() {
            mutate_opencode_json(&mcp_path, |mcp_map| {
                mcp_map.remove(CATIQUE_MCP_KEY);
            })
            .await?;
            removed.push(format!("{}#mcp.{CATIQUE_MCP_KEY}", mcp_path.display()));
        }

        Ok(RemoveReport { removed, skipped })
    }
}

/// Read OpenCode's JSON config (or create empty), find/insert the
/// `mcp` object, mutate the catique-owned key inside it, write back
/// atomically. Foreign keys (other `mcp` entries, plus every other
/// top-level OpenCode setting) are preserved.
async fn mutate_opencode_json<F>(path: &std::path::Path, mutate: F) -> Result<(), ProviderError>
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
        .ok_or_else(|| ProviderError::Malformed("opencode.json is not a JSON object".into()))?;

    let mcp_entry = obj
        .entry("mcp")
        .or_insert_with(|| Value::Object(Map::new()));
    let mcp_map = mcp_entry.as_object_mut().ok_or_else(|| {
        ProviderError::Malformed("`mcp` in opencode.json is not an object".into())
    })?;
    mutate(mcp_map);

    let serialised = serde_json::to_vec_pretty(&root)?;
    atomic_write(path, &serialised).await?;
    Ok(())
}

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
    use crate::ResolvedRole;
    use tempfile::TempDir;

    #[test]
    fn id_and_capabilities() {
        let p = OpenCodeProvider;
        assert_eq!(p.id(), "opencode");
        assert_eq!(p.display_name(), "OpenCode");
        assert!(p.supports_agent_files());
        assert!(p.supports_mcp());
    }

    #[tokio::test]
    async fn mutate_opencode_json_preserves_foreign_top_level_keys() {
        let tmp = TempDir::new().unwrap();
        let path = tmp.path().join("opencode.json");
        let pre = serde_json::json!({
            "theme": "dark",
            "model": "gpt-4",
            "mcp": {"other": {"command": "/bin/bar"}}
        });
        tokio::fs::write(&path, serde_json::to_string_pretty(&pre).unwrap())
            .await
            .unwrap();

        mutate_opencode_json(&path, |mcp| {
            mcp.insert(
                CATIQUE_MCP_KEY.into(),
                serde_json::json!({"command": "/c", "args": []}),
            );
        })
        .await
        .unwrap();

        let v: Value =
            serde_json::from_str(&tokio::fs::read_to_string(&path).await.unwrap()).unwrap();
        assert_eq!(v["theme"], "dark");
        assert_eq!(v["model"], "gpt-4");
        assert_eq!(v["mcp"]["other"]["command"], "/bin/bar");
        assert_eq!(v["mcp"]["catique-hub"]["command"], "/c");
    }

    #[tokio::test]
    async fn sync_md_agents_writes_opencode_files() {
        let tmp = TempDir::new().unwrap();
        let agents_dir = tmp.path().join("agents");
        let bundle = RoleBundle {
            roles: vec![ResolvedRole {
                id: "r1".into(),
                slug: "reviewer".into(),
                name: "Reviewer".into(),
                content: "Be thorough.".into(),
                prompts: vec![],
                mcp_tools: vec![],
                skills: vec![],
            }],
            mcp: None,
        };
        sync_md_agents(&agents_dir, &bundle, OpenCodeProvider::agent_filename)
            .await
            .unwrap();
        assert!(agents_dir.join("catique-reviewer.md").exists());
    }
}
