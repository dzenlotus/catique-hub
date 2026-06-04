/**
 * McpServerDetailPanel — content pane when a server row is selected in
 * the rail. Round-22 split from the legacy `<McpServerSection>` group
 * card. Shows server-level metadata (name, status, last-synced),
 * Refresh + Delete actions, and a hint pointing at the tool list which
 * now lives in the rail as nested children.
 */

import { useCallback, useState, type ReactElement } from "react";
import { useLocationCompat as useLocation } from "@shared/lib";

import {
  useDeleteMcpServerMutation,
  useMcpServer,
  useMcpServerStatus,
  useMcpToolsByServer,
  useRefreshMcpServerMutation,
  useUpdateMcpServerMutation,
  type McpServerHealthState,
  type RefreshReport,
} from "@entities/mcp-server";
import { useToast } from "@shared/lib";
import { ConfirmDialog, EntityTitle } from "@shared/ui";
import { PixelInterfaceEssentialBin, PixelInterfaceEssentialRefresh } from "@shared/ui/Icon";
import { cn } from "@shared/lib";
import { routes } from "@app/routes";

import { formatSyncedAgo } from "./timeAgo";
import styles from "./McpServersPage.module.css";

export interface McpServerDetailPanelProps {
  serverId: string;
}

const STATUS_LABEL: Record<McpServerHealthState, string> = {
  healthy: "Healthy",
  degraded: "Degraded",
  unreachable: "Unreachable",
};

export function McpServerDetailPanel({
  serverId,
}: McpServerDetailPanelProps): ReactElement {
  const serverQuery = useMcpServer(serverId);
  const statusQuery = useMcpServerStatus(serverId);
  const toolsQuery = useMcpToolsByServer(serverId);
  const refreshMutation = useRefreshMcpServerMutation();
  const deleteMutation = useDeleteMcpServerMutation();
  const updateMutation = useUpdateMcpServerMutation();
  const { pushToast } = useToast();

  // Inline-rename handler. Lifted out of JSX (useCallback) to keep the
  // mutation plumbing out of the EntityTitle prop tree and to avoid
  // re-allocating on every render.
  const currentName = serverQuery.data?.name ?? serverId;
  const handleRename = useCallback(
    (next: string) => {
      updateMutation.mutate(
        { id: serverId, name: next },
        {
          onError: (err) => {
            pushToast("error", `Failed to rename ${currentName}: ${err.message}`);
          },
        },
      );
    },
    [updateMutation, serverId, currentName, pushToast],
  );
  const [, setLocation] = useLocation();
  const [isConfirmOpen, setIsConfirmOpen] = useState(false);

  if (serverQuery.status === "pending") {
    return (
      <div
        className={styles.detailRoot}
        data-testid={`mcp-servers-page-detail-loading-${serverId}`}
      >
        <p className={styles.detailMuted}>Loading server…</p>
      </div>
    );
  }

  if (serverQuery.status === "error") {
    return (
      <div
        className={styles.detailRoot}
        data-testid={`mcp-servers-page-detail-error-${serverId}`}
        role="alert"
      >
        <p className={styles.detailError}>
          Failed to load server: {serverQuery.error.message}
        </p>
      </div>
    );
  }

  const server = serverQuery.data;
  const state: McpServerHealthState = statusQuery.data?.state ?? "unreachable";
  const syncedLabel = formatSyncedAgo(statusQuery.data?.lastSyncedAt ?? null);
  const toolCount = toolsQuery.data?.length ?? 0;

  const handleRefresh = (): void => {
    refreshMutation.mutate(serverId, {
      onSuccess: (report) => {
        pushToast("success", formatRefreshReport(server.name, report));
      },
      onError: (err) => {
        pushToast(
          "error",
          `Refresh failed for ${server.name}: ${err.message}`,
        );
      },
    });
  };

  const handleDeleteConfirmed = (): void => {
    deleteMutation.mutate(serverId, {
      onSuccess: () => {
        setIsConfirmOpen(false);
        pushToast("info", `${server.name} removed.`);
        setLocation(routes.mcpServers);
      },
      onError: (err) => {
        setIsConfirmOpen(false);
        pushToast(
          "error",
          `Delete failed for ${server.name}: ${err.message}`,
        );
      },
    });
  };

  return (
    <div
      className={styles.detailRoot}
      data-testid={`mcp-servers-page-detail-${serverId}`}
    >
      <header className={styles.detailHeader}>
        <EntityTitle
          size="lg"
          editable
          name={server.name}
          onNameChange={handleRename}
          editTestId={`mcp-servers-page-rename-${serverId}`}
          leadingSlot={
            <span
              className={cn(styles.statusDot, statusDotClass(state))}
              aria-hidden="true"
              data-testid={`mcp-servers-page-status-dot-${serverId}`}
              data-state={state}
            />
          }
          actions={
            <>
              <button
                type="button"
                className={styles.iconButton}
                onClick={handleRefresh}
                disabled={refreshMutation.isPending}
                aria-label={`Refresh ${server.name}`}
                data-pending={refreshMutation.isPending ? "true" : undefined}
                data-testid={`mcp-servers-page-refresh-${serverId}`}
              >
                <PixelInterfaceEssentialRefresh width={16} height={16} aria-hidden />
              </button>
              <button
                type="button"
                className={styles.iconButton}
                onClick={() => setIsConfirmOpen(true)}
                disabled={deleteMutation.isPending}
                aria-label={`Delete ${server.name}`}
                data-testid={`mcp-servers-page-delete-${serverId}`}
              >
                <PixelInterfaceEssentialBin width={16} height={16} aria-hidden />
              </button>
            </>
          }
        />
      </header>

      <p
        className={styles.detailMeta}
        data-testid={`mcp-servers-page-status-label-${serverId}`}
      >
        {STATUS_LABEL[state]}
        {syncedLabel ? ` · ${syncedLabel}` : null}
      </p>

      <dl className={styles.detailMetaList}>
        <div className={styles.detailMetaRow}>
          <dt>Transport</dt>
          <dd>{server.transport}</dd>
        </div>
        {server.url ? (
          <div className={styles.detailMetaRow}>
            <dt>URL</dt>
            <dd>{server.url}</dd>
          </div>
        ) : null}
        {server.command ? (
          <div className={styles.detailMetaRow}>
            <dt>Command</dt>
            <dd>{server.command}</dd>
          </div>
        ) : null}
      </dl>

      <p className={styles.detailHint}>
        {toolCount === 0
          ? "No tools synced yet. Hit Refresh to introspect this server."
          : `${toolCount} ${toolCount === 1 ? "tool" : "tools"} synced — pick one in the rail on the left to see its description and schema.`}
      </p>

      <ConfirmDialog
        isOpen={isConfirmOpen}
        title={`Delete ${server.name}?`}
        description="Removes the server and all of its introspected tools. Roles attached to those tools will lose them."
        confirmLabel="Delete"
        destructive
        isPending={deleteMutation.isPending}
        onCancel={() => setIsConfirmOpen(false)}
        onConfirm={handleDeleteConfirmed}
        data-testid={`mcp-servers-page-delete-confirm-${serverId}`}
      />
    </div>
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
  const added = Number(report.added);
  const changed = Number(report.schemaChanged);
  const deleted = Number(report.softDeleted);
  return `${name}: +${added}, ~${changed}, -${deleted}`;
}
