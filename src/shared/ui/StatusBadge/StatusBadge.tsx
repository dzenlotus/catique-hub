/**
 * StatusBadge — task-run lifecycle pill rendered on the task detail
 * header and surfaced in kanban cards.
 *
 * v3 Wave 4 — UI lands ahead of the run-lifecycle events. The
 * placeholder displays `idle` until the backend wires events through
 * the existing event-bus and the consumer flips the value.
 */
import type { ReactElement } from "react";

import { cn } from "@shared/lib";

import styles from "./StatusBadge.module.css";

export type TaskStatus =
  | "idle"
  | "queued"
  | "running"
  | "completed"
  | "failed";

export interface StatusBadgeProps {
  status: TaskStatus;
  /** Optional class merged onto the chip root. */
  className?: string;
  /** Optional test id. */
  "data-testid"?: string;
}

const LABEL: Record<TaskStatus, string> = {
  idle: "Idle",
  queued: "Queued",
  running: "Running",
  completed: "Completed",
  failed: "Failed",
};

export function StatusBadge(props: StatusBadgeProps): ReactElement {
  const { status, className } = props;
  const testId = props["data-testid"] ?? `status-badge-${status}`;
  return (
    <span
      className={cn(styles.root, className)}
      data-status={status}
      data-testid={testId}
      aria-label={`Task status: ${LABEL[status]}`}
    >
      <span className={styles.dot} aria-hidden="true" />
      <span className={styles.label}>{LABEL[status]}</span>
    </span>
  );
}
