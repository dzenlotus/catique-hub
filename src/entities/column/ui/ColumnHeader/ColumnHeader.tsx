import { useState } from "react";
import type { ReactElement } from "react";
import { PixelInterfaceEssentialPlus } from "@shared/ui/Icon";

import {
  Button,
  Dialog,
  EntityTitle,
  KebabIcon,
  Menu,
  MenuItem,
  MenuTrigger,
} from "@shared/ui";
import type { IconColorValue } from "@shared/ui";
import { cn } from "@shared/lib";

import styles from "./ColumnHeader.module.css";

export interface ColumnHeaderProps {
  /** Column id — surfaced to action handlers. */
  id: string;
  /** Display name. */
  name: string;
  /** Number of tasks currently in this column (for the count badge). */
  taskCount: number;
  /**
   * User-chosen icon registry name. `null` falls back to the
   * name-heuristic glyph (Backlog/In progress/Done → distinct icons).
   */
  icon?: string | null;
  /** User-chosen CSS color string. `null` inherits the column foreground. */
  color?: string | null;
  /** Callback for inline rename — receives `(id, newName)`. */
  onRename?: (id: string, newName: string) => void;
  /**
   * Called when the user changes icon and/or color via the
   * IconColorPicker exposed by the header title. Receives the new
   * appearance pair; the caller decides whether to persist it through
   * `updateColumn`.
   */
  onAppearanceChange?: (id: string, next: IconColorValue) => void;
  /** Callback for the "Delete" menu action — receives `id`. Dialog confirms first. */
  onDelete?: (id: string) => void;
  /**
   * Render-prop slot for a drag handle. The widget layer
   * (`widgets/kanban-board`) injects a draggable `<button>` here when
   * the column is part of a sortable list. Entity slice doesn't know
   * about dnd-kit — this keeps the abstraction clean per FSD.
   */
  dragHandle?: ReactElement;
  /**
   * DS v1 mockup: small "+" button in the column header right edge.
   * Triggers adding a task to this column directly from the header.
   */
  onAddTask?: (id: string) => void;
  /** Optional class merged onto the root. */
  className?: string;
}

/** Derive a fallback icon-registry name from a column's display name.
 *  Used as `defaultIcon` for the EntityTitle picker when the user has
 *  not yet stored an explicit `column.icon`.
 *
 *  Mapping per DS v1 mockup:
 *    Backlog     → PixelDesignLayer
 *    In Progress → PixelInterfaceEssentialRefresh
 *    Done        → PixelBusinessProductCheck
 *    Default     → PixelDesignLayer
 */
function heuristicIconName(name: string): string {
  const lower = name.toLowerCase();
  if (lower.includes("backlog") || lower.includes("бэклог")) {
    return "PixelDesignLayer";
  }
  if (
    lower.includes("in progress") ||
    lower.includes("в работе") ||
    lower.includes("doing")
  ) {
    return "PixelInterfaceEssentialRefresh";
  }
  if (lower.includes("done") || lower.includes("готово")) {
    return "PixelBusinessProductCheck";
  }
  return "PixelDesignLayer";
}

/**
 * `ColumnHeader` — header strip for one kanban column.
 *
 * Layout: drag-handle? • icon • name • count-badge • spacer • more-menu.
 *
 * DS v1: `--color-surface-column` background, `--font-size-headline-sm`
 * semibold name, count pill with `--color-overlay-hover` background,
 * column-specific icon derived from name heuristic.
 */
export function ColumnHeader({
  id,
  name,
  taskCount,
  icon = null,
  color = null,
  onRename,
  onAppearanceChange,
  onDelete,
  dragHandle,
  onAddTask,
  className,
}: ColumnHeaderProps): ReactElement {
  const [isConfirmingDelete, setIsConfirmingDelete] = useState(false);

  // TODO(audit-F14): the column overflow menu loses "Attach prompt"
  // until the column edit page lands a `<MultiSelect>` for column-
  // attached prompts (audit-#8 + audit-F14). The widget is intentionally
  // stripped down here to remove the broken dialog wiring.
  const handleMenuAction = (key: React.Key): void => {
    if (key === "delete") {
      setIsConfirmingDelete(true);
    }
  };

  const handleRename = (next: string): void => {
    if (!next || next === name) return;
    onRename?.(id, next);
  };

  const handleAppearance = (next: IconColorValue): void => {
    onAppearanceChange?.(id, next);
  };

  return (
    <header
      className={cn(styles.header, className)}
      data-testid={`column-header-${id}`}
    >
      {dragHandle ?? null}

      <EntityTitle
        size="sm"
        editable={onRename !== undefined}
        name={name}
        onNameChange={handleRename}
        editTestId={`column-header-rename-${id}`}
        value={{ icon, color }}
        {...(onAppearanceChange !== undefined
          ? { onAppearanceChange: handleAppearance }
          : {})}
        defaultIcon={heuristicIconName(name)}
        pickerAriaLabel={`Column appearance for ${name}`}
        pickerTestId={`column-header-appearance-${id}`}
        actions={
          <span
            className={styles.count}
            aria-label={`${taskCount} ${taskCount === 1 ? "task" : "tasks"}`}
            data-testid="column-header-count"
          >
            {taskCount}
          </span>
        }
        className={styles.titleFill}
      />

      <span className={styles.spacer} />

      {/* Per-column "+" button — adds a task to this column directly */}
      {onAddTask ? (
        <button
          type="button"
          className={styles.addTaskButton}
          aria-label={`Add task to ${name}`}
          onClick={() => onAddTask(id)}
          data-testid={`column-header-add-task-${id}`}
        >
          <PixelInterfaceEssentialPlus width={12} height={12} aria-hidden="true" />
        </button>
      ) : null}

      <MenuTrigger>
        <Button
          variant="ghost"
          size="sm"
          aria-label={`Column actions for ${name}`}
        >
          <KebabIcon />
        </Button>
        <Menu onAction={handleMenuAction} placement="bottom end">
          <MenuItem id="delete" variant="danger">
            Delete
          </MenuItem>
        </Menu>
      </MenuTrigger>

      {isConfirmingDelete ? (
        <Dialog
          title="Delete column?"
          description={`"${name}" and its tasks will be removed. This cannot be undone.`}
          isOpen
          onOpenChange={(open) => {
            if (!open) setIsConfirmingDelete(false);
          }}
        >
          <div className={styles.formActions}>
            <Button
              variant="ghost"
              type="button"
              onPress={() => setIsConfirmingDelete(false)}
            >
              Cancel
            </Button>
            <Button
              variant="primary"
              type="button"
              onPress={() => {
                onDelete?.(id);
                setIsConfirmingDelete(false);
              }}
              data-testid="column-header-confirm-delete"
            >
              Delete
            </Button>
          </div>
        </Dialog>
      ) : null}
    </header>
  );
}
