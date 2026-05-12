/**
 * McpServersPage — server-grouped view (PROXY-S6 / ADR-0008, ctq-133).
 *
 * Replaces the registry-only `McpToolsPage`. Each `McpServer` renders
 * as a section: header row (name + status dot + synced-ago + Refresh +
 * Delete) followed by its tool list. The "+" CTA opens
 * `McpServerCreateDialog`; on successful create the new server appears
 * via the cache update (`onSuccess` seeds detail; the list query
 * invalidates and refetches via `useCreateMcpServerMutation`).
 */

import { useState, type ReactElement } from "react";

import { useMcpServers } from "@entities/mcp-server";
import { Button, EmptyState, Scrollable } from "@shared/ui";
import { PixelCodingAppsWebsitesDatabase } from "@shared/ui/Icon";
import { McpServerCreateDialog } from "@widgets/mcp-server-create-dialog";

import { McpServerSection } from "./McpServerSection";
import styles from "./McpServersPage.module.css";

export function McpServersPage(): ReactElement {
  const serversQuery = useMcpServers();
  const [isCreateOpen, setIsCreateOpen] = useState(false);

  return (
    <Scrollable
      axis="y"
      className={styles.root}
      data-testid="mcp-servers-page-root"
    >
      <header className={styles.header}>
        <div className={styles.headingGroup}>
          <PixelCodingAppsWebsitesDatabase
            width={20}
            height={20}
            className={styles.headingIcon}
            aria-hidden
          />
          <div>
            <h1 className={styles.heading}>MCP servers</h1>
            <p className={styles.description}>
              Upstream Model Context Protocol servers connected through
              Catique HUB. Tools auto-populate via introspection.
            </p>
          </div>
        </div>
        <div className={styles.headerActions}>
          <Button
            variant="primary"
            size="md"
            onPress={() => setIsCreateOpen(true)}
            data-testid="mcp-servers-page-create-button"
          >
            Create server
          </Button>
        </div>
      </header>

      <McpServersPageBody
        status={serversQuery.status}
        servers={serversQuery.data}
        errorMessage={
          serversQuery.status === "error" ? serversQuery.error.message : null
        }
        onCreate={() => setIsCreateOpen(true)}
        onRetry={() => {
          void serversQuery.refetch();
        }}
      />

      <McpServerCreateDialog
        isOpen={isCreateOpen}
        onClose={() => setIsCreateOpen(false)}
      />
    </Scrollable>
  );
}

// ─────────────────────────────────────────────────────────────────────────────

interface McpServersPageBodyProps {
  status: "pending" | "error" | "success";
  servers: ReturnType<typeof useMcpServers>["data"];
  errorMessage: string | null;
  onCreate: () => void;
  onRetry: () => void;
}

function McpServersPageBody({
  status,
  servers,
  errorMessage,
  onCreate,
  onRetry,
}: McpServersPageBodyProps): ReactElement {
  if (status === "pending") {
    return (
      <div className={styles.list} data-testid="mcp-servers-page-loading">
        <div className={styles.skeletonCard} aria-hidden />
        <div className={styles.skeletonCard} aria-hidden />
        <div className={styles.skeletonCard} aria-hidden />
      </div>
    );
  }

  if (status === "error") {
    return (
      <div
        className={styles.errorPanel}
        role="alert"
        data-testid="mcp-servers-page-error"
      >
        <p className={styles.errorMessage}>
          Failed to load MCP servers: {errorMessage ?? "unknown error"}
        </p>
        <Button variant="secondary" size="sm" onPress={onRetry}>
          Retry
        </Button>
      </div>
    );
  }

  if (!servers || servers.length === 0) {
    return (
      <div data-testid="mcp-servers-page-empty">
        <EmptyState
          icon={<PixelCodingAppsWebsitesDatabase width={64} height={64} />}
          title="No MCP servers yet"
          description="Register an upstream MCP server. Catique relays tool calls through to it."
          action={
            <Button variant="primary" size="md" onPress={onCreate}>
              Create server
            </Button>
          }
        />
      </div>
    );
  }

  return (
    <div className={styles.list} data-testid="mcp-servers-page-list">
      {servers.map((server) => (
        <McpServerSection key={server.id} server={server} />
      ))}
    </div>
  );
}
