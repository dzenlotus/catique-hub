import type { ReactElement } from "react";
import { Paperclip, Check } from "lucide-react";

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
  /**
   * DS v1: when true, renders a green checkmark in the top-right corner.
   * Derived by the parent KanbanColumn from the column name heuristic
   * (contains "done" / "готово").
   */
  isDoneColumn?: boolean;
  /** Optional class merged onto the root. */
  className?: string;
}

/**
 * `TaskCard` — presentational card for one task.
 *
 * DS v1 layout (vertical):
 *   1. Top row — slug chip (left) + done checkmark (right, conditional)
 *   2. Title — 2-line clamp, semibold
 *   3. Description excerpt — 2-3 line clamp, muted (optional)
 *   4. Bottom meta row — role badge + paperclip badge (NO position rank)
 *
 * Activation: native `<button>` handles Enter / Space / click.
 */
export function TaskCard({
  task,
  onSelect,
  onEdit: _onEdit,
  attachmentsCount = 0,
  isPending = false,
  dragOverlay = false,
  isDoneColumn = false,
  className,
}: TaskCardProps): ReactElement {
  if (isPending || !task) {
    return (
      <div
        className={cn(styles.card, styles.skeleton, className)}
        aria-hidden="true"
        data-testid="task-card-skeleton"
      >
        <div className={cn(styles.skeletonLine, styles.skeletonSlug)} />
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
        <CardBody
          task={task}
          attachmentsCount={attachmentsCount}
          isDoneColumn={isDoneColumn}
        />
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
      <CardBody
        task={task}
        attachmentsCount={attachmentsCount}
        isDoneColumn={isDoneColumn}
      />
    </button>
  );
}

interface CardBodyProps {
  task: Task;
  attachmentsCount: number;
  isDoneColumn: boolean;
}

function CardBody({
  task,
  attachmentsCount,
  isDoneColumn,
}: CardBodyProps): ReactElement {
  // Slug chip: format `ctq-NN` — use task.slug directly (it already
  // carries the generated slug from the backend).
  const slugLabel = task.slug;

  return (
    <>
      {/* Top row: done checkmark (top-right only, no slug here) */}
      {isDoneColumn ? (
        <div className={styles.topRow}>
          <span className={styles.topRowSpacer} />
          <Check
            size={16}
            strokeWidth={2.5}
            aria-label="Выполнено"
            className={styles.doneCheck}
            data-testid="task-card-done-check"
          />
        </div>
      ) : null}

      {/* Title — 2-line clamp */}
      <span className={styles.title}>{task.title}</span>

      {/* Description excerpt — rendered only when non-empty */}
      {task.description ? (
        <span className={styles.description}>{task.description}</span>
      ) : null}

      {/* Bottom meta row: role badge + attachments + slug chip at right */}
      <div className={styles.bottomRow}>
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
        </span>
        {/* Slug chip — bottom-right per DS v1 mockup */}
        <span
          className={styles.slugChip}
          title={slugLabel}
          data-testid="task-card-slug-chip"
        >
          {slugLabel}
        </span>
      </div>
    </>
  );
}
