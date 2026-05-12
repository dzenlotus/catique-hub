/**
 * ConnectedAgentsSection — round-21 rewrite.
 *
 * Settings pane for managing connected providers. Detection runs once
 * on first launch (backend); afterwards the user adds / removes
 * providers manually here.
 *
 * Each row: provider name + sync-state indicator + a single "Remove"
 * action. The "Add provider" button opens a modal listing the
 * supported-provider catalog.
 *
 * What was removed (round-21):
 *   - Per-card "Rescan" / discover trigger.
 *   - Per-card "Edit instructions" action (widget deleted).
 *   - Per-card "Sync roles" button (sync is automatic on every save).
 *   - The enabled/disabled toggle (a row exists iff the provider is
 *     connected — there is no third "disabled" state).
 */

import { useState, type ReactElement } from "react";

import { Button } from "@shared/ui";
import { cn } from "@shared/lib";
import {
  useConnectedClients,
  useRemoveProviderMutation,
  useSyncStatus,
  type ConnectedClient,
} from "@entities/connected-client";
import { useToast } from "@app/providers/ToastProvider";

import { AddProviderDialog } from "./AddProviderDialog";
import styles from "./ConnectedAgentsSection.module.css";

/**
 * `ConnectedAgentsSection` — list connected providers with an
 * "Add provider" trigger. Rows expose a Remove button that calls
 * `useRemoveProviderMutation`.
 */
export function ConnectedAgentsSection(): ReactElement {
  const { data: providers, status, error } = useConnectedClients();
  const [isAddOpen, setIsAddOpen] = useState(false);

  const handleOpenAdd = (): void => {
    setIsAddOpen(true);
  };

  const handleCloseAdd = (): void => {
    setIsAddOpen(false);
  };

  // Every row in `connected_providers` is by definition connected —
  // round-21 dropped the soft-disable state when it renamed the field
  // from `enabled` to `connectionStatus` (Idle / Syncing / Error). A
  // failed-sync row is still a connected row; the failure surfaces via
  // the per-row sync pill below, not by hiding the card.
  const connected: ConnectedClient[] = providers ?? [];

  return (
    <div className={styles.root} data-testid="connected-agents-section">
      {/* ── Header ──────────────────────────────────────────── */}
      <div className={styles.header}>
        <h3 className={styles.title}>Connected providers</h3>
        <Button
          variant="secondary"
          size="sm"
          onPress={handleOpenAdd}
          data-testid="connected-agents-add-provider"
        >
          Add provider
        </Button>
      </div>

      {/* ── Body ────────────────────────────────────────────── */}
      {status === "pending" && (
        <ul className={styles.list} data-testid="connected-agents-skeleton">
          {[0, 1].map((i) => (
            <li key={i} className={cn(styles.row, styles.rowSkeleton)} aria-hidden="true" />
          ))}
        </ul>
      )}

      {status === "error" && (
        <p
          className={cn(styles.message, styles.errorMessage)}
          role="alert"
          data-testid="connected-agents-error"
        >
          Failed to load providers:{" "}
          {error instanceof Error ? error.message : "unknown error"}
        </p>
      )}

      {status === "success" && connected.length === 0 && (
        <p className={styles.message} data-testid="connected-agents-empty">
          No providers connected. Press &ldquo;Add provider&rdquo; to connect
          one of the supported agentic clients.
        </p>
      )}

      {status === "success" && connected.length > 0 && (
        <ul
          className={styles.list}
          data-testid="connected-agents-list"
          role="list"
        >
          {connected.map((provider) => (
            <ProviderRow key={provider.id} provider={provider} />
          ))}
        </ul>
      )}

      <AddProviderDialog isOpen={isAddOpen} onClose={handleCloseAdd} />
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Row — name + sync-state pill + Remove action.
// Kept as a sibling component so the remove mutation per row is scoped
// (not called inside a `.map`).
// ─────────────────────────────────────────────────────────────────────────────

interface ProviderRowProps {
  provider: ConnectedClient;
}

function ProviderRow({ provider }: ProviderRowProps): ReactElement {
  const removeMutation = useRemoveProviderMutation();
  const syncQuery = useSyncStatus();
  const { pushToast } = useToast();

  const isThisFailing =
    syncQuery.data?.state === "error" &&
    (syncQuery.data.failingProviders ?? []).includes(provider.id);

  // Per-row sync state: per-provider failure surfaces inline; otherwise
  // we mirror the global state so the row reads "Syncing…" while the
  // backend fanout is in flight.
  const rowSyncLabel: string = (() => {
    if (isThisFailing) return "Sync error";
    switch (syncQuery.data?.state) {
      case "syncing":
        return "Syncing…";
      case "error":
      case "idle":
      case undefined:
      default:
        return "Synced";
    }
  })();

  const handleRemove = (): void => {
    removeMutation.mutate(provider.id, {
      onSuccess: () => {
        pushToast("success", `${provider.displayName} removed`);
      },
      onError: (err) => {
        pushToast("error", `Failed to remove: ${err.message}`);
      },
    });
  };

  return (
    <li
      className={styles.row}
      data-testid={`connected-agents-row-${provider.id}`}
    >
      <span className={styles.rowName}>{provider.displayName}</span>
      <span
        className={cn(
          styles.syncPill,
          isThisFailing && styles.syncPillError,
          syncQuery.data?.state === "syncing" && styles.syncPillSyncing,
        )}
        data-testid={`connected-agents-row-sync-${provider.id}`}
        aria-live="polite"
      >
        {rowSyncLabel}
      </span>
      <Button
        variant="ghost"
        size="sm"
        onPress={handleRemove}
        isPending={removeMutation.isPending}
        aria-label={`Remove ${provider.displayName}`}
        data-testid={`connected-agents-row-remove-${provider.id}`}
      >
        Remove
      </Button>
    </li>
  );
}
