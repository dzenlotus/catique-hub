/**
 * McpToolsPage — two-pane shell wrapping the existing `<McpToolsList>`.
 * Same shape as RolesPage / SkillsPage. Audit-#9: editor is a routed
 * PAGE on `/mcp-tools/:mcpToolId` rather than a modal.
 */

import { useState, type ReactElement } from "react";
import { useLocation, useRoute } from "wouter";

import { useMcpTools } from "@entities/mcp-tool";
import { Scrollable } from "@shared/ui";
import { McpToolCreateDialog } from "@widgets/mcp-tool-create-dialog";
import { McpToolEditorPanel } from "@widgets/mcp-tool-editor";
import { EntityListSidebar } from "@widgets/entity-list-sidebar";
import { McpToolsList } from "@widgets/mcp-tools-list";
import { mcpToolPath, routes } from "@app/routes";

import shellStyles from "@widgets/entity-list-sidebar/EntityPageShell.module.css";

export function McpToolsPage(): ReactElement {
  const toolsQuery = useMcpTools();
  const [, setLocation] = useLocation();
  const [match, params] = useRoute<{ mcpToolId: string }>(routes.mcpTool);
  const selectedId = match ? params?.mcpToolId ?? null : null;
  const [isCreateOpen, setIsCreateOpen] = useState(false);

  const items = (toolsQuery.data ?? []).map((t) => ({
    id: t.id,
    name: t.name,
    color: t.color,
  }));

  const handleSelect = (id: string | null): void => {
    setLocation(id ? mcpToolPath(id) : routes.mcpTools);
  };

  return (
    <section className={shellStyles.root} data-testid="mcp-tools-page-root">
      <div className={shellStyles.sidebarSlot}>
        <EntityListSidebar
          title="MCP TOOLS"
          ariaLabel="MCP tools navigation"
          items={items}
          selectedId={selectedId}
          onSelect={(id) => handleSelect(id)}
          addLabel="Add tool"
          onAdd={() => setIsCreateOpen(true)}
          emptyText="No MCP tools yet."
          testIdPrefix="mcp-tools-sidebar"
          isLoading={toolsQuery.status === "pending"}
          errorMessage={
            toolsQuery.status === "error"
              ? `Failed to load MCP tools: ${toolsQuery.error.message}`
              : null
          }
        />
      </div>

      <Scrollable
        axis="y"
        className={shellStyles.contentSlot}
        data-testid="mcp-tools-page-content-scroll"
      >
        {selectedId ? (
          <McpToolEditorPanel
            toolId={selectedId}
            onClose={() => handleSelect(null)}
          />
        ) : (
          <McpToolsList
            onSelectTool={(id) => handleSelect(id)}
            onCreate={() => setIsCreateOpen(true)}
          />
        )}
      </Scrollable>

      <McpToolCreateDialog
        isOpen={isCreateOpen}
        onClose={() => setIsCreateOpen(false)}
      />
    </section>
  );
}
