import type { ReactElement } from "react";

import type { SidecarStatus } from "../useSidecarStatus";
import styles from "./SidecarStatusPill.module.css";

interface SidecarStatusPillProps {
  status: SidecarStatus;
}

/**
 * MCP Sidecar status badge. Colour of the leading dot is driven by status
 * tokens (`--color-status-*`) so it tracks the active theme. PoC for ctq-56
 * ADR-0002 spike.
 */
export function SidecarStatusPill({
  status,
}: SidecarStatusPillProps): ReactElement {
  switch (status.state) {
    case "running":
      return (
        <span>
          <span className={`${styles.dot} ${styles.dotRunning}`} />
          Running (pid {status.pid})
        </span>
      );
    case "starting":
      return (
        <span>
          <span className={`${styles.dot} ${styles.dotStarting}`} />
          Starting…
        </span>
      );
    case "stopped":
      return (
        <span>
          <span className={`${styles.dot} ${styles.dotStopped}`} />
          Stopped
        </span>
      );
    case "crashed":
      return (
        <span>
          <span className={`${styles.dot} ${styles.dotCrashed}`} />
          Crashed
          {status.exitCode !== null ? ` (exit ${String(status.exitCode)})` : ""}
        </span>
      );
  }
}
