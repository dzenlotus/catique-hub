/**
 * McpServerSection — one server group in the MCP servers page.
 *
 * PROXY-S6 / ADR-0008. Renders:
 *   - server name + status dot (healthy/degraded/unreachable);
 *   - "synced N min/h/d ago" when `lastSyncedAt` is set;
 *   - Refresh icon button   — `refresh_mcp_server` + count toast;
 *   - Delete icon button    — confirmation dialog, then
 *                              `delete_mcp_server`;
 *   - the per-server tool list (soft-deleted rows struck through).
 */

import {
  useState,
  type ReactElement,
} from "react";
import {
  PixelInterfaceEssentialBin,
  PixelInterfaceEssentialRefresh,
} from "@shared/ui/Icon";

import {
  useDeleteMcpServerMutation,
  useMcpServerStatus,
  useMcpToolsByServer,
  useRefreshMcpServerMutation,
  type McpServer,
  type McpServerHealthState,
  type RefreshReport,
} from "@entities/mcp-server";
import { useToast } from "@app/providers/ToastProvider";
import { ConfirmDialog } from "@shared/ui";
import { cn } from "@shared/lib";

import { McpServerToolRow } from "./McpServerToolRow";
import { formatSyncedAgo } from "./timeAgo";
import styles from "./McpServersPage.module.css";

export interface McpServerSectionProps {
  server: McpServer;
}

const STATUS_LABEL: Record<McpServerHealthState, string> = {
  healthy: "Healthy",
  degraded: "Degraded",
  unreachable: "Unreachable",
};

export function McpServerSection({
  server,
}: McpServerSectionProps): ReactElement {
  const statusQuery = useMcpServerStatus(server.id);
  const toolsQuery = useMcpToolsByServer(server.id);
  const refreshMutation = useRefreshMcpServerMutation();
  const deleteMutation = useDeleteMcpServerMutation();
  const { pushToast } = useToast();
  const [isConfirmOpen, setIsConfirmOpen] = useState(false);

  const status = statusQuery.data;
  const state: McpServerHealthState = status?.state ?? "unreachable";
  const syncedLabel = formatSyncedAgo(status?.lastSyncedAt ?? null);

  const handleRefresh = (): void => {
    refreshMutation.mutate(server.id, {
      onSuccess: (report) => {
        pushToast("success", formatRefreshReport(server.name, report));
      },
      onError: (err) => {
        pushToast("error", `Refresh failed for ${server.name}: ${err.message}`);
      },
    });
  };

  const handleDeleteConfirmed = (): void => {
    deleteMutation.mutate(server.id, {
      onSuccess: () => {
        setIsConfirmOpen(false);
        pushToast("info", `${server.name} removed.`);
      },
      onError: (err) => {
        setIsConfirmOpen(false);
        pushToast("error", `Delete failed for ${server.name}: ${err.message}`);
      },
    });
  };

  return (
    <section
      className={styles.serverSection}
      aria-labelledby={`mcp-server-${server.id}-name`}
      data-testid={`mcp-servers-page-section-${server.id}`}
    >
      <header className={styles.serverHeader}>
        <div className={styles.serverIdentity}>
          <span
            className={cn(styles.statusDot, statusDotClass(state))}
            aria-hidden="true"
            data-testid={`mcp-servers-page-status-dot-${server.id}`}
            data-state={state}
          />
          <h3
            id={`mcp-server-${server.id}-name`}
            className={styles.serverName}
          >
            {server.name}
          </h3>
          <span
            className={styles.serverMeta}
            data-testid={`mcp-servers-page-status-label-${server.id}`}
          >
            {STATUS_LABEL[state]}
            {syncedLabel ? ` · ${syncedLabel}` : null}
          </span>
        </div>
        <div className={styles.serverActions}>
          <button
            type="button"
            className={styles.iconButton}
            onClick={handleRefresh}
            disabled={refreshMutation.isPending}
            aria-label={`Refresh ${server.name}`}
            data-pending={refreshMutation.isPending ? "true" : undefined}
            data-testid={`mcp-servers-page-refresh-${server.id}`}
          >
            <PixelInterfaceEssentialRefresh width={16} height={16} aria-hidden />
          </button>
          <button
            type="button"
            className={styles.iconButton}
            onClick={() => setIsConfirmOpen(true)}
            disabled={deleteMutation.isPending}
            aria-label={`Delete ${server.name}`}
            data-testid={`mcp-servers-page-delete-${server.id}`}
          >
            <PixelInterfaceEssentialBin width={16} height={16} aria-hidden />
          </button>
        </div>
      </header>

      {toolsQuery.status === "pending" ? (
        <p className={styles.toolsEmpty}>Loading tools…</p>
      ) : toolsQuery.status === "error" ? (
        <p
          className={styles.toolsEmpty}
          role="alert"
          data-testid={`mcp-servers-page-tools-error-${server.id}`}
        >
          Failed to load tools: {toolsQuery.error.message}
        </p>
      ) : toolsQuery.data.length === 0 ? (
        <p className={styles.toolsEmpty}>No tools yet.</p>
      ) : (
        <ul className={styles.toolsList}>
          {toolsQuery.data.map((tool) => (
            <McpServerToolRow key={tool.id} tool={tool} />
          ))}
        </ul>
      )}

      <ConfirmDialog
        isOpen={isConfirmOpen}
        title={`Delete ${server.name}?`}
        description="Removes the server and all of its introspected tools. Roles attached to those tools will lose them."
        confirmLabel="Delete"
        destructive
        isPending={deleteMutation.isPending}
        onCancel={() => setIsConfirmOpen(false)}
        onConfirm={handleDeleteConfirmed}
        data-testid={`mcp-servers-page-delete-confirm-${server.id}`}
      />
    </section>
  );
}

// ─────────────────────────────────────────────────────────────────────────────

function statusDotClass(state: McpServerHealthState): string {
  switch (state) {
    case "healthy":
      return styles.statusDotHealthy;
    case "degraded":
      return styles.statusDotDegraded;
    case "unreachable":
      return styles.statusDotUnreachable;
  }
}

function formatRefreshReport(name: string, report: RefreshReport): string {
  // Wire shape is bigint per ts-rs; coerce to number for display.
  const added = Number(report.added);
  const changed = Number(report.schemaChanged);
  const deleted = Number(report.softDeleted);
  return `${name}: +${added}, ~${changed}, -${deleted}`;
}
