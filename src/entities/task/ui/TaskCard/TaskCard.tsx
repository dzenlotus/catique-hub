import type { ReactElement } from "react";
import { Paperclip } from "lucide-react";

import { cn } from "@shared/lib";

import type { Task } from "../../model/types";

import styles from "./TaskCard.module.css";

export interface TaskCardProps {
  /** Task to render. Omitted (or with `isPending`) renders a skeleton. */
  task?: Task;
  /** Click / keyboard-activate handler. Receives the task id. */
  onSelect?: (id: string) => void;
  /** Optional secondary action — e.g. open edit dialog. */
  onEdit?: (id: string) => void;
  /**
   * Number of attachments. When > 0 a paperclip badge appears on the
   * card. Source comes from the attachments slice (E4c) — pass 0 (or
   * omit) until then.
   */
  attachmentsCount?: number;
  /**
   * Loading-state variant. Renders a skeleton with no interactivity.
   * Useful when the parent column is paginating tasks.
   */
  isPending?: boolean;
  /**
   * When true, renders the card as a non-interactive `<div>` — used
   * inside a `<DragOverlay>` where the dragging visual mustn't steal
   * focus or react to clicks. The widget layer toggles this.
   */
  dragOverlay?: boolean;
  /** Optional class merged onto the root. */
  className?: string;
}

/**
 * `TaskCard` — presentational card for one task.
 *
 * Layout (vertical):
 *   1. title row — single line, truncate
 *   2. meta row — role badge (if `roleId`) + attachments badge (if any)
 *      + position rank on the right
 *
 * Activation: native `<button>` handles Enter / Space / click.
 *
 * WCAG: name on background = `--color-text-default` on
 * `--color-surface-raised` (16.5:1 light, 12.6:1 dark — AAA).
 */
export function TaskCard({
  task,
  onSelect,
  onEdit: _onEdit,
  attachmentsCount = 0,
  isPending = false,
  dragOverlay = false,
  className,
}: TaskCardProps): ReactElement {
  if (isPending || !task) {
    return (
      <div
        className={cn(styles.card, styles.skeleton, className)}
        aria-hidden="true"
        data-testid="task-card-skeleton"
      >
        <div className={cn(styles.skeletonLine, styles.skeletonTitle)} />
        <div className={cn(styles.skeletonLine, styles.skeletonMeta)} />
      </div>
    );
  }

  const ariaLabel = task.roleId
    ? `Task ${task.title}, role ${task.roleId}`
    : `Task ${task.title}`;

  // The drag-overlay variant is rendered atop the original card during
  // a drag — it must not capture focus or fire activation events.
  if (dragOverlay) {
    return (
      <div
        className={cn(styles.card, styles.interactive, styles.overlay, className)}
        data-testid={`task-card-overlay-${task.id}`}
      >
        <CardBody task={task} attachmentsCount={attachmentsCount} />
      </div>
    );
  }

  return (
    <button
      type="button"
      className={cn(styles.card, styles.interactive, className)}
      onClick={() => onSelect?.(task.id)}
      aria-label={ariaLabel}
      data-testid={`task-card-${task.id}`}
    >
      <CardBody task={task} attachmentsCount={attachmentsCount} />
    </button>
  );
}

interface CardBodyProps {
  task: Task;
  attachmentsCount: number;
}

function CardBody({ task, attachmentsCount }: CardBodyProps): ReactElement {
  return (
    <>
      <span className={styles.title}>{task.title}</span>
      <span className={styles.meta}>
        {task.roleId ? (
          <span
            className={styles.roleBadge}
            title={`Role: ${task.roleId}`}
            data-testid="task-card-role-badge"
          >
            {task.roleId}
          </span>
        ) : null}
        {attachmentsCount > 0 ? (
          <span
            className={styles.attachments}
            aria-label={`${attachmentsCount} attachments`}
            data-testid="task-card-attachments"
          >
            <Paperclip size={12} aria-hidden={true} />
            {attachmentsCount}
          </span>
        ) : null}
        <span className={styles.position} aria-label="Position rank">
          #{task.position.toFixed(0)}
        </span>
      </span>
    </>
  );
}
