/**
 * RunningTaskIndicator — spinner-dot + colored stripe rendered on a
 * kanban TaskCard when the task is mid-run.
 *
 * Per Project Map v3, agent-running tasks must be visible at a glance
 * without opening the detail page. The indicator listens to the task
 * status state passed in by the parent — animation is gated by
 * `prefers-reduced-motion`.
 */
import type { ReactElement } from "react";

import type { TaskStatus } from "@shared/ui/StatusBadge";

import styles from "./RunningTaskIndicator.module.css";

export interface RunningTaskIndicatorProps {
  status: TaskStatus;
  /** Optional test id. */
  "data-testid"?: string;
}

export function RunningTaskIndicator(
  props: RunningTaskIndicatorProps,
): ReactElement | null {
  const { status } = props;
  const testId = props["data-testid"] ?? "running-task-indicator";
  if (status !== "running" && status !== "queued") return null;
  return (
    <span
      className={styles.root}
      data-status={status}
      data-testid={testId}
      aria-label={status === "running" ? "Task running" : "Task queued"}
    >
      <span className={styles.dot} aria-hidden="true" />
      <span className={styles.stripe} aria-hidden="true" />
    </span>
  );
}
