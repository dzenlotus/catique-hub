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

import { useState, type ReactElement } from "react";

import { useBoards } from "@entities/board";
import type { Board } from "@entities/board";
import { useColumns } from "@entities/column";
import type { Column } from "@entities/column";
import { useRoles } from "@entities/role";
import type { Role } from "@entities/role";
import { useCreateTaskMutation } from "@entities/task";
import { useActiveSpace } from "@app/providers/ActiveSpaceProvider";
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
  const { activeSpaceId } = useActiveSpace();
  const { pushToast } = useToast();
  const createTask = useCreateTaskMutation();

  // ── Form state ──────────────────────────────────────────────────────────
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [descriptionMode, setDescriptionMode] = useState<"edit" | "preview">("edit");
  const [selectedBoardId, setSelectedBoardId] = useState<string | null>(defaultBoardId);
  const [selectedColumnId, setSelectedColumnId] = useState<string | null>(defaultColumnId);
  const [selectedRoleId, setSelectedRoleId] = useState<string | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);

  // ── Data queries ────────────────────────────────────────────────────────
  const boardsQuery = useBoards();
  const columnsQuery = useColumns(selectedBoardId ?? "");
  const rolesQuery = useRoles();

  // Filter boards to the active space.
  const boards: Board[] =
    boardsQuery.status === "success"
      ? boardsQuery.data.filter(
          (b) => activeSpaceId === null || b.spaceId === activeSpaceId,
        )
      : [];

  const columns: Column[] = columnsQuery.data ?? [];
  const roles: Role[] = rolesQuery.data ?? [];

  // ── Derived ──────────────────────────────────────────────────────────────
  const canSubmit =
    title.trim().length > 0 &&
    selectedBoardId !== null &&
    selectedColumnId !== null;

  // ── Handlers ─────────────────────────────────────────────────────────────

  const handleBoardChange = (id: string): void => {
    setSelectedBoardId(id);
    // Reset column when board changes.
    setSelectedColumnId(null);
  };

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

      {/* Board */}
      <div className={styles.section}>
        <p className={styles.sectionLabel}>Board</p>
        {boardsQuery.status === "pending" ? (
          <div className={cn(styles.skeletonRow, styles.skeletonRowWide)} />
        ) : boardsQuery.status === "error" ? (
          <p className={styles.fieldError}>
            Failed to load boards: {boardsQuery.error.message}
          </p>
        ) : boards.length === 0 ? (
          <p className={styles.fieldError}>No boards available.</p>
        ) : (
          <Listbox
            aria-label="Board"
            selectionMode="single"
            selectedKeys={selectedBoardId !== null ? new Set([selectedBoardId]) : new Set()}
            onSelectionChange={(keys) => {
              const selected = [...keys][0];
              if (typeof selected === "string") {
                handleBoardChange(selected);
              }
            }}
            data-testid="task-create-dialog-board-select"
          >
            {boards.map((board) => (
              <ListboxItem key={board.id} id={board.id}>
                {board.name}
              </ListboxItem>
            ))}
          </Listbox>
        )}
      </div>

      {/* Column / Status */}
      <div className={styles.section}>
        <p className={styles.sectionLabel}>Status</p>
        {selectedBoardId === null ? (
          <p className={styles.fieldHint}>Select a board first.</p>
        ) : columnsQuery.status === "pending" ? (
          <div className={cn(styles.skeletonRow, styles.skeletonRowWide)} />
        ) : columnsQuery.status === "error" ? (
          <p className={styles.fieldError}>
            Failed to load columns: {columnsQuery.error.message}
          </p>
        ) : columns.length === 0 ? (
          <p className={styles.fieldError}>This board has no columns.</p>
        ) : (
          <Listbox
            aria-label="Status"
            selectionMode="single"
            selectedKeys={selectedColumnId !== null ? new Set([selectedColumnId]) : new Set()}
            onSelectionChange={(keys) => {
              const selected = [...keys][0];
              if (typeof selected === "string") {
                setSelectedColumnId(selected);
              }
            }}
            data-testid="task-create-dialog-column-select"
          >
            {columns.map((column) => (
              <ListboxItem key={column.id} id={column.id}>
                {column.name}
              </ListboxItem>
            ))}
          </Listbox>
        )}
      </div>

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
