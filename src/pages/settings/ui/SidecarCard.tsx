import type { ReactElement } from "react";
import { useCallback } from "react";

import { Button } from "@shared/ui";

import { useSidecarStatus } from "../useSidecarStatus";
import { SidecarStatusPill } from "./SidecarStatusPill";
import styles from "../SettingsView.module.css";
import localStyles from "./SidecarCard.module.css";

/**
 * MCP Sidecar card.
 *
 * Refactor v3 Wave 6: runtime controls relocated to the status-bar drawer
 * (Project Map §"System drawer"). This card is a read-only mirror retained
 * for one release so deep links to `#settings-mcp-sidecar` still resolve.
 * Latency + restart controls also live in `<SystemDrawer/>`.
 */
export function SidecarCard(): ReactElement {
  const { status, latencyMs, isRestarting, restart } = useSidecarStatus();

  const handleRestartPress = useCallback(() => {
    void restart();
  }, [restart]);

  return (
    <section
      className={styles.card}
      aria-labelledby="settings-mcp-sidecar"
      data-testid="settings-mcp-sidecar-section"
    >
      <h3 id="settings-mcp-sidecar" className={styles.cardHeading}>
        MCP Sidecar
      </h3>
      <div className={styles.cardBody}>
        <dl className={styles.dl}>
          <dt className={styles.dt}>Status</dt>
          <dd className={styles.dd} data-testid="sidecar-status-pill">
            <SidecarStatusPill status={status} />
          </dd>

          <dt className={styles.dt}>Latency</dt>
          <dd className={styles.dd} data-testid="sidecar-latency">
            {latencyMs !== null ? `${latencyMs.toFixed(2)} ms` : "—"}
          </dd>
        </dl>

        <div className={styles.actions}>
          <Button
            variant="secondary"
            size="sm"
            isDisabled={isRestarting}
            onPress={handleRestartPress}
            data-testid="sidecar-restart-button"
          >
            {isRestarting ? "Restarting…" : "Restart"}
          </Button>
        </div>
        <p className={localStyles.drawerHint}>
          Live runtime controls (restart, status, providers) also live in the
          status-bar drawer — click the indicators at the bottom of the window.
        </p>
      </div>
    </section>
  );
}
