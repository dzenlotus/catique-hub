import type { ReactElement } from "react";

import { Button } from "@shared/ui";
import { cn } from "@shared/lib";
import {
  ConnectedClientCard,
  useConnectedClients,
  useDiscoverClientsMutation,
  useSetClientEnabledMutation,
} from "@entities/connected-client";

import styles from "./ConnectedAgentsSection.module.css";

/**
 * `ConnectedAgentsSection` — "Connected agents" section for the
 * Settings view (ctq-67).
 *
 * Shows all known agentic clients with their installed/enabled status.
 * Provides a "Просканировать" button that triggers a filesystem rescan
 * via `discover_clients`.
 */
export function ConnectedAgentsSection(): ReactElement {
  const { data: clients, status, error } = useConnectedClients();
  const discoverMutation = useDiscoverClientsMutation();
  const toggleMutation = useSetClientEnabledMutation();

  const handleDiscover = (): void => {
    discoverMutation.mutate();
  };

  const handleToggle = (id: string, enabled: boolean): void => {
    toggleMutation.mutate({ id, enabled });
  };

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
            <ConnectedClientCard
              key={client.id}
              client={client}
              onToggleEnabled={handleToggle}
              isToggling={
                toggleMutation.isPending &&
                toggleMutation.variables?.id === client.id
              }
            />
          ))}
        </div>
      )}
    </div>
  );
}
