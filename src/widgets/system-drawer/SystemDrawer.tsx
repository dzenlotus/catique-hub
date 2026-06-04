/**
 * SystemDrawer — slide-in panel anchored to the right edge that surfaces
 * MCP sidecar + connected-provider runtime controls.
 *
 * Per Project Map v3: runtime concerns live here, not in /settings.
 *
 * v3 Phase 6 a11y: uses react-aria-components `<ModalOverlay>` so we get
 *   - Focus trap inside the drawer while open
 *   - ESC closes (`isKeyboardDismissable`)
 *   - Scrim click closes (`isDismissable`)
 *   - Focus restore on close
 *   - Background scroll lock
 */
import { useState, type ReactElement } from "react";
import {
  Dialog as AriaDialog,
  Modal,
  ModalOverlay,
} from "react-aria-components";

import {
  useConnectedClients,
  type ConnectedClient,
} from "@entities/connected-client";
import { Button } from "@shared/ui";
import { invoke } from "@shared/api";
import {
  refreshSidecarStatus,
  useSidecarStatus,
  type SidecarStatus,
} from "@shared/lib";

import styles from "./SystemDrawer.module.css";

export interface SystemDrawerProps {
  open: boolean;
  onClose: () => void;
}

function sidecarLabel(status: SidecarStatus): string {
  switch (status.state) {
    case "running":
      return `Running (pid ${status.pid})`;
    case "starting":
      return "Starting…";
    case "stopped":
      return "Stopped";
    case "crashed":
      return status.exitCode === null
        ? "Crashed"
        : `Crashed (exit ${String(status.exitCode)})`;
  }
}

export function SystemDrawer(props: SystemDrawerProps): ReactElement {
  const { open, onClose } = props;
  const sidecar = useSidecarStatus();
  const providers = useConnectedClients();
  const [busy, setBusy] = useState(false);

  async function callSidecarCommand(cmd: string): Promise<void> {
    setBusy(true);
    try {
      await invoke<unknown>(cmd);
    } catch {
      // Surfaced to the user via the next status poll. Toasts are
      // wired in a separate refactor pass.
    } finally {
      try {
        await refreshSidecarStatus();
      } catch {
        // ignored — covered by the next poll
      }
      setBusy(false);
    }
  }

  return (
    <ModalOverlay
      className={styles.overlay}
      isOpen={open}
      onOpenChange={(next) => {
        if (!next) onClose();
      }}
      isDismissable
      isKeyboardDismissDisabled={false}
      data-testid="system-drawer-overlay"
    >
      <Modal className={styles.modal}>
        <AriaDialog
          className={styles.panel}
          aria-label="System drawer"
          data-testid="system-drawer"
        >
          <header className={styles.header}>
            <h2 className={styles.title}>System</h2>
            <Button
              variant="ghost"
              size="sm"
              aria-label="Close system drawer"
              onPress={onClose}
              data-testid="system-drawer-close"
            >
              ✕
            </Button>
          </header>

          <section className={styles.section} aria-labelledby="sd-sidecar">
            <h3 id="sd-sidecar" className={styles.sectionTitle}>
              MCP sidecar
            </h3>
            <p
              className={styles.metaLine}
              data-testid="system-drawer-sidecar-status"
            >
              {sidecarLabel(sidecar)}
            </p>
            <div className={styles.actions}>
              <Button
                variant="secondary"
                size="sm"
                isDisabled={busy || sidecar.state === "running"}
                onPress={() => {
                  void callSidecarCommand("sidecar_start");
                }}
                data-testid="system-drawer-sidecar-start"
              >
                Start
              </Button>
              <Button
                variant="secondary"
                size="sm"
                isDisabled={
                  busy ||
                  sidecar.state === "stopped" ||
                  sidecar.state === "crashed"
                }
                onPress={() => {
                  void callSidecarCommand("sidecar_stop");
                }}
                data-testid="system-drawer-sidecar-stop"
              >
                Stop
              </Button>
              <Button
                variant="secondary"
                size="sm"
                isDisabled={busy}
                onPress={() => {
                  void callSidecarCommand("sidecar_restart");
                }}
                data-testid="system-drawer-sidecar-restart"
              >
                Restart
              </Button>
            </div>
          </section>

          <section className={styles.section} aria-labelledby="sd-providers">
            <h3 id="sd-providers" className={styles.sectionTitle}>
              Connected providers
            </h3>
            {providers.data === undefined || providers.data.length === 0 ? (
              <p className={styles.metaLine}>None connected.</p>
            ) : (
              <ul className={styles.providerList}>
                {providers.data.map((client: ConnectedClient) => (
                  <li key={client.id} className={styles.providerItem}>
                    <span className={styles.providerName}>
                      {client.displayName}
                    </span>
                  </li>
                ))}
              </ul>
            )}
            <p className={styles.footnote}>
              Manage providers from Settings → Integrations until the
              inline-reconnect flow ships.
            </p>
          </section>
        </AriaDialog>
      </Modal>
    </ModalOverlay>
  );
}
