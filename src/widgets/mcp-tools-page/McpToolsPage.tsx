/**
 * McpToolsPage — two-pane shell wrapping the existing `<McpToolsList>`.
 * Same shape as RolesPage / SkillsPage.
 */

import { useState, type ReactElement } from "react";

import { useMcpTools } from "@entities/mcp-tool";
import { Scrollable } from "@shared/ui";
import { McpToolCreateDialog } from "@widgets/mcp-tool-create-dialog";
import { McpToolEditor } from "@widgets/mcp-tool-editor";
import { EntityListSidebar } from "@widgets/entity-list-sidebar";
import { McpToolsList } from "@widgets/mcp-tools-list";

import shellStyles from "@widgets/entity-list-sidebar/EntityPageShell.module.css";

export function McpToolsPage(): ReactElement {
  const toolsQuery = useMcpTools();
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [isCreateOpen, setIsCreateOpen] = useState(false);

  const items = (toolsQuery.data ?? []).map((t) => ({
    id: t.id,
    name: t.name,
    color: t.color,
  }));

  return (
    <section className={shellStyles.root} data-testid="mcp-tools-page-root">
      <div className={shellStyles.sidebarSlot}>
        <EntityListSidebar
          title="MCP SERVERS"
          ariaLabel="MCP servers navigation"
          items={items}
          selectedId={selectedId}
          onSelect={setSelectedId}
          addLabel="Add server"
          onAdd={() => setIsCreateOpen(true)}
          emptyText="No MCP servers yet."
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
        <McpToolsList
          onSelectTool={setSelectedId}
          onCreate={() => setIsCreateOpen(true)}
        />
      </Scrollable>

      <McpToolEditor
        toolId={selectedId}
        onClose={() => setSelectedId(null)}
      />
      <McpToolCreateDialog
        isOpen={isCreateOpen}
        onClose={() => setIsCreateOpen(false)}
      />
    </section>
  );
}
