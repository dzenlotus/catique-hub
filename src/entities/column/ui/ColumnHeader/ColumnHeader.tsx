import { useState } from "react";
import type { ReactElement } from "react";
import {
  PixelInterfaceEssentialRefresh,
  PixelBusinessProductCheck,
  PixelDesignLayer,
  PixelInterfaceEssentialPlus,
} from "@shared/ui/Icon";

import {
  Button,
  Dialog,
  Input,
  KebabIcon,
  Menu,
  MenuItem,
  MenuTrigger,
} from "@shared/ui";
import { cn } from "@shared/lib";

import styles from "./ColumnHeader.module.css";

export interface ColumnHeaderProps {
  /** Column id — surfaced to action handlers. */
  id: string;
  /** Display name. */
  name: string;
  /** Number of tasks currently in this column (for the count badge). */
  taskCount: number;
  /** Callback for the "Rename" menu action — receives `(id, newName)`. */
  onRename?: (id: string, newName: string) => void;
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

/** Derive a column icon from its display name. Case-insensitive heuristic.
 *
 * Icon mapping per DS v1 mockup (image.png):
 *   Backlog     → PixelDesignLayer (closest available)
 *   In Progress → PixelInterfaceEssentialRefresh (circular arrow)
 *   Done        → PixelBusinessProductCheck (checkmark)
 *   Default     → PixelDesignLayer
 */
function getColumnIcon(name: string): ReactElement {
  const lower = name.toLowerCase();
  if (lower.includes("backlog") || lower.includes("бэклог")) {
    return <PixelDesignLayer width={14} height={14} aria-hidden="true" className={styles.columnIcon} />;
  }
  if (
    lower.includes("in progress") ||
    lower.includes("в работе") ||
    lower.includes("doing")
  ) {
    return (
      <PixelInterfaceEssentialRefresh width={14} height={14} aria-hidden="true" className={styles.columnIcon} />
    );
  }
  if (lower.includes("done") || lower.includes("готово")) {
    return (
      <PixelBusinessProductCheck
        width={14}
        height={14}
        aria-hidden="true"
        className={cn(styles.columnIcon, styles.columnIconDone)}
        data-testid="column-header-icon-done"
      />
    );
  }
  return <PixelDesignLayer width={14} height={14} aria-hidden="true" className={styles.columnIcon} />;
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
  onRename,
  onDelete,
  dragHandle,
  onAddTask,
  className,
}: ColumnHeaderProps): ReactElement {
  const [isRenaming, setIsRenaming] = useState(false);
  const [renameValue, setRenameValue] = useState(name);
  const [isConfirmingDelete, setIsConfirmingDelete] = useState(false);

  // TODO(audit-F14): the column overflow menu loses "Attach prompt"
  // until the column edit page lands a `<MultiSelect>` for column-
  // attached prompts (audit-#8 + audit-F14). The widget is intentionally
  // stripped down here to remove the broken dialog wiring.
  const handleMenuAction = (key: React.Key): void => {
    if (key === "rename") {
      setRenameValue(name);
      setIsRenaming(true);
    } else if (key === "delete") {
      setIsConfirmingDelete(true);
    }
  };

  const submitRename = (): void => {
    const trimmed = renameValue.trim();
    if (!trimmed || trimmed === name) {
      setIsRenaming(false);
      return;
    }
    onRename?.(id, trimmed);
    setIsRenaming(false);
  };

  const isDoneColumn =
    name.toLowerCase().includes("done") ||
    name.toLowerCase().includes("готово");

  return (
    <header
      className={cn(styles.header, className)}
      data-testid={`column-header-${id}`}
    >
      {dragHandle ?? null}

      <span className={styles.iconSlot} data-testid="column-header-icon">
        {getColumnIcon(name)}
      </span>

      {isDoneColumn ? (
        <PixelBusinessProductCheck
          width={14}
          height={14}
          aria-hidden="true"
          className={styles.doneCheck}
          data-testid="column-header-done-check"
        />
      ) : null}

      <h3 className={styles.name} title={name}>
        {name}
      </h3>

      <span
        className={styles.count}
        aria-label={`${taskCount} ${taskCount === 1 ? "task" : "tasks"}`}
        data-testid="column-header-count"
      >
        {taskCount}
      </span>

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
          <MenuItem id="rename">Rename</MenuItem>
          <MenuItem id="delete" variant="danger">
            Delete
          </MenuItem>
        </Menu>
      </MenuTrigger>

      {isRenaming ? (
        <Dialog
          title="Rename column"
          isOpen
          onOpenChange={(open) => {
            if (!open) setIsRenaming(false);
          }}
        >
          <form
            className={styles.renameForm}
            onSubmit={(e) => {
              e.preventDefault();
              submitRename();
            }}
          >
            <Input
              label="Column name"
              value={renameValue}
              onChange={setRenameValue}
              autoFocus
            />
            <div className={styles.formActions}>
              <Button
                variant="ghost"
                type="button"
                onPress={() => setIsRenaming(false)}
              >
                Cancel
              </Button>
              <Button variant="primary" type="submit">
                Save
              </Button>
            </div>
          </form>
        </Dialog>
      ) : null}

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
