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

import { useEffect, useMemo, useState, type ReactElement } from "react";
import { useLocationCompat as useLocation, useRouteCompat as useRoute } from "@shared/lib";
import { useQueries } from "@tanstack/react-query";

import {
  listMcpToolsByServer,
  mcpServersKeys,
  useMcpServers,
  type McpServer,
} from "@entities/mcp-server";
import type { McpTool } from "@bindings/McpTool";
import {
  Group,
  RailSection,
  Row,
  RowLabelButton,
  Scrollable,
  SidebarShell,
} from "@shared/ui";
import { McpServerCreateDialog } from "@features/mcp-server/create-dialog";
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
    setLocation(mcpServerPath(serverId));
  };

  const handleSelectTool = (serverId: string, toolId: string): void => {
    setLocation(mcpServerToolPath(serverId, toolId));
  };

  const handleToggleServer = (serverId: string): void => {
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
        <SidebarShell
          ariaLabel="MCP servers navigation"
          testId="mcp-servers-sidebar-root-shell"
        >
          <RailSection
            title="MCP"
            titleAriaLabel="MCP servers navigation"
            testIdPrefix="mcp-servers-sidebar"
            addLabel="Add MCP server"
            onAdd={() => setIsCreateOpen(true)}
            emptyText="No MCP servers yet."
            isLoading={serversQuery.status === "pending"}
            errorMessage={
              serversQuery.status === "error"
                ? `Failed to load MCP servers: ${serversQuery.error.message}`
                : null
            }
            isEmpty={servers.length === 0}
          >
            {servers.map((server) => {
              const isExpanded = expandedSet.has(server.id);
              const isServerActive =
                selectedServerId === server.id && selectedToolId === null;
              const tools = isExpanded ? toolsByServerId[server.id] ?? [] : [];
              return (
                <Group
                  key={server.id}
                  testId={`mcp-servers-sidebar-item-srv:${server.id}`}
                  isActive={isServerActive}
                  isExpand={isExpanded}
                  onToggleExpand={() => handleToggleServer(server.id)}
                  chevronAriaLabel={
                    isExpanded ? `Collapse ${server.name}` : `Expand ${server.name}`
                  }
                  chevronTestId={`mcp-servers-sidebar-toggle-srv:${server.id}`}
                  childrenTestId={`mcp-servers-sidebar-children-srv:${server.id}`}
                  onClick={() => handleSelectServer(server.id)}
                  renderContent={() => (
                    <RowLabelButton
                      label={server.name}
                      onClick={() => handleSelectServer(server.id)}
                      testId={`mcp-servers-sidebar-row-srv:${server.id}`}
                    />
                  )}
                >
                  {tools.map((tool) => (
                    <Row
                      key={tool.id}
                      testId={`mcp-servers-sidebar-item-tool:${tool.id}`}
                      isActive={selectedToolId === tool.id}
                      onClick={() => handleSelectTool(server.id, tool.id)}
                      renderContent={() => (
                        <RowLabelButton
                          label={tool.name}
                          onClick={() => handleSelectTool(server.id, tool.id)}
                          testId={`mcp-servers-sidebar-row-tool:${tool.id}`}
                        />
                      )}
                    />
                  ))}
                </Group>
              );
            })}
          </RailSection>
        </SidebarShell>
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
