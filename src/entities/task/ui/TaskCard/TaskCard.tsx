import { useRef, type ReactElement } from "react";
import {
  PixelInterfaceEssentialMessage,
  PixelInterfaceEssentialClip1,
  PixelBusinessProductCheck,
} from "@shared/ui/Icon";

import { cn } from "@shared/lib";
import { RunningTaskIndicator } from "@shared/ui";

import type { Task } from "../../model/types";
import { useTaskStatus } from "../../model/useTaskStatus";

import styles from "./TaskCard.module.css";

export interface TaskCardProps {
  /** Task to render. Omitted (or with `isPending`) renders a skeleton. */
  task?: Task;
  /** Click / keyboard-activate handler. Receives the task id. */
  onSelect?: (id: string) => void;
  /** Optional secondary action — e.g. open edit dialog. */
  onEdit?: (id: string) => void;
  /**
   * Whether this card is currently selected (part of the bulk selection).
   * When true the card renders an accent selection ring.
   */
  selected?: boolean;
  /**
   * Whether selection mode is active on the parent board (i.e. at least
   * one task is selected). Controls checkbox visibility and body-click
   * semantics.
   */
  selectionActive?: boolean;
  /**
   * Called when the user clicks the checkbox or the card body while
   * selection mode is active. Parent handles Shift/Ctrl modifier logic.
   */
  onToggleSelection?: (id: string, event: React.MouseEvent) => void;
  /**
   * Number of attachments. When > 0 a paperclip badge appears on the
   * card. Source comes from the attachments slice (E4c) — pass 0 (or
   * omit) until then.
   */
  attachmentsCount?: number;
  /**
   * Legacy: number of prompts attached to this task. Kept for backwards
   * compatibility with tests / stories pre-refactor-v3. New callers
   * should pass `effectiveCount` (combined prompts+skills+tools) instead.
   * When `effectiveCount` is defined it wins; otherwise this falls
   * through and the chip behaves as before.
   */
  promptsCount?: number;
  /**
   * Combined effective-context count — `effective_prompt_count +
   * effective_skill_count + effective_tool_count` from the Task row.
   * When defined and > 0 renders the meta chip with an "items" label
   * (refactor-v3 §"Effective context performance"). The per-kind
   * breakdown surfaces on the task detail panel, not on the card.
   */
  effectiveCount?: number;
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
  /**
   * Inline style — used by the kanban DnD wrapper to apply `opacity`
   * during drag. Forwarded to the root article element.
   */
  style?: React.CSSProperties;
  /**
   * React ref forwarded to the root article element. The kanban widget
   * passes `useSortable().ref` here so dnd-kit can register the element
   * as the drag source body (what visually moves during drag).
   */
  ref?: React.Ref<HTMLElement>;
  /**
   * Ref forwarded to the drag-handle button. The kanban widget passes
   * `useSortable().handleRef` here so that ONLY the handle initiates a
   * drag — clicking the card body still navigates / toggles selection.
   */
  handleRef?: React.Ref<HTMLButtonElement>;
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
  effectiveCount,
  isPending = false,
  dragOverlay = false,
  isDoneColumn = false,
  className,
  style,
  ref,
  handleRef,
  selected = false,
  selectionActive = false,
  onToggleSelection,
}: TaskCardProps): ReactElement {
  // Hoisted above the early returns below (skeleton / drag-overlay) so the
  // hook call order stays identical across renders (rules-of-hooks). Drives
  // the manual double-click detection in `handleBodyClick`.
  const lastClickAtRef = useRef<number>(0);

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

  // Roles are no longer surfaced on task UI — a task on a role-owned
  // board IS implicitly that role's task (see docs/decision-log.md
  // D-020 / CLAUDE.md "role ownership invariant"). Aria-label drops
  // the role qualifier accordingly.
  const ariaLabel = `Task ${task.title}`;

  // The drag-overlay variant is rendered atop the original card during
  // a drag — it must not capture focus or fire activation events.
  if (dragOverlay) {
    return (
      <div
        className={cn(styles.card, styles.overlay, className)}
        data-testid={`task-card-overlay-${task.id}`}
      >
        <CardBody
          task={task}
          attachmentsCount={attachmentsCount}
          promptsCount={promptsCount}
          effectiveCount={effectiveCount}
          isDoneColumn={isDoneColumn}
        />
      </div>
    );
  }

  // Round 19c: instead of relying on the browser's `dblclick` event —
  // which is unreliable inside the dnd-kit pointer-event wrapper — we
  // detect double-click ourselves via a 350-ms time-since-last-click
  // window. The threshold matches the platform default for `dblclick`.
  //
  // Single click still toggles bulk-selection when selection mode is
  // active (unchanged behaviour); otherwise it's a no-op until the
  // second click within the window arrives, at which point we open
  // the task dialog through the parent's `onSelect` handler.
  // (`lastClickAtRef` is declared at the top of the component.)
  const DBL_CLICK_WINDOW_MS = 350;

  const handleBodyClick = (e: React.MouseEvent): void => {
    const now = Date.now();
    const isDblClick = now - lastClickAtRef.current < DBL_CLICK_WINDOW_MS;
    lastClickAtRef.current = isDblClick ? 0 : now;

    if (isDblClick) {
      // Second click within the window → open the dialog. This always
      // wins over selection-toggle so a quick double-click opens the
      // task even while bulk-selection mode is active.
      onSelect?.(task.id);
      return;
    }
    // First click → in selection mode, toggle bulk-selection. Outside
    // selection mode the first click is just the start of a potential
    // double-click (no immediate side-effect).
    if (selectionActive) {
      onToggleSelection?.(task.id, e);
    }
  };

  // Keyboard activation (Enter / Space) is the canonical way for
  // assistive-tech users to open the card; treat it like double-click.
  const handleBodyKeyDown = (e: React.KeyboardEvent): void => {
    if (e.key !== "Enter" && e.key !== " ") return;
    if (selectionActive) return;
    e.preventDefault();
    onSelect?.(task.id);
  };

  const handleCheckboxClick = (e: React.MouseEvent<HTMLInputElement>): void => {
    // Stop the click from bubbling to the card body button.
    e.stopPropagation();
    onToggleSelection?.(task.id, e);
  };

  // onChange is required to make React happy with a controlled checkbox,
  // but the actual state change is driven by onClick above.
  const handleCheckboxChange = (): void => {
    // Intentionally empty — state driven by handleCheckboxClick.
  };

  return (
    <article
      ref={ref}
      style={style}
      className={cn(
        styles.card,
        selected && styles.cardSelected,
        selectionActive && styles.cardInSelectionMode,
        className,
      )}
      data-testid={`task-card-${task.id}`}
    >
      {/* Drag handle — ONLY this initiates drag; card body stays clickable */}
      <button
        type="button"
        ref={handleRef}
        className={styles.dragHandle}
        aria-label="Drag task"
        data-testid={`task-card-drag-handle-${task.id}`}
        onClick={(e) => e.stopPropagation()}
      >
        <span aria-hidden="true" style={{ letterSpacing: "-2px" }}>⋮⋮</span>
      </button>

      {/* Checkbox is always in DOM; visibility controlled by CSS so hover
          can reveal it even without JS, and tests can locate it always. */}
      <span
        className={cn(
          styles.checkboxWrapper,
          (selectionActive || selected) && styles.checkboxVisible,
        )}
        data-testid={`task-card-checkbox-${task.id}`}
      >
        <input
          type="checkbox"
          className={styles.checkbox}
          checked={selected}
          onChange={handleCheckboxChange}
          onClick={handleCheckboxClick}
          aria-label={`Select task ${task.title}`}
        />
      </span>

      {/* Card body — single click toggles bulk selection (only in
          selection mode); two clicks within DBL_CLICK_WINDOW_MS open
          the task dialog. We DON'T use the native `onDoubleClick`
          because dnd-kit's pointer wrapper around the article can
          swallow the second activation; the manual click-window is
          deterministic. */}
      <button
        type="button"
        className={styles.cardBody}
        onClick={handleBodyClick}
        onKeyDown={handleBodyKeyDown}
        aria-label={ariaLabel}
        aria-pressed={selectionActive ? selected : undefined}
      >
        <CardBody
          task={task}
          attachmentsCount={attachmentsCount}
          promptsCount={promptsCount}
          effectiveCount={effectiveCount}
          isDoneColumn={isDoneColumn}
        />
        <TaskRunIndicator taskId={task.id} />
      </button>
    </article>
  );
}

function TaskRunIndicator({ taskId }: { taskId: string }): ReactElement | null {
  const status = useTaskStatus(taskId);
  return <RunningTaskIndicator status={status} />;
}

interface CardBodyProps {
  task: Task;
  attachmentsCount: number;
  /** See `TaskCardProps.promptsCount` for legacy suppression semantics. */
  promptsCount?: number | undefined;
  /** See `TaskCardProps.effectiveCount`. Wins over `promptsCount` when set. */
  effectiveCount?: number | undefined;
  isDoneColumn: boolean;
}

function CardBody({
  task,
  attachmentsCount,
  promptsCount,
  effectiveCount,
  isDoneColumn,
}: CardBodyProps): ReactElement {
  // Slug chip: format `<spacePrefix>-<n>` (e.g. `cot-1`) — use
  // task.slug directly. Slug generation lives in the Rust backend
  // (crates/infrastructure/src/db/repositories/tasks.rs::insert), the
  // frontend never composes or rewrites the value.
  const slugLabel = task.slug;

  return (
    <>
      {/* Top row: done checkmark (top-right only, no slug here) */}
      {isDoneColumn ? (
        <div className={styles.topRow}>
          <span className={styles.topRowSpacer} />
          <PixelBusinessProductCheck
            width={16}
            height={16}
            aria-hidden="true"
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

      {/*
       * Bottom meta row: attachments + slug chip (right).
       *
       * Roles are not surfaced on the card — see `docs/decision-log.md`
       * D-020 ("role ownership invariant"). A task on a role-owned board
       * IS implicitly that role's task; rendering a role chip would just
       * repeat the board context one level lower.
       */}
      <div className={styles.bottomRow}>
        <span className={styles.meta}>
          {/* Attachment count chip */}
          {attachmentsCount > 0 ? (
            <span
              className={styles.attachments}
              aria-label={`${attachmentsCount} attachments`}
              data-testid="task-card-attachments"
            >
              <PixelInterfaceEssentialClip1 width={12} height={12} aria-hidden={true} />
              {attachmentsCount}
            </span>
          ) : null}

          {/*
           * Effective-context chip — refactor-v3 §"Effective context
           * performance". Reads the combined effective_*_count from the
           * Task row (server-denormalised, D-B). Falls back to the legacy
           * `promptsCount` prop when callers haven't migrated yet.
           */}
          {(() => {
            const total =
              effectiveCount !== undefined ? effectiveCount : promptsCount;
            if (total === undefined || total <= 0) return null;
            const isEffective = effectiveCount !== undefined;
            const label = isEffective
              ? `${String(total)} effective context items`
              : `${String(total)} prompts attached`;
            return (
              <span
                className={styles.attachments}
                aria-label={label}
                data-testid={
                  isEffective
                    ? "task-card-effective-count"
                    : "task-card-prompts-count"
                }
              >
                <PixelInterfaceEssentialMessage
                  width={12}
                  height={12}
                  aria-hidden={true}
                />
                {total}
              </span>
            );
          })()}
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
