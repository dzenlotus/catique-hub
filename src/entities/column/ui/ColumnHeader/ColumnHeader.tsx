import { useState } from "react";
import type { ReactElement } from "react";

import { Button, Dialog, Input, Menu, MenuItem, MenuTrigger } from "@shared/ui";
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
  /** Optional class merged onto the root. */
  className?: string;
}

/**
 * `ColumnHeader` — header strip for one kanban column.
 *
 * Layout: drag-handle? • name • count-badge • spacer • more-menu.
 *
 * Why a `<header>` element? The column itself uses `<section>` (in the
 * widget layer); landmarks compose so the column name is readable as
 * a heading by AT.
 *
 * Token-pair: `--color-text-default` on `--color-surface-raised`.
 *   Light: warm-900 on white = 16.5:1 → AAA.
 *   Dark:  warm-100 on warm-800 = 12.6:1 → AAA.
 */
export function ColumnHeader({
  id,
  name,
  taskCount,
  onRename,
  onDelete,
  dragHandle,
  className,
}: ColumnHeaderProps): ReactElement {
  const [isRenaming, setIsRenaming] = useState(false);
  const [renameValue, setRenameValue] = useState(name);
  const [isConfirmingDelete, setIsConfirmingDelete] = useState(false);

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

  return (
    <header
      className={cn(styles.header, className)}
      data-testid={`column-header-${id}`}
    >
      {dragHandle ?? null}

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

      <MenuTrigger>
        <Button
          variant="ghost"
          size="sm"
          aria-label={`Column actions for ${name}`}
          className={styles.moreButton}
        >
          <span aria-hidden="true">⋯</span>
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
