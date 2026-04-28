import type { ReactElement } from "react";

import { cn } from "@shared/lib";

import type { ConnectedClient } from "../../model/types";

import styles from "./ConnectedClientCard.module.css";

export interface ConnectedClientCardProps {
  /**
   * Client to render. When omitted (or with `isPending`), the card
   * renders a skeleton placeholder.
   */
  client?: ConnectedClient;
  /**
   * Called when the user toggles the enabled switch.
   * Receives the new desired state.
   */
  onToggleEnabled?: (id: string, enabled: boolean) => void;
  /**
   * Called when the user clicks "Редактировать инструкции". Receives the
   * client id so the parent can open the `ClientInstructionsEditor`.
   */
  onEditInstructions?: (id: string) => void;
  /**
   * `true` while a toggle mutation is in-flight for this card.
   * Disables the switch to prevent double-clicks.
   */
  isToggling?: boolean;
  /** Loading-state variant — renders a static skeleton. */
  isPending?: boolean;
  /** Optional extra class on the root element. */
  className?: string;
}

/**
 * `ConnectedClientCard` — presentational card for a single agentic client.
 *
 * Vertical layout:
 *   - top:    display name + installed/not-installed pill
 *   - middle: config dir path
 *   - bottom: enabled/disabled toggle
 */
export function ConnectedClientCard({
  client,
  onToggleEnabled,
  onEditInstructions,
  isToggling = false,
  isPending = false,
  className,
}: ConnectedClientCardProps): ReactElement {
  if (isPending || !client) {
    return (
      <div
        className={cn(styles.card, styles.skeleton, className)}
        aria-hidden="true"
        data-testid="connected-client-card-skeleton"
      >
        <div className={cn(styles.skeletonLine, styles.skeletonName)} />
        <div className={cn(styles.skeletonLine, styles.skeletonPath)} />
        <div className={cn(styles.skeletonLine, styles.skeletonToggle)} />
      </div>
    );
  }

  const handleToggle = (): void => {
    onToggleEnabled?.(client.id, !client.enabled);
  };

  const handleEditInstructions = (): void => {
    onEditInstructions?.(client.id);
  };

  return (
    <div
      className={cn(styles.card, className)}
      data-testid="connected-client-card"
    >
      {/* ── Header: name + installed pill ─────────────────────────── */}
      <div className={styles.header}>
        <span className={styles.name}>{client.displayName}</span>
        <span
          className={cn(
            styles.pill,
            client.installed ? styles.pillInstalled : styles.pillMissing,
          )}
          data-testid="client-installed-pill"
        >
          {client.installed ? "Установлен" : "Не найден"}
        </span>
      </div>

      {/* ── Config path ───────────────────────────────────────────── */}
      <span
        className={styles.configPath}
        title={client.configDir}
        data-testid="client-config-path"
      >
        {client.configDir}
      </span>

      {/* ── Enabled toggle ───────────────────────────────────────── */}
      <div className={styles.footer}>
        <span className={styles.toggleLabel}>
          {client.enabled ? "Включён" : "Отключён"}
        </span>
        <button
          type="button"
          role="switch"
          aria-checked={client.enabled}
          aria-label={`${client.enabled ? "Отключить" : "Включить"} ${client.displayName}`}
          className={cn(
            styles.toggle,
            client.enabled && styles.toggleOn,
            isToggling && styles.toggleBusy,
          )}
          onClick={handleToggle}
          disabled={isToggling}
          data-testid="client-enabled-toggle"
        >
          <span className={styles.toggleThumb} />
        </button>
      </div>

      {/* ── Edit instructions ─────────────────────────────────────── */}
      <button
        type="button"
        className={styles.editInstructionsBtn}
        onClick={handleEditInstructions}
        data-testid="client-edit-instructions-btn"
        aria-label={`Редактировать инструкции для ${client.displayName}`}
      >
        Редактировать инструкции
      </button>
    </div>
  );
}
