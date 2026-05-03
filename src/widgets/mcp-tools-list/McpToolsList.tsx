import { useState, type ReactElement } from "react";

import { McpToolCard, useMcpTools } from "@entities/mcp-tool";
import { Button, EmptyState } from "@shared/ui";
import { PixelCodingAppsWebsitesDatabase } from "@shared/ui/Icon";
import { McpToolEditor } from "@widgets/mcp-tool-editor";
import { McpToolCreateDialog } from "@widgets/mcp-tool-create-dialog";

import styles from "./McpToolsList.module.css";

export interface McpToolsListProps {
  /** Called when the user activates a tool card. */
  onSelectTool?: (toolId: string) => void;
}

/**
 * `McpToolsList` — widget that renders all MCP tools.
 *
 * Async-UI states:
 *   1. loading — three skeleton cards.
 *   2. error — inline error panel + retry.
 *   3. empty — friendly headline + CTA.
 *   4. populated — CSS-grid of `McpToolCard`s.
 */
export function McpToolsList({ onSelectTool }: McpToolsListProps = {}): ReactElement {
  const [selectedToolId, setSelectedToolId] = useState<string | null>(null);
  const [isCreateOpen, setIsCreateOpen] = useState(false);
  const toolsQuery = useMcpTools();

  return (
    <section className={styles.root} aria-labelledby="mcp-tools-list-heading">
      <header className={styles.header}>
        <div className={styles.headingGroup}>
          <PixelCodingAppsWebsitesDatabase
            width={20}
            height={20}
            className={styles.headingIcon}
            aria-hidden={true}
          />
          <div className={styles.headingText}>
            <h2 id="mcp-tools-list-heading" className={styles.heading}>
              MCP servers
            </h2>
            <p className={styles.description}>
              Model Context Protocol endpoints connected to the hub.
            </p>
          </div>
        </div>
        <div className={styles.headerActions}>
          <Button
            variant="primary"
            size="md"
            onPress={() => setIsCreateOpen(true)}
            data-testid="mcp-tools-list-create-button"
          >
            <span className={styles.btnLabel}>
              <span aria-hidden="true">+</span>
              + Create server
            </span>
          </Button>
        </div>
      </header>

      {toolsQuery.status === "pending" ? (
        <div className={styles.grid} data-testid="mcp-tools-list-loading">
          <McpToolCard isPending />
          <McpToolCard isPending />
          <McpToolCard isPending />
        </div>
      ) : toolsQuery.status === "error" ? (
        <div className={styles.error} role="alert">
          <p className={styles.errorMessage}>
            Failed to load MCP tools: {toolsQuery.error.message}
          </p>
          <Button
            variant="secondary"
            size="sm"
            onPress={() => {
              void toolsQuery.refetch();
            }}
          >
            Retry
          </Button>
        </div>
      ) : toolsQuery.data.length === 0 ? (
        <div className={styles.empty} data-testid="mcp-tools-list-empty">
          <EmptyState
            icon={<PixelCodingAppsWebsitesDatabase width={64} height={64} />}
            title="No MCP servers yet"
            description="Connect Model Context Protocol endpoints."
            action={
              <Button
                variant="primary"
                size="md"
                onPress={() => setIsCreateOpen(true)}
              >
                <span className={styles.btnLabel}>
                  <span aria-hidden="true">+</span>
                  + Create server
                </span>
              </Button>
            }
          />
        </div>
      ) : (
        <div className={styles.grid} data-testid="mcp-tools-list-grid">
          {toolsQuery.data.map((tool) => (
            <McpToolCard
              key={tool.id}
              tool={tool}
              onSelect={(id) => {
                setSelectedToolId(id);
                onSelectTool?.(id);
              }}
            />
          ))}
        </div>
      )}

      <McpToolEditor
        toolId={selectedToolId}
        onClose={() => setSelectedToolId(null)}
      />

      <McpToolCreateDialog
        isOpen={isCreateOpen}
        onClose={() => setIsCreateOpen(false)}
      />
    </section>
  );
}
