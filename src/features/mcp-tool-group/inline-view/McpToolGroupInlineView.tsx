/**
 * McpToolGroupInlineView — right-pane MCP-tool-group surface, a faithful
 * mirror of the prompts page's `InlineGroupView`:
 *   - header: editable name/color + delete;
 *   - 2-column body:
 *     · left  — vertical sortable list of member `McpToolCard`s. The
 *       column is a drop target (`mcp-group-content:<id>`) so tools
 *       dragged from the server tree are added; each card has a drag
 *       handle (reorder) + remove (×);
 *     · right — XML preview of the group's tools as the agent sees them.
 *
 * DnD (reorder + drop-to-add) is owned by `McpServersPage`'s
 * `<DragDropProvider>`; this view only declares the droppable column and
 * the sortable cards, and consumes `orderOverride` for optimistic order.
 */

import { useCallback, useMemo, type ReactElement } from "react";
import { useDroppable } from "@dnd-kit/react";
import { useSortable } from "@dnd-kit/react/sortable";

import {
  useMcpToolGroup,
  useMcpToolGroupMembers,
  useUpdateMcpToolGroupMutation,
  useDeleteMcpToolGroupMutation,
  useRemoveMcpToolGroupMemberMutation,
} from "@entities/mcp-tool-group";
import { McpToolCard, useMcpTools, type McpTool } from "@entities/mcp-tool";
import { useMcpServers } from "@entities/mcp-server";
import { EntityActionMenu, EntityTitle, Scrollable } from "@shared/ui";
import { useToast } from "@shared/lib";

import styles from "./McpToolGroupInlineView.module.css";

export interface McpToolGroupInlineViewProps {
  groupId: string;
  /** Called after the group is deleted so the parent can clear selection. */
  onDeleted: () => void;
  /** Open a tool (navigate to its detail) when a member card is clicked. */
  onSelectTool?: (serverId: string, toolId: string) => void;
  /**
   * Optimistic order of member ids during a drag (prefixed `member:<id>`).
   * Falls back to the server order when null.
   */
  orderOverride?: ReadonlyArray<string> | null;
}

export function McpToolGroupInlineView({
  groupId,
  onDeleted,
  onSelectTool,
  orderOverride = null,
}: McpToolGroupInlineViewProps): ReactElement {
  const groupQuery = useMcpToolGroup(groupId);
  const membersQuery = useMcpToolGroupMembers(groupId);
  const toolsQuery = useMcpTools();
  const serversQuery = useMcpServers();
  const updateMutation = useUpdateMcpToolGroupMutation();
  const deleteMutation = useDeleteMcpToolGroupMutation();
  const removeMember = useRemoveMcpToolGroupMemberMutation();
  const { pushToast } = useToast();

  // Drop target — a tool dragged from the server tree lands here. The
  // sidebar group row uses a different id (`mcp-group:<id>`); both route
  // to the same add-member mutation in `McpServersPage`.
  const { ref, isDropTarget } = useDroppable({
    id: `mcp-group-content:${groupId}`,
    type: "mcp-group",
    accept: ["mcp-tool"],
  });

  const serverNameById = useMemo(() => {
    const map = new Map<string, string>();
    for (const s of serversQuery.data ?? []) map.set(s.id, s.name);
    return map;
  }, [serversQuery.data]);

  const memberTools = useMemo<McpTool[]>(() => {
    const rawIds = orderOverride ?? membersQuery.data ?? [];
    const ids = rawIds.map((id) =>
      id.startsWith("member:") ? id.slice("member:".length) : id,
    );
    const byId = new Map((toolsQuery.data ?? []).map((t) => [t.id, t]));
    const out: McpTool[] = [];
    for (const id of ids) {
      const tool = byId.get(id);
      if (tool) out.push(tool);
    }
    return out;
  }, [orderOverride, membersQuery.data, toolsQuery.data]);

  const handleRename = useCallback(
    (next: string) => updateMutation.mutate({ id: groupId, name: next }),
    [updateMutation, groupId],
  );
  const handleAppearance = useCallback(
    (next: { icon: string | null; color: string | null }) =>
      updateMutation.mutate({ id: groupId, icon: next.icon, color: next.color }),
    [updateMutation, groupId],
  );
  const handleDelete = useCallback(() => {
    deleteMutation.mutate(groupId, {
      onSuccess: onDeleted,
      onError: (err) =>
        pushToast("error", `Failed to delete group: ${err.message}`),
    });
  }, [deleteMutation, groupId, onDeleted, pushToast]);

  const handleRemoveFromGroup = useCallback(
    (toolId: string) => {
      removeMember.mutate(
        { groupId, mcpToolId: toolId },
        {
          onError: (err) =>
            pushToast("error", `Failed to remove tool: ${err.message}`),
        },
      );
    },
    [removeMember, groupId, pushToast],
  );

  if (groupQuery.status === "pending") {
    return (
      <section className={styles.root} data-testid="mcp-tool-group-inline-view">
        <p className={styles.dropHint}>Loading group…</p>
      </section>
    );
  }
  if (groupQuery.status === "error" || !groupQuery.data) {
    return (
      <section className={styles.root} data-testid="mcp-tool-group-inline-view">
        <div className={styles.errorBanner} role="alert">
          {groupQuery.status === "error"
            ? `Failed to load group: ${groupQuery.error.message}`
            : "Group not found."}
        </div>
      </section>
    );
  }

  const group = groupQuery.data;
  const groupSortableKey = `mcp-group-members-${groupId}`;

  return (
    <section
      className={styles.root}
      aria-label={`MCP tool group ${group.name}`}
      data-testid="mcp-tool-group-inline-view"
    >
      <header className={styles.header}>
        <EntityTitle
          size="lg"
          editable
          name={group.name}
          onNameChange={handleRename}
          value={{ icon: group.icon ?? null, color: group.color ?? null }}
          onAppearanceChange={handleAppearance}
          pickerAriaLabel="Group icon and color"
          actions={
            <EntityActionMenu
              items={[{ id: "delete", label: "Delete", onAction: handleDelete }]}
              triggerAriaLabel="Group actions"
              triggerTestId="mcp-tool-group-inline-view-menu"
            />
          }
        />
      </header>

      <div className={styles.body}>
        <div
          ref={(el) => ref(el)}
          className={styles.listColumn}
          data-drop-target={isDropTarget ? "true" : undefined}
          data-testid="mcp-tool-group-inline-view-drop-zone"
        >
          <Scrollable axis="y" className={styles.listScroll}>
            <div className={styles.listInner}>
              {memberTools.length === 0 ? (
                <div className={styles.empty}>
                  <p className={styles.emptyTitle}>No tools in this group yet</p>
                  <p className={styles.emptyHint}>
                    Drag tools from the server list onto the group to add them.
                  </p>
                </div>
              ) : (
                memberTools.map((tool, index) => (
                  <SortableMemberCard
                    key={tool.id}
                    tool={tool}
                    index={index}
                    groupSortableKey={groupSortableKey}
                    serverName={
                      tool.serverId != null
                        ? serverNameById.get(tool.serverId) ?? null
                        : null
                    }
                    {...(onSelectTool && tool.serverId != null
                      ? {
                          onSelect: () =>
                            onSelectTool(tool.serverId as string, tool.id),
                        }
                      : {})}
                    onRemove={handleRemoveFromGroup}
                    isRemoving={removeMember.isPending}
                  />
                ))
              )}
            </div>
          </Scrollable>
        </div>

        <div className={styles.previewColumn}>
          <div className={styles.previewHeader}>
            <span>Task XML preview</span>
            <span className={styles.tokenChip}>{memberTools.length} tools</span>
          </div>
          <Scrollable axis="y" className={styles.previewBody}>
            <div className={styles.previewBodyInner}>
              {memberTools.length === 0 ? (
                <p className={styles.previewEmpty}>
                  Add tools to see how they'll render to an agent.
                </p>
              ) : (
                <McpToolsXmlPreview
                  tools={memberTools}
                  groupName={group.name}
                  serverNameById={serverNameById}
                />
              )}
            </div>
          </Scrollable>
        </div>
      </div>
    </section>
  );
}

// ─────────────────────────────────────────────────────────────────────
// Sortable member card (mirror of InlineGroupView's SortableMemberCard)
// ─────────────────────────────────────────────────────────────────────

interface SortableMemberCardProps {
  tool: McpTool;
  index: number;
  groupSortableKey: string;
  serverName: string | null;
  onSelect?: () => void;
  onRemove: (toolId: string) => void;
  isRemoving: boolean;
}

function SortableMemberCard({
  tool,
  index,
  groupSortableKey,
  serverName,
  onSelect,
  onRemove,
  isRemoving,
}: SortableMemberCardProps): ReactElement {
  const { ref, handleRef, isDragging } = useSortable({
    id: `member:${tool.id}`,
    index,
    group: groupSortableKey,
    type: "mcp-group-member-tool",
    accept: ["mcp-group-member-tool"],
  });

  return (
    <div
      ref={(el) => ref(el)}
      className={styles.cardCell}
      data-dragging={isDragging ? "true" : undefined}
      data-testid={`mcp-tool-group-inline-view-card-${tool.id}`}
    >
      <button
        type="button"
        ref={(el) => handleRef(el)}
        className={styles.dragHandle}
        aria-label={`Reorder ${tool.name}`}
        data-testid={`mcp-tool-group-inline-view-handle-${tool.id}`}
        onMouseDown={(e) => e.preventDefault()}
      >
        <span aria-hidden="true">⋮⋮</span>
      </button>
      <button
        type="button"
        className={styles.removeButton}
        onClick={() => onRemove(tool.id)}
        disabled={isRemoving}
        aria-label={`Remove ${tool.name} from group`}
        data-testid={`mcp-tool-group-inline-view-remove-${tool.id}`}
      >
        <span aria-hidden="true">×</span>
      </button>
      <McpToolCard
        tool={tool}
        {...(onSelect ? { onSelect: () => onSelect() } : {})}
        className={styles.cardInner}
      />
      {serverName ? (
        <span className={styles.serverBadge} aria-hidden="true">
          {serverName}
        </span>
      ) : null}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────
// XML preview
// ─────────────────────────────────────────────────────────────────────

interface McpToolsXmlPreviewProps {
  tools: ReadonlyArray<McpTool>;
  groupName: string;
  serverNameById: Map<string, string>;
}

function escapeXml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function McpToolsXmlPreview({
  tools,
  groupName,
  serverNameById,
}: McpToolsXmlPreviewProps): ReactElement {
  return (
    <pre
      className={styles.previewXml}
      data-testid="mcp-tool-group-inline-view-xml-preview"
    >
      <span>{`<mcp_tools group="${escapeXml(groupName)}">\n`}</span>
      {tools.map((tool) => {
        const serverName =
          tool.serverId != null ? serverNameById.get(tool.serverId) : undefined;
        const attrs = serverName
          ? `name="${escapeXml(tool.name)}" server="${escapeXml(serverName)}"`
          : `name="${escapeXml(tool.name)}"`;
        const lines: string[] = [`  <tool ${attrs}>`];
        if (tool.description != null && tool.description.length > 0) {
          lines.push(
            `    <description>${escapeXml(tool.description)}</description>`,
          );
        }
        if (tool.schemaJson && tool.schemaJson !== "{}") {
          const schema = tool.schemaJson
            .split("\n")
            .map((line) => `      ${line}`)
            .join("\n");
          lines.push(`    <schema>\n${schema}\n    </schema>`);
        }
        lines.push(`  </tool>`);
        return (
          <span
            key={tool.id}
            className={styles.toolBlock}
            data-tool-id={tool.id}
          >
            {lines.join("\n")}
            {"\n"}
          </span>
        );
      })}
      <span>{`</mcp_tools>`}</span>
    </pre>
  );
}
