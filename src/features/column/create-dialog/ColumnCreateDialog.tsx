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

import { useCallback, type ReactElement } from "react";
import { useForm, Controller } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";

import { useCreateColumnMutation } from "@entities/column";
import type { Column } from "@entities/column";
import { Dialog, Button, Input } from "@shared/ui";

import styles from "./ColumnCreateDialog.module.css";

// react-hook-form schema — the only required field is a non-empty name.
const columnFormSchema = z.object({
  name: z.string().trim().min(1, "Name cannot be empty."),
});

type ColumnFormValues = z.infer<typeof columnFormSchema>;

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

  const {
    control,
    handleSubmit,
    setError,
    formState: { errors, isValid, isSubmitting },
  } = useForm<ColumnFormValues>({
    resolver: zodResolver(columnFormSchema),
    defaultValues: { name: "" },
    mode: "onChange",
  });

  const onValid = handleSubmit(async (values) => {
    try {
      const column = await createMutation.mutateAsync({
        boardId,
        name: values.name,
        position: nextPosition,
      });
      onCreated?.(column);
      onClose();
    } catch (err) {
      const message = err instanceof Error ? err.message : "Unknown error";
      setError("root.serverError", { message: `Failed to create: ${message}` });
    }
  });

  const handleSubmitPress = useCallback((): void => {
    void onValid();
  }, [onValid]);

  const handleCancel = useCallback((): void => {
    onClose();
  }, [onClose]);

  const serverError = errors.root?.serverError?.message;

  return (
    <>
      <div className={styles.section}>
        <Controller
          control={control}
          name="name"
          render={({ field }) => (
            <Input
              label="Name"
              value={field.value}
              onChange={field.onChange}
              placeholder="e.g. Backlog"
              autoFocus
              className={styles.fullWidthInput}
              data-testid="column-create-dialog-name-input"
            />
          )}
        />
      </div>

      <div className={styles.footer}>
        {serverError ? (
          <p
            className={styles.saveError}
            role="alert"
            data-testid="column-create-dialog-error"
          >
            {serverError}
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
          isPending={isSubmitting}
          isDisabled={!isValid}
          onPress={handleSubmitPress}
          data-testid="column-create-dialog-save"
        >
          Create
        </Button>
      </div>
    </>
  );
}
