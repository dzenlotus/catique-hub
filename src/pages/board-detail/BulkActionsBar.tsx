/**
 * BulkActionsBar — floating action bar shown when tasks are selected.
 *
 * Pinned to bottom-centre of the viewport (fixed). Dark navy background,
 * white text. Offers:
 *   - Selected count
 *   - "Move to…" dropdown (one column per item → calls onMoveTo)
 *   - "Delete" button (red, with inline confirmation step)
 *   - "Clear" button (deselects all)
 */

import { useState } from "react";
import type { ReactElement } from "react";

import type { Column } from "@entities/column";

import styles from "./BulkActionsBar.module.css";

export interface BulkActionsBarProps {
  /** Number of currently selected tasks. Bar is hidden when 0. */
  count: number;
  /** Available board columns shown in the "Move to…" dropdown. */
  columns: Column[];
  /** Called with the target column id after the user picks a column. */
  onMoveTo: (columnId: string) => void;
  /** Called after the user confirms deletion. */
  onDelete: () => void;
  /** Called when the user clicks "Clear". */
  onClear: () => void;
}

/**
 * `BulkActionsBar` — fixed-position action bar.
 *
 * Rendered by `KanbanBoard` as a React portal sibling — it sits outside
 * the scroller so the fixed positioning works correctly.
 */
export function BulkActionsBar({
  count,
  columns,
  onMoveTo,
  onDelete,
  onClear,
}: BulkActionsBarProps): ReactElement | null {
  const [moveOpen, setMoveOpen] = useState(false);
  const [deletePhase, setDeletePhase] = useState<"idle" | "confirm">("idle");

  if (count === 0) return null;

  const handleMoveSelect = (columnId: string): void => {
    setMoveOpen(false);
    onMoveTo(columnId);
  };

  const handleDeleteClick = (): void => {
    if (deletePhase === "idle") {
      setDeletePhase("confirm");
    } else {
      setDeletePhase("idle");
      onDelete();
    }
  };

  const handleCancelDelete = (): void => {
    setDeletePhase("idle");
  };

  const handleClear = (): void => {
    setDeletePhase("idle");
    setMoveOpen(false);
    onClear();
  };

  return (
    <div
      className={styles.bar}
      role="toolbar"
      aria-label="Bulk task actions"
      data-testid="bulk-actions-bar"
    >
      <span className={styles.count} data-testid="bulk-actions-count">
        {count} selected
      </span>

      <div className={styles.actions}>
        {/* Move to dropdown */}
        <div className={styles.moveWrapper}>
          <button
            type="button"
            className={styles.moveButton}
            aria-haspopup="listbox"
            aria-expanded={moveOpen}
            onClick={() => {
              setMoveOpen((v) => !v);
              setDeletePhase("idle");
            }}
            data-testid="bulk-actions-move-trigger"
          >
            Move to…
          </button>

          {moveOpen ? (
            <ul
              role="listbox"
              aria-label="Choose target column"
              className={styles.moveMenu}
              data-testid="bulk-actions-move-menu"
            >
              {columns.map((col) => (
                <li key={col.id} role="option" aria-selected={false}>
                  <button
                    type="button"
                    className={styles.moveOption}
                    onClick={() => handleMoveSelect(col.id)}
                    data-testid={`bulk-actions-move-option-${col.id}`}
                  >
                    {col.name}
                  </button>
                </li>
              ))}
              {columns.length === 0 ? (
                <li className={styles.moveEmpty}>No columns</li>
              ) : null}
            </ul>
          ) : null}
        </div>

        {/* Delete button — two-phase confirmation */}
        {deletePhase === "confirm" ? (
          <span className={styles.confirmGroup}>
            <span className={styles.confirmLabel} data-testid="bulk-actions-confirm-label">
              Delete {count} {count === 1 ? "task" : "tasks"}?
            </span>
            <button
              type="button"
              className={styles.deleteConfirmButton}
              onClick={handleDeleteClick}
              data-testid="bulk-actions-delete-confirm"
            >
              Confirm
            </button>
            <button
              type="button"
              className={styles.cancelButton}
              onClick={handleCancelDelete}
              data-testid="bulk-actions-delete-cancel"
            >
              Cancel
            </button>
          </span>
        ) : (
          <button
            type="button"
            className={styles.deleteButton}
            onClick={handleDeleteClick}
            data-testid="bulk-actions-delete"
          >
            Delete
          </button>
        )}

        {/* Clear button */}
        <button
          type="button"
          className={styles.clearButton}
          onClick={handleClear}
          data-testid="bulk-actions-clear"
        >
          Clear
        </button>
      </div>
    </div>
  );
}
