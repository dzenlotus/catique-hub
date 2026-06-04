/**
 * McpServersPage — master-detail shell for /mcp-servers.
 *
 * Round-26 (Row/Group split): rail composes `<RailSection>` +
 * `<Group>` (servers) + `<Row>` (tools) directly. URL drives the
 * selection state:
 *
 *   /mcp-servers                          → overview pane.
 *   /mcp-servers/:serverId                → server detail pane.
 *   /mcp-servers/:serverId/tools/:toolId  → tool detail pane.
 *
 * The "+" trigger in the rail opens `McpServerCreateDialog` —
 * modal-only-for-creation invariant.
 *
 * Row testids use namespaced ids (`srv:<id>` / `tool:<id>`) so a
 * single `selectedId` highlights one row at a time across both levels.
 */

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactElement,
} from "react";
import {
  useLocationCompat as useLocation,
  useRouteCompat as useRoute,
  useToast,
} from "@shared/lib";
import { useQueries } from "@tanstack/react-query";
import { DragDropProvider } from "@dnd-kit/react";
import type {
  DragEndEvent,
  DragOverEvent,
  DragStartEvent,
} from "@dnd-kit/react";
import { move } from "@dnd-kit/helpers";

import {
  listMcpToolsByServer,
  mcpServersKeys,
  useMcpServers,
  type McpServer,
} from "@entities/mcp-server";
import type { McpTool } from "@bindings/McpTool";
import {
  listMcpToolGroupMembers,
  mcpToolGroupsKeys,
  useMcpToolGroups,
  useAddMcpToolGroupMemberMutation,
  useSetMcpToolGroupMembersMutation,
  type McpToolGroup,
} from "@entities/mcp-tool-group";
import {
  EntityTree,
  type EntityTreeNode,
  RowLabelButton,
  Scrollable,
  SidebarSectionDivider,
  SidebarShell,
} from "@shared/ui";
import { SidebarSectionAddTrigger } from "@shared/ui/SidebarShell";
import { McpServerCreateDialog } from "@features/mcp-server/create-dialog";
import { McpToolGroupCreateDialog } from "@features/mcp-tool-group/create-dialog";
import { McpToolGroupInlineView } from "@features/mcp-tool-group/inline-view";
import { entityPageShellStyles as shellStyles } from "@widgets/entity-page-shell";
import {
  mcpServerPath,
  mcpServerToolPath,
  routes,
} from "@app/routes";

import { McpServersOverview } from "./McpServersOverview";
import { McpServerDetailPanel } from "./McpServerDetailPanel";
import { McpToolDetailPanel } from "./McpToolDetailPanel";

export function McpServersPage(): ReactElement {
  const serversQuery = useMcpServers();
  const groupsQuery = useMcpToolGroups();
  const [, setLocation] = useLocation();
  const [, toolParams] = useRoute<{ serverId: string; toolId: string }>(
    routes.mcpServerTool,
  );
  const [, serverParams] = useRoute<{ serverId: string }>(routes.mcpServer);
  const [isCreateOpen, setIsCreateOpen] = useState(false);
  const [isGroupCreateOpen, setIsGroupCreateOpen] = useState(false);
  // Group selection is page-local (no dedicated route); selecting a
  // server/tool clears it so the URL-driven panes take over.
  const [selectedGroupId, setSelectedGroupId] = useState<string | null>(null);

  const selectedToolId = toolParams?.toolId ?? null;
  const selectedServerId =
    toolParams?.serverId ?? serverParams?.serverId ?? null;

  const groups = useMemo<ReadonlyArray<McpToolGroup>>(
    () => groupsQuery.data ?? [],
    [groupsQuery.data],
  );
  const groupsTreeData = useMemo<EntityTreeNode<McpToolGroup>[]>(
    () => groups.map((g) => ({ id: g.id, label: g.name, data: g })),
    [groups],
  );

  const handleSelectGroup = (groupId: string): void => {
    setSelectedGroupId(groupId);
    // Drop any server/tool route selection so the group pane shows.
    setLocation(routes.mcpServers);
  };

  // ── Drag-and-drop ───────────────────────────────────────────────────
  // Mirrors PromptsPage: tools dragged from the server tree are added to
  // a group (drop on the sidebar group row OR the inline view), and
  // member cards inside the inline view reorder via an optimistic bucket.
  const addGroupMember = useAddMcpToolGroupMemberMutation();
  const setGroupMembers = useSetMcpToolGroupMembersMutation();
  const { pushToast } = useToast();

  const memberQueries = useQueries({
    queries: groups.map((group) => ({
      queryKey: mcpToolGroupsKeys.members(group.id),
      queryFn: () => listMcpToolGroupMembers(group.id),
    })),
  });
  const groupMembers = useMemo<Record<string, string[]>>(() => {
    const map: Record<string, string[]> = {};
    groups.forEach((group, idx) => {
      const data = memberQueries[idx]?.data;
      if (Array.isArray(data)) map[group.id] = data;
    });
    return map;
  }, [groups, memberQueries]);

  // Optimistic reorder state for the inline view's sortable cards.
  const [reorderGroupId, setReorderGroupId] = useState<string | null>(null);
  const [reorderItems, setReorderItems] = useState<Record<string, string[]>>({});
  const reorderItemsRef = useRef<Record<string, string[]>>({});

  const handleDragStart = useCallback(
    (event: DragStartEvent): void => {
      if (event.operation.source?.type !== "mcp-group-member-tool") return;
      // Only one group's members are visible at a time (the selected one).
      if (selectedGroupId === null) return;
      const initial = (groupMembers[selectedGroupId] ?? []).map(
        (id) => `member:${id}`,
      );
      const bucket = { [`mcp-group-members-${selectedGroupId}`]: initial };
      reorderItemsRef.current = bucket;
      setReorderItems(bucket);
      setReorderGroupId(selectedGroupId);
    },
    [selectedGroupId, groupMembers],
  );

  const handleDragOver = useCallback(
    (event: DragOverEvent): void => {
      if (reorderGroupId === null) return;
      setReorderItems((current) => {
        const next = move(current, event);
        reorderItemsRef.current = next;
        return next;
      });
    },
    [reorderGroupId],
  );

  const handleDragEnd = useCallback(
    (event: DragEndEvent): void => {
      // Reorder branch — persist the new member order.
      if (reorderGroupId !== null) {
        const groupKey = `mcp-group-members-${reorderGroupId}`;
        const nextOrder = (reorderItemsRef.current[groupKey] ?? []).map((id) =>
          id.startsWith("member:") ? id.slice("member:".length) : id,
        );
        const initial = groupMembers[reorderGroupId] ?? [];
        const owning = reorderGroupId;
        setReorderGroupId(null);
        setReorderItems({});
        reorderItemsRef.current = {};
        if (event.canceled) return;
        const same =
          initial.length === nextOrder.length &&
          initial.every((id, i) => id === nextOrder[i]);
        if (same) return;
        setGroupMembers.mutate(
          { groupId: owning, orderedToolIds: nextOrder },
          {
            onError: (err) =>
              pushToast("error", `Failed to reorder tools: ${err.message}`),
          },
        );
        return;
      }

      if (event.canceled) return;

      // Add branch — tool dropped on a group row or the inline view.
      const sourceId = event.operation.source?.id;
      const targetId = event.operation.target?.id;
      if (typeof sourceId !== "string" || typeof targetId !== "string") return;
      if (!sourceId.startsWith("tool:")) return;
      let groupId: string | null = null;
      if (targetId.startsWith("mcp-group-content:")) {
        groupId = targetId.slice("mcp-group-content:".length);
      } else if (targetId.startsWith("mcp-group:")) {
        groupId = targetId.slice("mcp-group:".length);
      } else {
        return;
      }
      const toolId = sourceId.slice("tool:".length);
      const current = groupMembers[groupId] ?? [];
      if (current.includes(toolId)) return; // already a member — no-op.
      addGroupMember.mutate(
        { groupId, mcpToolId: toolId, position: BigInt(current.length) },
        {
          onError: (err) =>
            pushToast("error", `Failed to add tool to group: ${err.message}`),
        },
      );
    },
    [reorderGroupId, groupMembers, addGroupMember, setGroupMembers, pushToast],
  );

  // Parent expansion is owned by this page. Selecting a tool
  // auto-expands its server so the highlighted child is visible.
  const [expandedServerIds, setExpandedServerIds] = useState<
    ReadonlyArray<string>
  >([]);

  useEffect(() => {
    if (selectedServerId === null) return;
    setExpandedServerIds((prev) =>
      prev.includes(selectedServerId) ? prev : [...prev, selectedServerId],
    );
  }, [selectedServerId]);

  const servers = useMemo<ReadonlyArray<McpServer>>(
    () => serversQuery.data ?? [],
    [serversQuery.data],
  );
  const expandedSet = useMemo(
    () => new Set(expandedServerIds),
    [expandedServerIds],
  );

  // Fetch tools for every expanded server in one batched hook call.
  // Mirrors `useMcpToolsByServer` but keeps the page's render tree
  // stable (no hook calls inside `.map`). Cache keys + queryFn match
  // `useMcpToolsByServer` so the data is shared.
  const toolsQueries = useQueries({
    queries: expandedServerIds.map((id) => ({
      queryKey: mcpServersKeys.tools(id),
      queryFn: () => listMcpToolsByServer(id),
    })),
  });

  const toolsByServerId = useMemo<Record<string, ReadonlyArray<McpTool>>>(() => {
    const out: Record<string, ReadonlyArray<McpTool>> = {};
    expandedServerIds.forEach((id, idx) => {
      const data = toolsQueries[idx]?.data;
      if (data) out[id] = data;
    });
    return out;
    // toolsQueries is rebuilt every render but the data shape is
    // stable across re-renders when the underlying cache is.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [expandedServerIds, toolsQueries]);

  const handleSelectServer = (serverId: string): void => {
    setSelectedGroupId(null);
    setLocation(mcpServerPath(serverId));
  };

  const handleSelectTool = (serverId: string, toolId: string): void => {
    setSelectedGroupId(null);
    setLocation(mcpServerToolPath(serverId, toolId));
  };

  const handleToggleServer = (serverId: string): void => {
    setExpandedServerIds((prev) =>
      prev.includes(serverId)
        ? prev.filter((x) => x !== serverId)
        : [...prev, serverId],
    );
  };

  // Tree shape — server nodes carry their tools as `children` when the
  // server is expanded. Node ids keep the `srv:` / `tool:` prefixes so
  // EntityTree's auto-generated testids match the legacy contract
  // (`mcp-servers-sidebar-item-srv:<id>` / `…-tool:<id>`).
  type ServerOrTool =
    | { kind: "server"; server: McpServer }
    | { kind: "tool"; tool: McpTool; serverId: string };

  const treeData = useMemo<EntityTreeNode<ServerOrTool>[]>(
    () =>
      servers.map((server) => {
        const isExpanded = expandedSet.has(server.id);
        const tools = isExpanded ? toolsByServerId[server.id] ?? [] : [];
        return {
          id: `srv:${server.id}`,
          label: server.name,
          data: { kind: "server", server },
          children: tools.map((tool) => ({
            id: `tool:${tool.id}`,
            label: tool.name,
            data: { kind: "tool", tool, serverId: server.id },
          })),
        };
      }),
    [servers, expandedSet, toolsByServerId],
  );

  return (
    <DragDropProvider
      onDragStart={handleDragStart}
      onDragOver={handleDragOver}
      onDragEnd={handleDragEnd}
    >
    <section
      className={shellStyles.root}
      data-testid="mcp-servers-page-root"
    >
      <div className={shellStyles.sidebarSlot}>
        <SidebarShell
          ariaLabel="MCP servers navigation"
          testId="mcp-servers-sidebar-root-shell"
        >
          <EntityTree<McpToolGroup>
            testIdPrefix="mcp-tool-groups-sidebar"
            title="GROUPS"
            titleAriaLabel="MCP tool groups"
            titleTrailingNode={
              groupsQuery.status === "success" ? (
                <SidebarSectionAddTrigger
                  ariaLabel="Add MCP tool group"
                  onPress={() => setIsGroupCreateOpen(true)}
                  testId="mcp-tool-groups-sidebar-add"
                />
              ) : null
            }
            emptyText="No tool groups yet."
            isLoading={groupsQuery.status === "pending"}
            errorMessage={
              groupsQuery.status === "error"
                ? `Failed to load groups: ${groupsQuery.error.message}`
                : null
            }
            data={groupsTreeData}
            rowConfig={(node) => ({
              isActive: selectedGroupId === node.id,
              onClick: () => handleSelectGroup(node.id),
              // Drop target: a tool dragged from the server tree below
              // is added to this group (handled in `handleDragEnd`).
              droppable: {
                id: `mcp-group:${node.id}`,
                type: "mcp-group",
                accept: ["mcp-tool"],
              },
            })}
            renderRow={({ node }) => (
              <RowLabelButton
                label={node.label}
                onClick={() => handleSelectGroup(node.id)}
                testId={`mcp-tool-groups-sidebar-row-${node.id}`}
                hideLeading
              />
            )}
          />

          <SidebarSectionDivider />

          <EntityTree<ServerOrTool>
            testIdPrefix="mcp-servers-sidebar"
            title="MCP"
            titleAriaLabel="MCP servers navigation"
            titleTrailingNode={
              serversQuery.status === "success" ? (
                <SidebarSectionAddTrigger
                  ariaLabel="Add MCP server"
                  onPress={() => setIsCreateOpen(true)}
                  testId="mcp-servers-sidebar-add"
                />
              ) : null
            }
            emptyText="No MCP servers yet."
            isLoading={serversQuery.status === "pending"}
            errorMessage={
              serversQuery.status === "error"
                ? `Failed to load MCP servers: ${serversQuery.error.message}`
                : null
            }
            data={treeData}
            rowConfig={(node) => {
              const payload = node.data;
              if (payload?.kind === "server") {
                const { server } = payload;
                const isExpanded = expandedSet.has(server.id);
                return {
                  isActive:
                    selectedServerId === server.id && selectedToolId === null,
                  onClick: () => handleSelectServer(server.id),
                  expandable: true,
                  isExpanded,
                  onToggleExpand: () => handleToggleServer(server.id),
                  chevronAriaLabel: isExpanded
                    ? `Collapse ${server.name}`
                    : `Expand ${server.name}`,
                };
              }
              if (payload?.kind === "tool") {
                const { tool, serverId } = payload;
                return {
                  isActive: selectedToolId === tool.id,
                  onClick: () => handleSelectTool(serverId, tool.id),
                  // Draggable into a GROUPS row above. Source id is the
                  // node id (`tool:<id>`); `handleDragEnd` strips it.
                  draggable: {
                    type: "mcp-tool",
                    group: "all",
                    handleAriaLabel: `Drag ${tool.name}`,
                  },
                };
              }
              return {};
            }}
            renderRow={({ node }) => {
              const payload = node.data;
              if (payload?.kind === "server") {
                const { server } = payload;
                return (
                  <RowLabelButton
                    label={node.label}
                    onClick={() => handleSelectServer(server.id)}
                    testId={`mcp-servers-sidebar-row-srv:${server.id}`}
                    hideLeading
                  />
                );
              }
              if (payload?.kind === "tool") {
                const { tool, serverId } = payload;
                return (
                  <RowLabelButton
                    label={node.label}
                    onClick={() => handleSelectTool(serverId, tool.id)}
                    testId={`mcp-servers-sidebar-row-tool:${tool.id}`}
                    hideLeading
                  />
                );
              }
              return null;
            }}
          />
        </SidebarShell>
      </div>

      <Scrollable
        axis="y"
        className={shellStyles.contentSlot}
        data-testid="mcp-servers-page-content-scroll"
      >
        {selectedGroupId ? (
          <McpToolGroupInlineView
            groupId={selectedGroupId}
            onDeleted={() => setSelectedGroupId(null)}
            onSelectTool={handleSelectTool}
            orderOverride={
              reorderGroupId === selectedGroupId
                ? reorderItems[`mcp-group-members-${selectedGroupId}`] ?? null
                : null
            }
          />
        ) : selectedToolId && selectedServerId ? (
          <McpToolDetailPanel
            serverId={selectedServerId}
            toolId={selectedToolId}
          />
        ) : selectedServerId ? (
          <McpServerDetailPanel serverId={selectedServerId} />
        ) : (
          <McpServersOverview
            serverCount={servers.length}
            onCreate={() => setIsCreateOpen(true)}
          />
        )}
      </Scrollable>

      <McpServerCreateDialog
        isOpen={isCreateOpen}
        onClose={() => setIsCreateOpen(false)}
      />

      <McpToolGroupCreateDialog
        isOpen={isGroupCreateOpen}
        onClose={() => setIsGroupCreateOpen(false)}
        onCreated={(group) => handleSelectGroup(group.id)}
      />
    </section>
    </DragDropProvider>
  );
}
