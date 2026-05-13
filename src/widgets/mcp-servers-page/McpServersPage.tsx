/**
 * McpServersPage — master-detail shell for /mcp-servers.
 *
 * Round-22 refactor: every entity page in the app uses the same
 * `<EntityListSidebar>` + content-pane shell (roles, skills, prompts,
 * tags). MCP servers now joins the pattern. The rail lists each
 * registered server as a top-level expandable row; the server's
 * introspected tools render as indented children. Selection state
 * lives in the URL:
 *
 *   /mcp-servers                          → overview pane.
 *   /mcp-servers/:serverId                → server detail pane.
 *   /mcp-servers/:serverId/tools/:toolId  → tool detail pane.
 *
 * The "+" trigger in the rail opens `McpServerCreateDialog` —
 * modal-only-for-creation invariant.
 *
 * Sidebar item ids are namespaced (`srv:<id>` / `tool:<id>`) so a
 * single `selectedId` highlights one row at a time across both levels.
 */

import { useEffect, useMemo, useState, type ReactElement } from "react";
import { useLocation, useRoute } from "wouter";
import { useQueries } from "@tanstack/react-query";

import {
  listMcpToolsByServer,
  mcpServersKeys,
  useMcpServers,
  type McpServer,
} from "@entities/mcp-server";
import type { McpTool } from "@bindings/McpTool";
import { Scrollable } from "@shared/ui";
import { McpServerCreateDialog } from "@widgets/mcp-server-create-dialog";
import { EntityListSidebar } from "@widgets/entity-list-sidebar";
import type { EntityListSidebarItem } from "@widgets/entity-list-sidebar";
import {
  mcpServerPath,
  mcpServerToolPath,
  routes,
} from "@app/routes";

import shellStyles from "@widgets/entity-list-sidebar/EntityPageShell.module.css";
import { McpServersOverview } from "./McpServersOverview";
import { McpServerDetailPanel } from "./McpServerDetailPanel";
import { McpToolDetailPanel } from "./McpToolDetailPanel";

const SRV_PREFIX = "srv:";
const TOOL_PREFIX = "tool:";

export function McpServersPage(): ReactElement {
  const serversQuery = useMcpServers();
  const [, setLocation] = useLocation();
  const [, toolParams] = useRoute<{ serverId: string; toolId: string }>(
    routes.mcpServerTool,
  );
  const [, serverParams] = useRoute<{ serverId: string }>(routes.mcpServer);
  const [isCreateOpen, setIsCreateOpen] = useState(false);

  const selectedToolId = toolParams?.toolId ?? null;
  const selectedServerId =
    toolParams?.serverId ?? serverParams?.serverId ?? null;

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

  // Fetch tools for every expanded server in one batched hook call.
  // Mirrors `useMcpToolsByServer` but keeps the page's render-side
  // tree stable (no hook calls inside `.map`). Cache keys + queryFn
  // match `useMcpToolsByServer` so the data is shared.
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

  const sidebarItems = useMemo<ReadonlyArray<EntityListSidebarItem>>(
    () => buildSidebarItems(servers, expandedServerIds, toolsByServerId),
    [servers, expandedServerIds, toolsByServerId],
  );

  const selectedSidebarId = selectedToolId
    ? `${TOOL_PREFIX}${selectedToolId}`
    : selectedServerId
      ? `${SRV_PREFIX}${selectedServerId}`
      : null;
  const expandedSidebarIds = expandedServerIds.map((id) => `${SRV_PREFIX}${id}`);

  const handleSelect = (id: string): void => {
    if (id.startsWith(TOOL_PREFIX)) {
      const toolId = id.slice(TOOL_PREFIX.length);
      const ownerServerId = findToolOwner(toolsByServerId, toolId);
      if (ownerServerId === null) return;
      setLocation(mcpServerToolPath(ownerServerId, toolId));
      return;
    }
    if (id.startsWith(SRV_PREFIX)) {
      const serverId = id.slice(SRV_PREFIX.length);
      setLocation(mcpServerPath(serverId));
    }
  };

  const handleToggle = (id: string): void => {
    if (!id.startsWith(SRV_PREFIX)) return;
    const serverId = id.slice(SRV_PREFIX.length);
    setExpandedServerIds((prev) =>
      prev.includes(serverId)
        ? prev.filter((x) => x !== serverId)
        : [...prev, serverId],
    );
  };

  return (
    <section
      className={shellStyles.root}
      data-testid="mcp-servers-page-root"
    >
      <div className={shellStyles.sidebarSlot}>
        <EntityListSidebar
          title="MCP"
          ariaLabel="MCP servers navigation"
          items={sidebarItems}
          selectedId={selectedSidebarId}
          onSelect={handleSelect}
          addLabel="Add MCP server"
          onAdd={() => setIsCreateOpen(true)}
          emptyText="No MCP servers yet."
          testIdPrefix="mcp-servers-sidebar"
          isLoading={serversQuery.status === "pending"}
          errorMessage={
            serversQuery.status === "error"
              ? `Failed to load MCP servers: ${serversQuery.error.message}`
              : null
          }
          expandedIds={expandedSidebarIds}
          onToggleExpand={handleToggle}
        />
      </div>

      <Scrollable
        axis="y"
        className={shellStyles.contentSlot}
        data-testid="mcp-servers-page-content-scroll"
      >
        {selectedToolId && selectedServerId ? (
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
    </section>
  );
}

// ─────────────────────────────────────────────────────────────────────────────

function buildSidebarItems(
  servers: ReadonlyArray<McpServer>,
  expandedServerIds: ReadonlyArray<string>,
  toolsByServerId: Record<string, ReadonlyArray<McpTool>>,
): ReadonlyArray<EntityListSidebarItem> {
  const expandedSet = new Set(expandedServerIds);
  return servers.map((server) => {
    const tools = expandedSet.has(server.id)
      ? toolsByServerId[server.id] ?? []
      : [];
    return {
      id: `${SRV_PREFIX}${server.id}`,
      name: server.name,
      children: tools.map((tool) => ({
        id: `${TOOL_PREFIX}${tool.id}`,
        name: tool.name,
      })),
    };
  });
}

function findToolOwner(
  toolsByServerId: Record<string, ReadonlyArray<McpTool>>,
  toolId: string,
): string | null {
  for (const [serverId, tools] of Object.entries(toolsByServerId)) {
    if (tools.some((t) => t.id === toolId)) return serverId;
  }
  return null;
}
