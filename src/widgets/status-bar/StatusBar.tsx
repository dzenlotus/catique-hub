/**
 * StatusBar — always-visible runtime indicator strip at the bottom of
 * the app shell.
 *
 * The MCP sidecar + connected-providers state is displayed as plain,
 * NON-interactive indicators (dot + label). The only clickable element is
 * the trailing connection button, which opens the SystemDrawer for the
 * full runtime controls.
 *
 * Per Project Map v3, runtime concerns live here, not in /settings.
 */
import { useState, type ReactElement } from "react";

import { useConnectedClients } from "@entities/connected-client";
import { useSidecarStatus, type SidecarStatus } from "@shared/lib";
import { PixelCodingAppsWebsitesPlugin } from "@shared/ui/Icon";

import { SystemDrawer } from "@widgets/system-drawer";

import styles from "./StatusBar.module.css";

function sidecarLabel(status: SidecarStatus): string {
  switch (status.state) {
    case "running":
      return `MCP sidecar · running (pid ${status.pid})`;
    case "starting":
      return "MCP sidecar · starting…";
    case "stopped":
      return "MCP sidecar · stopped";
    case "crashed":
      return status.exitCode === null
        ? "MCP sidecar · crashed"
        : `MCP sidecar · crashed (exit ${String(status.exitCode)})`;
  }
}

function sidecarVariant(
  status: SidecarStatus,
): "ok" | "warn" | "error" | "idle" {
  switch (status.state) {
    case "running":
      return "ok";
    case "starting":
      return "warn";
    case "stopped":
      return "idle";
    case "crashed":
      return "error";
  }
}

export function StatusBar(): ReactElement {
  const sidecar = useSidecarStatus();
  const providersQuery = useConnectedClients();
  const [drawerOpen, setDrawerOpen] = useState(false);

  const providerCount =
    providersQuery.data === undefined ? 0 : providersQuery.data.length;

  const sidecarText = sidecarLabel(sidecar);
  const providersText =
    providerCount === 0
      ? "No providers connected"
      : `${String(providerCount)} provider${providerCount === 1 ? "" : "s"} connected`;

  function handleOpenDrawer(): void {
    setDrawerOpen(true);
  }

  function handleCloseDrawer(): void {
    setDrawerOpen(false);
  }

  return (
    <>
      <div
        className={styles.root}
        role="status"
        aria-label="Runtime status"
        data-testid="status-bar"
      >
        {/* Non-interactive status indicators. */}
        <span
          className={styles.indicator}
          data-variant={sidecarVariant(sidecar)}
          title={sidecarText}
          data-testid="status-bar-sidecar"
        >
          <span className={styles.dot} aria-hidden="true" />
          <span className={styles.label}>{sidecarText}</span>
        </span>

        <span
          className={styles.indicator}
          data-variant={providerCount > 0 ? "ok" : "idle"}
          title={providersText}
          data-testid="status-bar-providers"
        >
          <span className={styles.dot} aria-hidden="true" />
          <span className={styles.label}>{providersText}</span>
        </span>

        <span className={styles.spacer} />

        {/* The only clickable element — opens the SystemDrawer. */}
        <button
          type="button"
          className={styles.connection}
          data-variant={sidecarVariant(sidecar)}
          onClick={handleOpenDrawer}
          aria-label="Open system drawer"
          title="Open system drawer"
          data-testid="status-bar-drawer-button"
        >
          <PixelCodingAppsWebsitesPlugin width={20} height={20} aria-hidden />
        </button>
      </div>

      <SystemDrawer open={drawerOpen} onClose={handleCloseDrawer} />
    </>
  );
}
