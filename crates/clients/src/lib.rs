//! Catique HUB — connected-provider layer.
//!
//! Round-21 (Connected Providers refactor): renamed
//! `ClientAdapter` → [`ClientProvider`], dropped the
//! "instructions file" + "registry-on-disk" surfaces, replaced
//! `detect/scan/sync_roles_to_client/list_synced_client_roles` with the
//! pair of async methods [`ClientProvider::sync`] and
//! [`ClientProvider::remove`]. Each provider now owns BOTH agent files
//! and managed MCP-server entries for that client.
//!
//! The brief, post-rename, is one sentence: "given a [`RoleBundle`]
//! resolved by the application layer, project the relevant on-disk
//! state for one provider, idempotently and atomically, without
//! touching foreign content".
//!
//! ## v1 provider set
//!
//! | id            | display name | agent files                                    | MCP                                    |
//! |---------------|--------------|------------------------------------------------|----------------------------------------|
//! | `claude-code` | Claude Code  | `~/.claude/agents/catique-<slug>.md`           | `~/.claude.json`                        |
//! | `codex`       | Codex        | `~/.agents/skills/catique-<slug>/SKILL.md`     | `~/.codex/config.toml`                  |
//! | `opencode`    | OpenCode     | `~/.config/opencode/agents/catique-<slug>.md`  | `~/.config/opencode/opencode.json`      |
//!
//! All three providers also report `supports_agent_files = true` and
//! `supports_mcp = true`. The `supports_*` accessors stay on the trait
//! so future providers (e.g. Claude Desktop, which is MCP-only) can opt
//! out of one or the other branch.
//!
//! ## Atomicity contract
//!
//! Every sync MUST write to `<target>.tmp` first and rename onto the
//! final path. JSON/TOML config files MUST be read in full, mutated in
//! place under the catique-owned key only, and written via the same
//! tmp+rename dance. Concurrent CLI launches that read the file at any
//! point during the operation must observe either the pre- or
//! post-state — never a torn write.

pub mod adapters;
mod error;

pub use error::ProviderError;

use async_trait::async_trait;

// ---------------------------------------------------------------------
// Bundle / report types — produced by the application layer, consumed
// by every [`ClientProvider`] impl. They live in this crate so the
// trait is self-contained (no circular dep on `catique-application`).
// ---------------------------------------------------------------------

/// Frontmatter marker key + value written at the top of every managed
/// agent file. Defence-in-depth alongside the `catique-` filename
/// prefix: a hand-edit that strips the marker leaves the file intact
/// (sync skips it next round); a hand-edit that strips the prefix is
/// caught by the marker check.
pub const CATIQUE_MANAGED_KEY: &str = "catique_managed";

/// MCP server entry name written into the catique-owned slot inside
/// every provider's MCP config. `~/.claude.json` →
/// `mcpServers["catique-hub"]`; Codex →
/// `[mcp_servers.catique-hub]`; OpenCode →
/// `mcp.catique-hub`.
pub const CATIQUE_MCP_KEY: &str = "catique-hub";

/// Filename prefix every catique-owned managed file MUST start with.
/// For Codex Skills the prefix lives on the *directory* name
/// (`catique-<slug>/`) rather than the file (`SKILL.md`).
pub const CATIQUE_FILE_PREFIX: &str = "catique-";

/// One prompt resolved + flattened by the application-layer inheritance
/// resolver. Mirrors the frontend's `Prompt` type after resolution.
#[derive(Debug, Clone)]
pub struct ResolvedPrompt {
    pub id: String,
    pub name: String,
    pub content: String,
}

/// One MCP tool resolved for inclusion in a rendered role file under
/// ADR-0008 (pass-through proxy).
///
/// The application layer resolves the qualified name per the
/// ADR-0005 round-21 amendment:
///
/// * `source = Manual` rows → `qualified_name = mcp_tool.name`. There
///   is no upstream server, so the qualifier carries the local name as-is.
/// * `source = Upstream` rows → `qualified_name = "{server.name}.{upstream_name}"`,
///   matching what Catique HUB's MCP `tools/list` advertises to
///   external agents.
///
/// `input_schema_json` is the JSON-encoded MCP `inputSchema` as stored
/// in `mcp_tools.schema_json`. The renderer ships it verbatim inside
/// the `<input-schema>` element, XML-escaping `<`, `>`, `&` only.
#[derive(Debug, Clone)]
pub struct ResolvedMcpTool {
    /// The `name` attribute on the rendered `<mcp-tool>` element.
    pub qualified_name: String,
    /// Optional one-line description (XML-escaped on render).
    pub description: Option<String>,
    /// JSON-encoded MCP `inputSchema` (XML-escaped on render).
    pub input_schema_json: String,
}

/// One Catique role resolved into a flat shape ready to be projected
/// onto a provider's on-disk format.
#[derive(Debug, Clone)]
pub struct ResolvedRole {
    /// Stable role id (DB primary key — see ctq-83 invariant).
    pub id: String,
    /// Kebab-case slug used in filenames + Codex skill directory names.
    /// MUST be `[a-z0-9-]+` — the application layer guarantees this.
    pub slug: String,
    /// Human-readable role name (rendered into frontmatter).
    pub name: String,
    /// Long-form role content (markdown body of the agent file).
    pub content: String,
    /// Attached prompts in resolver order.
    pub prompts: Vec<ResolvedPrompt>,
    /// MCP tools attached to the role. Rendered as `<mcp-tool>` XML
    /// blocks at the end of the agent file (ADR-0008 / ADR-0005
    /// round-21 amendment). Empty for roles with no tools.
    pub mcp_tools: Vec<ResolvedMcpTool>,
}

/// One MCP server entry destined for the catique-owned slot in a
/// provider's MCP config. The shape is intentionally minimal: the
/// stdio-launch convention is the same across all three providers
/// (command + args + env), so we don't try to model HTTP transports
/// here — extend the enum if/when a provider needs it.
#[derive(Debug, Clone)]
pub struct McpEntry {
    /// Executable to launch (absolute path, recommended).
    pub command: String,
    /// Argv for the launched process (positional CLI args).
    pub args: Vec<String>,
    /// Environment variables passed to the launched process.
    pub env: Vec<(String, String)>,
}

/// Complete payload one [`ClientProvider::sync`] call needs to do its
/// work. Built by the application layer using the existing inheritance
/// resolver.
#[derive(Debug, Clone)]
pub struct RoleBundle {
    pub roles: Vec<ResolvedRole>,
    pub mcp: Option<McpEntry>,
}

/// What [`ClientProvider::sync`] just did. Reported back so the
/// orchestrator can log + emit observability events without re-reading
/// the filesystem.
#[derive(Debug, Clone, Default)]
pub struct SyncReport {
    /// Absolute paths the sync wrote (created or overwrote).
    pub written: Vec<String>,
    /// Absolute paths the sync removed because the role no longer
    /// exists in the bundle.
    pub removed: Vec<String>,
    /// Filenames inside the agents directory the sync deliberately did
    /// not touch (no catique-managed marker).
    pub skipped: Vec<String>,
}

/// What [`ClientProvider::remove`] just did. Mirrors [`SyncReport`] but
/// with no "written" axis — `remove` only ever deletes.
#[derive(Debug, Clone, Default)]
pub struct RemoveReport {
    pub removed: Vec<String>,
    pub skipped: Vec<String>,
}

// ---------------------------------------------------------------------
// Trait
// ---------------------------------------------------------------------

/// Object-safe contract every connected provider implements.
///
/// Implementations live under [`adapters`]. The trait is `async` (sync
/// + remove are filesystem-bound) and uses [`async_trait`] to stay
/// boxable behind `Box<dyn ClientProvider>`.
#[async_trait]
pub trait ClientProvider: Send + Sync {
    /// Stable kebab-case identifier (e.g. `"claude-code"`).
    fn id(&self) -> &'static str;

    /// Human-readable display name shown in the Settings UI.
    fn display_name(&self) -> &'static str;

    /// `true` when this provider's `agents_dir` exists on disk —
    /// indicates the CLI/app is installed. Only consumed by the
    /// first-launch zero-state bootstrap; afterwards the user adds
    /// providers manually via the new modal.
    ///
    /// # Errors
    ///
    /// [`ProviderError::HomeDirUnavailable`] when `dirs::home_dir()`
    /// returns `None`. Filesystem stat failures collapse into
    /// `Ok(false)` so a permission-denied probe doesn't bubble all the
    /// way out to the IPC boundary.
    async fn detect(&self) -> Result<bool, ProviderError>;

    /// `true` when this provider supports managed agent files.
    fn supports_agent_files(&self) -> bool;

    /// `true` when this provider supports a managed MCP server entry.
    fn supports_mcp(&self) -> bool;

    /// Resolve a Catique role bundle to disk. Idempotent. Atomic per
    /// file (tmp+rename). Preserves foreign content. Returns the paths
    /// written / removed.
    ///
    /// Concretely the implementation MUST:
    ///
    /// 1. For each role in the bundle, render the agent file using the
    ///    provider's format and write it under the catique-managed
    ///    filename (`catique-<slug>.<ext>`) inside the provider's
    ///    agents directory. Atomic via tmp+rename.
    /// 2. Scan the agents directory for catique-managed files
    ///    (filename prefix + frontmatter marker) whose role is no
    ///    longer in the bundle and delete them.
    /// 3. If `bundle.mcp.is_some()` and `supports_mcp`, mutate the
    ///    catique-owned slot in the provider's MCP config; otherwise
    ///    leave the slot alone (do NOT auto-clear — `remove` does that).
    ///
    /// # Errors
    ///
    /// Any [`ProviderError`] surfaces unchanged. The orchestrator turns
    /// it into a `failing_providers` entry on `SyncStatus`.
    async fn sync(&self, bundle: &RoleBundle) -> Result<SyncReport, ProviderError>;

    /// Wipe every catique-owned agent file and the catique-owned MCP
    /// entry. Idempotent — re-calling on a clean tree is a no-op.
    /// MUST NOT touch files that lack the catique-managed marker.
    ///
    /// # Errors
    ///
    /// Any [`ProviderError`] surfaces unchanged.
    async fn remove(&self) -> Result<RemoveReport, ProviderError>;
}

/// Build the canonical ordered list of v1 providers.
///
/// The order determines display order in the "Add provider" modal and
/// in the `list_supported_providers` IPC.
#[must_use]
pub fn all_providers() -> Vec<Box<dyn ClientProvider>> {
    vec![
        Box::new(adapters::claude_code::ClaudeCodeProvider),
        Box::new(adapters::codex::CodexProvider),
        Box::new(adapters::opencode::OpenCodeProvider),
    ]
}
