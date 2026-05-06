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

import { useEffect, useState, type ReactElement } from "react";

import { useColumns } from "@entities/column";
import type { Column } from "@entities/column";
import { useRoles } from "@entities/role";
import type { Role } from "@entities/role";
import { useCreateTaskMutation } from "@entities/task";
import { useToast } from "@app/providers/ToastProvider";
import { Dialog, Button, Input, Listbox, ListboxItem, MarkdownPreview, Scrollable } from "@shared/ui";
import { cn } from "@shared/lib";

import styles from "./TaskCreateDialog.module.css";

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

  // ── Form state ──────────────────────────────────────────────────────────
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [descriptionMode, setDescriptionMode] = useState<"edit" | "preview">("edit");
  const [selectedBoardId] = useState<string | null>(defaultBoardId);
  const [selectedColumnId, setSelectedColumnId] = useState<string | null>(defaultColumnId);
  const [selectedRoleId, setSelectedRoleId] = useState<string | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);

  // ── Data queries ────────────────────────────────────────────────────────
  const columnsQuery = useColumns(selectedBoardId ?? "");
  const rolesQuery = useRoles();

  const columns: Column[] = columnsQuery.data ?? [];
  const roles: Role[] = rolesQuery.data ?? [];

  // Auto-pick the first column of the selected board when none is set.
  // The dialog no longer exposes a Status picker — tasks land in the
  // board's first column ("Owner" / "todo") and the user moves them
  // via kanban drag.
  useEffect(() => {
    if (selectedColumnId === null && columns.length > 0) {
      setSelectedColumnId(columns[0].id);
    }
  }, [columns, selectedColumnId]);

  // ── Derived ──────────────────────────────────────────────────────────────
  const canSubmit =
    title.trim().length > 0 &&
    selectedBoardId !== null &&
    selectedColumnId !== null;

  const handleSave = (): void => {
    setSaveError(null);
    const trimmedTitle = title.trim();
    if (!trimmedTitle) {
      setSaveError("Title cannot be empty.");
      return;
    }
    if (!selectedBoardId) {
      setSaveError("Select a board.");
      return;
    }
    if (!selectedColumnId) {
      setSaveError("Select a status.");
      return;
    }

    const colTasks = columns.find((c) => c.id === selectedColumnId);
    // Position: append at end. The column task list isn't loaded here so
    // we use a safe large position that the server will accept and
    // subsequent reorders will normalise.
    const position = colTasks ? Number(colTasks.position) * 1000 + 1 : 1;

    const mutationArgs: Parameters<typeof createTask.mutate>[0] = {
      boardId: selectedBoardId,
      columnId: selectedColumnId,
      title: trimmedTitle,
      description: description.trim() !== "" ? description.trim() : null,
      position,
    };
    if (selectedRoleId !== null) mutationArgs.roleId = selectedRoleId;

    createTask.mutate(
      mutationArgs,
      {
        onSuccess: () => {
          pushToast("success", "Task created");
          onClose();
        },
        onError: (err) => {
          pushToast("error", "Failed to create task");
          setSaveError(`Failed to create: ${err.message}`);
        },
      },
    );
  };

  const handleCancel = (): void => {
    onClose();
  };

  // ── Render ───────────────────────────────────────────────────────────────

  return (
    <Scrollable axis="y" className={styles.body}>
      {/* Title */}
      <div className={styles.section}>
        <Input
          label="Title"
          value={title}
          onChange={setTitle}
          placeholder="Task title"
          autoFocus
          className={styles.fullWidthInput}
          data-testid="task-create-dialog-title-input"
        />
      </div>

      {/* Description */}
      <div className={styles.section}>
        <div className={styles.descriptionHeader}>
          <span className={styles.sectionLabel}>Description</span>
          <div className={styles.descriptionTabs}>
            <button
              type="button"
              className={cn(
                styles.descriptionTab,
                descriptionMode === "edit" && styles.descriptionTabActive,
              )}
              onClick={() => setDescriptionMode("edit")}
            >
              Edit
            </button>
            <button
              type="button"
              className={cn(
                styles.descriptionTab,
                descriptionMode === "preview" && styles.descriptionTabActive,
              )}
              onClick={() => setDescriptionMode("preview")}
            >
              Preview
            </button>
          </div>
        </div>
        {descriptionMode === "edit" ? (
          <textarea
            className={styles.textarea}
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="Optional. Markdown is supported."
            rows={4}
            aria-label="Description"
            data-testid="task-create-dialog-description-textarea"
          />
        ) : (
          <div className={styles.markdownPreviewWrapper}>
            {description.trim() ? (
              <MarkdownPreview source={description} />
            ) : (
              <p className={styles.previewEmpty}>Nothing to preview.</p>
            )}
          </div>
        )}
      </div>

      {/* audit (2026-05-06): Board + Status pickers removed from the
          create dialog per maintainer feedback — tasks belong to the
          board they're created from (defaultBoardId, contextual).
          Status is implicit (the board's first column / "Owner" /
          "todo"). The dialog auto-resolves both before submit. */}

      {/* Role */}
      <div className={styles.section}>
        <p className={styles.sectionLabel}>Role</p>
        {rolesQuery.status === "pending" ? (
          <div className={cn(styles.skeletonRow, styles.skeletonRowWide)} />
        ) : rolesQuery.status === "error" ? (
          <p className={styles.fieldError}>
            Failed to load roles: {rolesQuery.error.message}
          </p>
        ) : (
          <Listbox
            aria-label="Role"
            selectionMode="single"
            selectedKeys={selectedRoleId !== null ? new Set([selectedRoleId]) : new Set(["__none__"])}
            onSelectionChange={(keys) => {
              const selected = [...keys][0];
              if (selected === "__none__" || selected === undefined) {
                setSelectedRoleId(null);
              } else if (typeof selected === "string") {
                setSelectedRoleId(selected);
              }
            }}
            data-testid="task-create-dialog-role-select"
          >
            <ListboxItem key="__none__" id="__none__">
              (no role)
            </ListboxItem>
            {roles.map((role) => (
              <ListboxItem key={role.id} id={role.id}>
                {role.name}
              </ListboxItem>
            ))}
          </Listbox>
        )}
      </div>

      {/* Footer */}
      <div className={styles.footer}>
        {saveError ? (
          <p
            className={styles.saveError}
            role="alert"
            data-testid="task-create-dialog-error"
          >
            {saveError}
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
          isPending={createTask.status === "pending"}
          isDisabled={!canSubmit}
          onPress={handleSave}
          data-testid="task-create-dialog-save"
        >
          Create
        </Button>
      </div>
    </Scrollable>
  );
}
