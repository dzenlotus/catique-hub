import { useState, type ReactElement } from "react";

import { Button } from "@shared/ui";
import { cn } from "@shared/lib";
import {
  ConnectedClientCard,
  useConnectedClients,
  useDiscoverClientsMutation,
  useSetClientEnabledMutation,
  useSyncedClientRoles,
  useSyncRolesToClientMutation,
} from "@entities/connected-client";
import { ClientInstructionsEditor } from "@widgets/client-instructions-editor";

import styles from "./ConnectedAgentsSection.module.css";

/**
 * `ClientCardRow` — one card with its synced-roles query and sync mutation
 * isolated in a component boundary so hooks aren't called in a loop.
 */
function ClientCardRow({
  client,
  onToggleEnabled,
  onEditInstructions,
  isToggling,
  syncMutation,
}: {
  client: import("@entities/connected-client").ConnectedClient;
  onToggleEnabled: (id: string, enabled: boolean) => void;
  onEditInstructions: (id: string) => void;
  isToggling: boolean;
  syncMutation: ReturnType<typeof useSyncRolesToClientMutation>;
}): ReactElement {
  const { data: syncedRoles } = useSyncedClientRoles(
    client.supportsRoleSync ? client.id : "",
  );

  const handleSyncRoles = (id: string): void => {
    syncMutation.mutate(id);
  };

  return (
    <ConnectedClientCard
      client={client}
      onToggleEnabled={onToggleEnabled}
      onEditInstructions={onEditInstructions}
      onSyncRoles={handleSyncRoles}
      isSyncing={
        syncMutation.isPending && syncMutation.variables === client.id
      }
      {...(syncedRoles !== undefined ? { syncedRoles } : {})}
      isToggling={isToggling}
    />
  );
}

/**
 * `ConnectedAgentsSection` — "Connected agents" section for the
 * Settings view (ctq-67 / ctq-68 / ctq-69).
 *
 * Shows all known agentic clients with their installed/enabled status.
 * Provides a "Просканировать" button that triggers a filesystem rescan
 * via `discover_clients`. Each card exposes "Редактировать инструкции"
 * (ctq-68) and "Синхронизировать роли" (ctq-69).
 */
export function ConnectedAgentsSection(): ReactElement {
  const { data: clients, status, error } = useConnectedClients();
  const discoverMutation = useDiscoverClientsMutation();
  const toggleMutation = useSetClientEnabledMutation();
  const syncMutation = useSyncRolesToClientMutation();

  /** Id of the client whose instructions are currently being edited. */
  const [selectedClientId, setSelectedClientId] = useState<string | null>(null);

  const handleDiscover = (): void => {
    discoverMutation.mutate();
  };

  const handleToggle = (id: string, enabled: boolean): void => {
    toggleMutation.mutate({ id, enabled });
  };

  const handleEditInstructions = (id: string): void => {
    setSelectedClientId(id);
  };

  const handleEditorClose = (): void => {
    setSelectedClientId(null);
  };

  // Resolve display name for the currently selected client.
  const selectedClient = clients?.find((c) => c.id === selectedClientId);

  return (
    <div className={styles.root}>
      {/* ── Header ──────────────────────────────────────────── */}
      <div className={styles.header}>
        <h3 className={styles.title}>Connected agents</h3>
        <Button
          variant="secondary"
          size="sm"
          onPress={handleDiscover}
          isDisabled={discoverMutation.isPending}
          data-testid="discover-clients-button"
        >
          {discoverMutation.isPending ? "Сканирование…" : "Просканировать"}
        </Button>
      </div>

      {/* ── Body ────────────────────────────────────────────── */}
      {status === "pending" && (
        <div className={styles.grid} data-testid="connected-agents-skeleton">
          {[0, 1, 2, 3].map((i) => (
            <ConnectedClientCard key={i} isPending />
          ))}
        </div>
      )}

      {status === "error" && (
        <p className={cn(styles.message, styles.errorMessage)} role="alert" data-testid="connected-agents-error">
          Не удалось загрузить список клиентов:{" "}
          {error instanceof Error ? error.message : "неизвестная ошибка"}
        </p>
      )}

      {status === "success" && clients.length === 0 && (
        <p className={styles.message} data-testid="connected-agents-empty">
          Клиенты не найдены. Нажмите «Просканировать», чтобы обнаружить
          установленные агентские клиенты.
        </p>
      )}

      {status === "success" && clients.length > 0 && (
        <div className={styles.grid} data-testid="connected-agents-grid">
          {clients.map((client) => (
            <ClientCardRow
              key={client.id}
              client={client}
              onToggleEnabled={handleToggle}
              onEditInstructions={handleEditInstructions}
              isToggling={
                toggleMutation.isPending &&
                toggleMutation.variables?.id === client.id
              }
              syncMutation={syncMutation}
            />
          ))}
        </div>
      )}

      {/* ── Instructions editor dialog ───────────────────────── */}
      <ClientInstructionsEditor
        clientId={selectedClientId}
        displayName={selectedClient?.displayName ?? selectedClientId ?? ""}
        onClose={handleEditorClose}
      />
    </div>
  );
}
