//! Workflow-graph model + serializer — catique-5.
//!
//! Encodes the visual "how agents interact" graph the user composes on
//! the auto-generated Workflow board. The graph is stored as JSON in
//! the existing `spaces.workflow_graph_json` column (no migration
//! needed). Two operations live here:
//!
//!   1. [`WorkflowGraph`] — typed shape parsed from / serialised to
//!      `spaces.workflow_graph_json`.
//!   2. [`render_prompt`] — flatten the graph into a Markdown / DSL
//!      paragraph block ready to write into the project's agent
//!      file (`AGENTS.md` / `CLAUDE.md`) via
//!      [`crate::agent_files::upsert_section`].
//!
//! The UI editor (React Flow stub) is out of scope for this module —
//! the editor reads/writes `workflow_graph_json` through ordinary
//! space update IPCs, and re-renders this prompt body server-side on
//! save so the agent file always reflects the latest graph.

use serde::{Deserialize, Serialize};

/// Top-level graph blob stored under `spaces.workflow_graph_json`.
/// Forward-compatible: an unknown field deserialises into `extra` so
/// older versions of the app do not lose data written by newer ones.
#[derive(Debug, Clone, Default, Serialize, Deserialize, PartialEq)]
pub struct WorkflowGraph {
    /// Schema version. `1` for the initial cut. Bump when the on-disk
    /// shape changes incompatibly.
    #[serde(default = "default_version")]
    pub version: u32,
    /// Agent nodes — each is one role on the canvas.
    #[serde(default)]
    pub nodes: Vec<AgentNode>,
    /// Directed edges between nodes.
    #[serde(default)]
    pub edges: Vec<WorkflowEdge>,
}

fn default_version() -> u32 {
    1
}

/// One node on the canvas — a role with input/output port + optional
/// owning column. The role itself lives in the `roles` table; we just
/// reference its id here so the editor stays a pure layout layer.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct AgentNode {
    pub id: String,
    pub role_id: String,
    /// Optional: when set, this node represents the role's column on
    /// the workflow board (where tasks land for that role).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub column_id: Option<String>,
    /// React-flow X/Y for the editor — backend treats them as opaque.
    #[serde(default)]
    pub x: f32,
    #[serde(default)]
    pub y: f32,
}

/// One directed edge between two nodes. `kind` carries the semantics
/// the serializer turns into prose.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct WorkflowEdge {
    pub id: String,
    pub from_node: String,
    pub to_node: String,
    pub kind: EdgeKind,
    /// Optional free-form label the user can type on the edge. Wins
    /// over the canned prose when present.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub label: Option<String>,
}

/// Canonical edge kinds. Each maps to a sentence template in
/// [`render_prompt`]. Extending the vocabulary is additive — add a
/// variant + a matching arm.
#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "kebab-case")]
pub enum EdgeKind {
    /// Assign a task to the downstream node (default routing).
    Assign,
    /// Hand off when the upstream node finishes successfully.
    RouteOnSuccess,
    /// Hand off when the upstream node rejects (return-for-rework).
    RouteOnReject,
    /// Escalate (notify) without taking ownership.
    Escalate,
    /// Free-form related (no automated routing implied).
    Related,
}

impl EdgeKind {
    fn template(self) -> &'static str {
        match self {
            EdgeKind::Assign => "assigns the task to",
            EdgeKind::RouteOnSuccess => "on success, hands the task to",
            EdgeKind::RouteOnReject => "on rejection, returns the task to",
            EdgeKind::Escalate => "escalates (notifies)",
            EdgeKind::Related => "is related to",
        }
    }
}

/// Resolver passed to [`render_prompt`] — turns role / node ids into
/// human-readable names. The editor side keeps a name cache; the IPC
/// handler builds a lookup from the freshly-read `roles` table.
pub trait NodeNameLookup {
    fn role_name(&self, role_id: &str) -> Option<String>;
    fn node_label(&self, node: &AgentNode) -> String {
        self.role_name(&node.role_id)
            .unwrap_or_else(|| node.role_id.clone())
    }
}

/// Render `graph` as a Markdown block suitable for dropping into the
/// agent file's catique-hub-managed section. Stable across re-renders
/// of the same input — the function is deterministic so
/// `agent_files::upsert_section` produces a no-op diff when nothing
/// changed.
#[must_use]
pub fn render_prompt<L: NodeNameLookup>(graph: &WorkflowGraph, lookup: &L) -> String {
    let mut out = String::new();
    out.push_str("## Workflow\n\n");
    if graph.nodes.is_empty() {
        out.push_str("_No workflow nodes configured yet._\n");
        return out;
    }

    out.push_str("Participants:\n\n");
    let mut node_lookup = std::collections::HashMap::<&str, String>::new();
    let mut nodes_sorted: Vec<&AgentNode> = graph.nodes.iter().collect();
    nodes_sorted.sort_by(|a, b| a.id.cmp(&b.id));
    for node in &nodes_sorted {
        let name = lookup.node_label(node);
        node_lookup.insert(node.id.as_str(), name.clone());
        out.push_str(&format!("- **{name}** (`{}`)\n", node.id));
    }

    if graph.edges.is_empty() {
        out.push_str("\n_No routing edges configured._\n");
        return out;
    }

    out.push_str("\nRouting:\n\n");
    let mut edges_sorted: Vec<&WorkflowEdge> = graph.edges.iter().collect();
    edges_sorted.sort_by(|a, b| a.id.cmp(&b.id));
    for edge in &edges_sorted {
        let from = node_lookup
            .get(edge.from_node.as_str())
            .cloned()
            .unwrap_or_else(|| edge.from_node.clone());
        let to = node_lookup
            .get(edge.to_node.as_str())
            .cloned()
            .unwrap_or_else(|| edge.to_node.clone());
        let verb = edge.label.as_deref().unwrap_or_else(|| edge.kind.template());
        out.push_str(&format!("- **{from}** {verb} **{to}**.\n"));
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    struct StaticLookup<'a>(&'a [(&'a str, &'a str)]);
    impl<'a> NodeNameLookup for StaticLookup<'a> {
        fn role_name(&self, role_id: &str) -> Option<String> {
            self.0
                .iter()
                .find(|(k, _)| *k == role_id)
                .map(|(_, v)| (*v).to_owned())
        }
    }

    fn sample_graph() -> WorkflowGraph {
        WorkflowGraph {
            version: 1,
            nodes: vec![
                AgentNode {
                    id: "n1".into(),
                    role_id: "owner".into(),
                    column_id: Some("c1".into()),
                    x: 0.0,
                    y: 0.0,
                },
                AgentNode {
                    id: "n2".into(),
                    role_id: "reviewer".into(),
                    column_id: Some("c2".into()),
                    x: 200.0,
                    y: 0.0,
                },
            ],
            edges: vec![
                WorkflowEdge {
                    id: "e1".into(),
                    from_node: "n1".into(),
                    to_node: "n2".into(),
                    kind: EdgeKind::RouteOnSuccess,
                    label: None,
                },
                WorkflowEdge {
                    id: "e2".into(),
                    from_node: "n2".into(),
                    to_node: "n1".into(),
                    kind: EdgeKind::RouteOnReject,
                    label: None,
                },
            ],
        }
    }

    #[test]
    fn json_roundtrip_preserves_shape() {
        let g = sample_graph();
        let json = serde_json::to_string(&g).unwrap();
        let parsed: WorkflowGraph = serde_json::from_str(&json).unwrap();
        assert_eq!(g, parsed);
    }

    #[test]
    fn render_includes_participants_and_routing() {
        let g = sample_graph();
        let lookup = StaticLookup(&[("owner", "Owner"), ("reviewer", "Reviewer")]);
        let out = render_prompt(&g, &lookup);
        assert!(out.contains("**Owner**"));
        assert!(out.contains("**Reviewer**"));
        assert!(out.contains("on success, hands the task to"));
        assert!(out.contains("on rejection, returns the task to"));
    }

    #[test]
    fn render_is_deterministic() {
        let g = sample_graph();
        let lookup = StaticLookup(&[("owner", "O"), ("reviewer", "R")]);
        let a = render_prompt(&g, &lookup);
        let b = render_prompt(&g, &lookup);
        assert_eq!(a, b, "render must be deterministic for upsert idempotency");
    }

    #[test]
    fn render_empty_graph() {
        let g = WorkflowGraph::default();
        let lookup = StaticLookup(&[]);
        let out = render_prompt(&g, &lookup);
        assert!(out.contains("No workflow nodes configured"));
    }

    #[test]
    fn render_no_edges_only_participants() {
        let mut g = sample_graph();
        g.edges.clear();
        let lookup = StaticLookup(&[("owner", "O"), ("reviewer", "R")]);
        let out = render_prompt(&g, &lookup);
        assert!(out.contains("Participants"));
        assert!(out.contains("No routing edges configured"));
    }

    #[test]
    fn custom_label_overrides_canned_verb() {
        let mut g = sample_graph();
        g.edges[0].label = Some("ships the spec to".into());
        let lookup = StaticLookup(&[("owner", "O"), ("reviewer", "R")]);
        let out = render_prompt(&g, &lookup);
        assert!(out.contains("ships the spec to"));
        assert!(!out.contains("on success, hands the task to"));
    }

    #[test]
    fn unknown_role_falls_back_to_id() {
        let g = WorkflowGraph {
            version: 1,
            nodes: vec![AgentNode {
                id: "n1".into(),
                role_id: "ghost".into(),
                column_id: None,
                x: 0.0,
                y: 0.0,
            }],
            edges: vec![],
        };
        let lookup = StaticLookup(&[]);
        let out = render_prompt(&g, &lookup);
        // Falls back to the role_id when the role name lookup fails.
        assert!(out.contains("**ghost**"));
    }
}
