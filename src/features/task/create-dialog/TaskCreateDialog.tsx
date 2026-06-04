/**
 * TaskCreateDialog — modal for creating a new task.
 *
 * Props:
 *   - `isOpen`  — controls dialog visibility.
 *   - `onClose` — called on Cancel, successful Save, or Esc.
 *
 * Form fields:
 *   - Title (required)
 *   - Description (optional, textarea + edit/preview toggle)
 *   - Board (required, filtered by active space)
 *   - Status / Column (required, cascades on board change)
 *   - Role (optional)
 */

import { useCallback, useEffect, useState, type ReactElement } from "react";
import { useForm, Controller } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";

import { useColumns } from "@entities/column";
import type { Column } from "@entities/column";
import { useCreateTaskMutation } from "@entities/task";
import { useToast } from "@shared/lib";
import { Dialog, Button, Input, MarkdownField, Scrollable } from "@shared/ui";

import styles from "./TaskCreateDialog.module.css";

// react-hook-form schema — title required; description optional. Board and
// column are resolved from props / the first-column effect (not validated
// text fields), and gate the submit button alongside `isValid`.
const taskFormSchema = z.object({
  title: z.string().trim().min(1, "Title cannot be empty."),
  description: z.string().optional(),
});

type TaskFormValues = z.infer<typeof taskFormSchema>;

export interface TaskCreateDialogProps {
  isOpen: boolean;
  onClose: () => void;
  /** Pre-select this board when the dialog opens. */
  defaultBoardId?: string | null;
  /** Pre-select this column when the dialog opens. Requires `defaultBoardId`. */
  defaultColumnId?: string | null;
}

/**
 * `TaskCreateDialog` — outer shell: controls open state and mounts the
 * content lazily (avoids hooks running while the dialog is closed).
 *
 * `defaultBoardId` / `defaultColumnId` let callers (e.g. the kanban
 * column "+ Add task" button) prefill the form with the user's
 * implicit context, so they only have to fill in the title.
 */
export function TaskCreateDialog({
  isOpen,
  onClose,
  defaultBoardId,
  defaultColumnId,
}: TaskCreateDialogProps): ReactElement {
  return (
    <Dialog
      title="Create task"
      isOpen={isOpen}
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
      isDismissable
      data-testid="task-create-dialog"
    >
      {() => (
        <TaskCreateDialogContent
          onClose={onClose}
          defaultBoardId={defaultBoardId ?? null}
          defaultColumnId={defaultColumnId ?? null}
        />
      )}
    </Dialog>
  );
}

// ─────────────────────────────────────────────────────────────────────────────

interface TaskCreateDialogContentProps {
  onClose: () => void;
  defaultBoardId: string | null;
  defaultColumnId: string | null;
}

function TaskCreateDialogContent({
  onClose,
  defaultBoardId,
  defaultColumnId,
}: TaskCreateDialogContentProps): ReactElement {
  const { pushToast } = useToast();
  const createTask = useCreateTaskMutation();

  // ── Board / column (props + first-column effect, not form fields) ─────────
  const [selectedBoardId] = useState<string | null>(defaultBoardId);
  const [selectedColumnId, setSelectedColumnId] = useState<string | null>(defaultColumnId);

  // ── Data queries ────────────────────────────────────────────────────────
  const columnsQuery = useColumns(selectedBoardId ?? "");

  const columns: Column[] = columnsQuery.data ?? [];

  // Auto-pick the first column of the selected board when none is set.
  // The dialog no longer exposes a Status picker — tasks land in the
  // board's first column ("Owner" / "todo") and the user moves them
  // via kanban drag.
  useEffect(() => {
    if (selectedColumnId === null && columns.length > 0) {
      setSelectedColumnId(columns[0].id);
    }
  }, [columns, selectedColumnId]);

  const {
    control,
    handleSubmit,
    setError,
    formState: { errors, isValid, isSubmitting },
  } = useForm<TaskFormValues>({
    resolver: zodResolver(taskFormSchema),
    defaultValues: { title: "", description: "" },
    mode: "onChange",
  });

  const onValid = handleSubmit(async (values) => {
    if (!selectedBoardId) {
      setError("root.serverError", { message: "Select a board." });
      return;
    }
    if (!selectedColumnId) {
      setError("root.serverError", { message: "Select a status." });
      return;
    }

    const colTasks = columns.find((c) => c.id === selectedColumnId);
    // Position: append at end. The column task list isn't loaded here so
    // we use a safe large position that the server will accept and
    // subsequent reorders will normalise.
    const position = colTasks ? Number(colTasks.position) * 1000 + 1 : 1;

    const description = (values.description ?? "").trim();
    const mutationArgs: Parameters<typeof createTask.mutateAsync>[0] = {
      boardId: selectedBoardId,
      columnId: selectedColumnId,
      title: values.title,
      description: description !== "" ? description : null,
      position,
    };
    // audit-2026-05-06: roleId resolved server-side from the
    // board's owner_role_id (1:1 board↔role rule). Frontend no
    // longer sends a role on create_task.

    try {
      await createTask.mutateAsync(mutationArgs);
      pushToast("success", "Task created");
      onClose();
    } catch (err) {
      const message = err instanceof Error ? err.message : "Unknown error";
      pushToast("error", "Failed to create task");
      setError("root.serverError", { message: `Failed to create: ${message}` });
    }
  });

  const handleSubmitPress = useCallback((): void => {
    void onValid();
  }, [onValid]);

  const handleCancel = useCallback((): void => {
    onClose();
  }, [onClose]);

  // ── Derived ──────────────────────────────────────────────────────────────
  // Title is RHF-validated; board/column come from props/effect and gate
  // the submit button alongside `isValid`.
  const canSubmit =
    isValid && selectedBoardId !== null && selectedColumnId !== null;

  const serverError = errors.root?.serverError?.message;

  // ── Render ───────────────────────────────────────────────────────────────

  return (
    <Scrollable axis="y" className={styles.body}>
      {/* Title */}
      <div className={styles.section}>
        <Controller
          control={control}
          name="title"
          render={({ field }) => (
            <Input
              label="Title"
              value={field.value}
              onChange={field.onChange}
              placeholder="Task title"
              autoFocus
              className={styles.fullWidthInput}
              data-testid="task-create-dialog-title-input"
            />
          )}
        />
      </div>

      {/* Description — canonical MarkdownField (in-place edit ⇄ preview). */}
      <div className={styles.section}>
        <p className={styles.sectionLabel}>Description</p>
        <Controller
          control={control}
          name="description"
          render={({ field }) => (
            <MarkdownField
              value={field.value ?? ""}
              onChange={field.onChange}
              placeholder="Optional. Markdown is supported."
              ariaLabel="Description"
              data-testid="task-create-dialog-description-textarea"
            />
          )}
        />
      </div>

      {/* audit (2026-05-06): Board, Status, AND Role pickers removed.
          Per the role model: every board belongs to exactly one role
          (1:1), so a task's role is always the board's owner_role_id.
          The Rust create_task path resolves it server-side; no
          user-facing picker needed. */}

      {/* Footer */}
      <div className={styles.footer}>
        {serverError ? (
          <p
            className={styles.saveError}
            role="alert"
            data-testid="task-create-dialog-error"
          >
            {serverError}
          </p>
        ) : null}
        <Button
          variant="ghost"
          size="md"
          onPress={handleCancel}
          data-testid="task-create-dialog-cancel"
        >
          Cancel
        </Button>
        <Button
          variant="primary"
          size="md"
          isPending={isSubmitting}
          isDisabled={!canSubmit}
          onPress={handleSubmitPress}
          data-testid="task-create-dialog-save"
        >
          Create
        </Button>
      </div>
    </Scrollable>
  );
}
