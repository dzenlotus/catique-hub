/**
 * SyncIndicator — global provider-sync status pill rendered inside the
 * TopBar (round-21).
 *
 * Reads the global SyncStatus via `useSyncStatus`. The query is
 * invalidated by the `sync:status_changed` Tauri event in
 * `EventsProvider`, so transitions (idle → syncing → synced/error) are
 * push-driven, not polled.
 *
 * Visual contract:
 *   - state === "idle"    → render nothing (the bar stays clean).
 *   - state === "syncing" → animated icon + "Syncing…".
 *   - state === "error"   → error pill + tooltip listing failing
 *                           provider ids (when any).
 */

import { useState, useRef, type ReactElement } from "react";

import { useSyncStatus } from "@entities/connected-client";
import {
  PixelInterfaceEssentialSynchronizeArrowsSquare1,
  PixelInterfaceEssentialAlertCircle1,
} from "@shared/ui/Icon";
import { cn } from "@shared/lib";

import styles from "./SyncIndicator.module.css";

/**
 * `SyncIndicator` — compact icon + label. Hidden when the global sync
 * state is `idle`. Falls silent on query error so a backend hiccup
 * cannot wedge the topbar with a permanent banner — the Settings
 * surface is the right place to show that.
 */
export function SyncIndicator(): ReactElement | null {
  const { data: status } = useSyncStatus();
  const [isTooltipOpen, setIsTooltipOpen] = useState(false);
  const hostRef = useRef<HTMLDivElement | null>(null);

  if (!status || status.state === "idle") return null;

  if (status.state === "syncing") {
    return (
      <div
        ref={hostRef}
        className={cn(styles.host, styles.hostSyncing)}
        role="status"
        aria-live="polite"
        aria-label="Syncing providers"
        data-testid="top-bar-sync-indicator"
      >
        <PixelInterfaceEssentialSynchronizeArrowsSquare1
          width={14}
          height={14}
          className={styles.icon}
          aria-hidden="true"
        />
        <span className={styles.label}>Syncing…</span>
      </div>
    );
  }

  // ── state === "error" ────────────────────────────────────────────
  const failing = status.failingProviders ?? [];
  const tooltipText =
    failing.length > 0
      ? `Failing providers: ${failing.join(", ")}`
      : "Provider sync failed";

  const handleEnter = (): void => setIsTooltipOpen(true);
  const handleLeave = (): void => setIsTooltipOpen(false);

  return (
    <div
      ref={hostRef}
      className={cn(styles.host, styles.hostError)}
      role="status"
      aria-live="polite"
      onMouseEnter={handleEnter}
      onMouseLeave={handleLeave}
      onFocus={handleEnter}
      onBlur={handleLeave}
      tabIndex={0}
      aria-label={tooltipText}
      aria-describedby={isTooltipOpen ? "top-bar-sync-tooltip" : undefined}
      data-testid="top-bar-sync-indicator"
    >
      <PixelInterfaceEssentialAlertCircle1
        width={14}
        height={14}
        className={styles.icon}
        aria-hidden="true"
      />
      <span className={styles.label}>Sync error</span>
      {isTooltipOpen ? (
        <span
          id="top-bar-sync-tooltip"
          role="tooltip"
          className={styles.tooltip}
          data-testid="top-bar-sync-indicator-tooltip"
        >
          {tooltipText}
        </span>
      ) : null}
    </div>
  );
}
