/**
 * ColumnCreateDialog — modal for adding a new kanban column to a board.
 *
 * Replaces the inline "Add column" form that previously lived in
 * `KanbanBoard.tsx`. Per ctq-76 item 4, every creation flow goes through
 * a dialog so the surface stays consistent across the app.
 *
 * Props mirror the small create-dialog family (`SpaceCreateDialog`,
 * `BoardCreateDialog`):
 *   - `isOpen`     — controls visibility.
 *   - `onClose`    — called on Cancel, successful Save, or Esc.
 *   - `boardId`    — the board the new column will belong to.
 *   - `nextPosition` — position to assign to the new column. The widget
 *     layer derives this from the existing column list (last + 1) so the
 *     entity slice keeps positions monotone without reading global state.
 *   - `onCreated`  — optional callback fired after a successful create.
 */

import { useState, type ReactElement } from "react";

import { useCreateColumnMutation } from "@entities/column";
import type { Column } from "@entities/column";
import { Dialog, Button, Input } from "@shared/ui";

import styles from "./ColumnCreateDialog.module.css";

export interface ColumnCreateDialogProps {
  isOpen: boolean;
  onClose: () => void;
  boardId: string;
  nextPosition: number;
  onCreated?: (column: Column) => void;
}

/**
 * `ColumnCreateDialog` — small modal that creates a single column.
 *
 * Validation: the only required field is `name` after trim. Position is
 * supplied by the caller.
 */
export function ColumnCreateDialog({
  isOpen,
  onClose,
  boardId,
  nextPosition,
  onCreated,
}: ColumnCreateDialogProps): ReactElement {
  return (
    <Dialog
      title="New column"
      isOpen={isOpen}
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
      isDismissable
      className={styles.dialogBody}
      data-testid="column-create-dialog"
    >
      {() => (
        <ColumnCreateDialogContent
          onClose={onClose}
          boardId={boardId}
          nextPosition={nextPosition}
          {...(onCreated !== undefined ? { onCreated } : {})}
        />
      )}
    </Dialog>
  );
}

// ─────────────────────────────────────────────────────────────────────────────

interface ColumnCreateDialogContentProps {
  onClose: () => void;
  boardId: string;
  nextPosition: number;
  onCreated?: (column: Column) => void;
}

function ColumnCreateDialogContent({
  onClose,
  boardId,
  nextPosition,
  onCreated,
}: ColumnCreateDialogContentProps): ReactElement {
  const createMutation = useCreateColumnMutation();
  const [name, setName] = useState("");
  const [saveError, setSaveError] = useState<string | null>(null);

  const canSubmit = name.trim().length > 0;

  const handleSave = (): void => {
    setSaveError(null);
    const trimmed = name.trim();
    if (!trimmed) {
      setSaveError("Name cannot be empty.");
      return;
    }

    createMutation.mutate(
      { boardId, name: trimmed, position: nextPosition },
      {
        onSuccess: (column) => {
          onCreated?.(column);
          setName("");
          onClose();
        },
        onError: (err) => {
          setSaveError(`Failed to create: ${err.message}`);
        },
      },
    );
  };

  const handleCancel = (): void => {
    setName("");
    setSaveError(null);
    onClose();
  };

  return (
    <>
      <div className={styles.section}>
        <Input
          label="Name"
          value={name}
          onChange={setName}
          placeholder="e.g. Backlog"
          autoFocus
          className={styles.fullWidthInput}
          data-testid="column-create-dialog-name-input"
        />
      </div>

      <div className={styles.footer}>
        {saveError ? (
          <p
            className={styles.saveError}
            role="alert"
            data-testid="column-create-dialog-error"
          >
            {saveError}
          </p>
        ) : null}
        <Button
          variant="ghost"
          size="md"
          onPress={handleCancel}
          data-testid="column-create-dialog-cancel"
        >
          Cancel
        </Button>
        <Button
          variant="primary"
          size="md"
          isPending={createMutation.status === "pending"}
          isDisabled={!canSubmit}
          onPress={handleSave}
          data-testid="column-create-dialog-save"
        >
          Create
        </Button>
      </div>
    </>
  );
}
