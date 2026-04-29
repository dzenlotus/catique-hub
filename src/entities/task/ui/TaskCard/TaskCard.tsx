import type { ReactElement } from "react";
import { MessageSquare, Paperclip, Check } from "lucide-react";

import { cn } from "@shared/lib";

import type { Task } from "../../model/types";

import styles from "./TaskCard.module.css";

// ---------------------------------------------------------------------------
// Relative-time helper (no date-fns dependency)
// ---------------------------------------------------------------------------

/**
 * Format a Unix timestamp (seconds as bigint) as a human-readable relative
 * string: "just now", "5m ago", "2h ago", "yesterday", or "Mon".
 */
function formatRelativeTime(createdAtSeconds: bigint): string {
  const nowMs = Date.now();
  const createdMs = Number(createdAtSeconds) * 1000;
  const diffMs = nowMs - createdMs;

  // Negative diff (clock skew) — just show "just now".
  if (diffMs < 0) return "just now";

  const diffSec = Math.floor(diffMs / 1000);
  if (diffSec < 60) return "just now";

  const diffMin = Math.floor(diffSec / 60);
  if (diffMin < 60) return `${String(diffMin)}m ago`;

  const diffHr = Math.floor(diffMin / 60);
  if (diffHr < 24) return `${String(diffHr)}h ago`;

  const diffDays = Math.floor(diffHr / 24);
  if (diffDays === 1) return "yesterday";

  // More than 2 days ago — show weekday abbreviation.
  const d = new Date(createdMs);
  return d.toLocaleDateString("en-US", { weekday: "short" });
}

/**
 * Format a Unix timestamp (seconds as bigint) as an absolute ISO-like string
 * suitable for a tooltip title attribute.
 */
function formatAbsoluteDate(createdAtSeconds: bigint): string {
  const d = new Date(Number(createdAtSeconds) * 1000);
  return d.toLocaleString("en-US", {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

// ---------------------------------------------------------------------------

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
   * Number of prompts attached to this task. When defined and > 0, a
   * MessageSquare chip renders in the meta row. The value comes from
   * `useTaskPrompts` inside TaskDialog (fetched per-task on open) rather
   * than from the kanban grid, to avoid an N+1 query per visible card.
   * Pass `undefined` (or omit) to suppress the chip while the source has
   * not yet loaded — the chip is intentionally hidden in that case.
   */
  promptsCount?: number;
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
  /**
   * Resolved role name to display on the badge instead of the raw roleId.
   * Supplied by the parent widget after a `useRoles()` lookup. Falls back
   * to `task.roleId` when omitted (loading) or when the role isn't found.
   */
  roleName?: string;
  /**
   * Role accent colour (CSS colour string or null). When provided, the
   * role badge background is tinted with this colour at low opacity.
   */
  roleColor?: string | null;
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
  promptsCount,
  isPending = false,
  dragOverlay = false,
  isDoneColumn = false,
  roleName,
  roleColor,
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

  const resolvedRoleName = roleName ?? task.roleId ?? undefined;

  const ariaLabel = task.roleId
    ? `Task ${task.title}, role ${resolvedRoleName ?? task.roleId}`
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
          promptsCount={promptsCount}
          isDoneColumn={isDoneColumn}
          resolvedRoleName={resolvedRoleName}
          roleColor={roleColor}
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
        promptsCount={promptsCount}
        isDoneColumn={isDoneColumn}
        resolvedRoleName={resolvedRoleName}
        roleColor={roleColor}
      />
    </button>
  );
}

interface CardBodyProps {
  task: Task;
  attachmentsCount: number;
  /** See `TaskCardProps.promptsCount` for suppression semantics. */
  promptsCount?: number | undefined;
  isDoneColumn: boolean;
  /** Resolved human-readable role name. Falls back to task.roleId when absent. */
  resolvedRoleName?: string | undefined;
  /** Role colour token (CSS colour string or null). */
  roleColor?: string | null | undefined;
}

function CardBody({
  task,
  attachmentsCount,
  promptsCount,
  isDoneColumn,
  resolvedRoleName,
  roleColor,
}: CardBodyProps): ReactElement {
  // Slug chip: format `ctq-NN` — use task.slug directly (it already
  // carries the generated slug from the backend).
  const slugLabel = task.slug;

  // Role badge inline style — tint the background with the role colour when
  // present (10 % opacity overlay on top of the default accent-soft token).
  const roleBadgeStyle: React.CSSProperties | undefined =
    roleColor
      ? { backgroundColor: `${roleColor}22`, color: roleColor }
      : undefined;

  // Age indicator — relative time from createdAt (Unix seconds as bigint).
  // Skip when createdAt is 0 (placeholder / test data).
  const showAge = task.createdAt !== 0n;
  const relativeTime = showAge ? formatRelativeTime(task.createdAt) : null;
  const absoluteDate = showAge ? formatAbsoluteDate(task.createdAt) : null;

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

      {/* Bottom meta row: age (left) + role badge + attachments + slug chip (right) */}
      <div className={styles.bottomRow}>
        <span className={styles.meta}>
          {/* Age indicator — far-left of the meta row */}
          {relativeTime !== null ? (
            <time
              className={styles.age}
              title={absoluteDate ?? undefined}
              dateTime={new Date(Number(task.createdAt) * 1000).toISOString()}
              data-testid="task-card-age"
            >
              {relativeTime}
            </time>
          ) : null}

          {/* Role badge: show resolved name, tinted by role colour when present */}
          {task.roleId ? (
            <span
              className={styles.roleBadge}
              title={`Role: ${resolvedRoleName ?? task.roleId}`}
              style={roleBadgeStyle}
              data-testid="task-card-role-badge"
            >
              {resolvedRoleName ?? task.roleId}
            </span>
          ) : null}

          {/* Attachment count chip */}
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

          {/* Prompt count chip — suppressed when promptsCount is undefined
              (source not yet loaded, e.g. outside TaskDialog context). */}
          {promptsCount !== undefined && promptsCount > 0 ? (
            <span
              className={styles.attachments}
              aria-label={`${promptsCount} prompts attached`}
              data-testid="task-card-prompts-count"
            >
              <MessageSquare size={12} aria-hidden={true} />
              {promptsCount}
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
