/**
 * TaskDialog — task detail / edit modal (Design System v1).
 *
 * v1 fields (in order):
 *   1. Title (text input)
 *   2. Slug (read-only mono badge)
 *   3. Description (textarea + edit/preview toggle)
 *   4. Board (native select — useBoards filtered by active space)
 *   5. Status / Column (native select — useColumns(selectedBoardId))
 *   6. Role (native select — useRoles, nullable)
 *   7. Attached prompts (empty placeholder)
 *   8. Attachments (wired — upload/delete)
 *   9. Agent reports (wired)
 *
 * Footer: trash-icon delete button (left) + Cancel + Save (right).
 */

import { useEffect, useMemo, useState, type ReactElement } from "react";
import { open } from "@tauri-apps/plugin-dialog";
import {
  useTask,
  useTaskPrompts,
  useUpdateTaskMutation,
  useDeleteTaskMutation,
  useSetTaskPromptsMutation,
} from "@entities/task";
import { usePrompts } from "@entities/prompt";
import {
  useAttachmentsByTask,
  useDeleteAttachmentMutation,
  useUploadAttachmentMutation,
  AttachmentRow,
} from "@entities/attachment";
import { useBoards } from "@entities/board";
import { useColumns } from "@entities/column";
import { useRoles } from "@entities/role";
import { useActiveSpace } from "@app/providers/ActiveSpaceProvider";
import {
  Dialog,
  EditorShell,
  Button,
  Input,
  MarkdownField,
  MultiSelect,
  Scrollable,
  Select,
  SelectItem,
} from "@shared/ui";
import { cn } from "@shared/lib";
import { AgentReportsList } from "@widgets/agent-reports-list";
import { useToast } from "@app/providers/ToastProvider";

import styles from "./TaskDialog.module.css";

export interface TaskDialogProps {
  /** null = closed, string = open for this task id */
  taskId: string | null;
  /** Called on cancel, successful save, or Esc. */
  onClose: () => void;
}

/**
 * `TaskDialog` — modal for viewing and editing a task's v1 fields.
 */
export function TaskDialog({ taskId, onClose }: TaskDialogProps): ReactElement {
  const isOpen = taskId !== null;

  return (
    <Dialog
      title="Edit task"
      isOpen={isOpen}
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
      isDismissable
      className={styles.body}
      data-testid="task-dialog"
    >
      {() =>
        taskId !== null ? (
          <TaskDialogContent taskId={taskId} onClose={onClose} />
        ) : null
      }
    </Dialog>
  );
}

// ─────────────────────────────────────────────────────────────────────────────

interface PromptsSectionProps {
  taskId: string;
}

function PromptsSection({ taskId }: PromptsSectionProps): ReactElement {
  const attachedQuery = useTaskPrompts(taskId);
  const allQuery = usePrompts();
  const setMutation = useSetTaskPromptsMutation();
  const { pushToast } = useToast();

  const attachedIds = useMemo(
    () => (attachedQuery.data ?? []).map((p) => p.id),
    [attachedQuery.data],
  );

  const options = useMemo(
    () =>
      (allQuery.data ?? []).map((p) =>
        p.shortDescription != null && p.shortDescription.length > 0
          ? { id: p.id, name: p.name, description: p.shortDescription }
          : { id: p.id, name: p.name },
      ),
    [allQuery.data],
  );

  if (attachedQuery.status === "pending") {
    return (
      <div className={styles.attachmentSkeletonStack} aria-busy="true">
        <div className={styles.attachmentSkeletonRow} />
      </div>
    );
  }

  if (attachedQuery.status === "error") {
    return (
      <div className={styles.attachmentErrorBanner} role="alert">
        <p className={styles.attachmentErrorMessage}>
          Failed to load prompts: {attachedQuery.error.message}
        </p>
        <Button
          variant="secondary"
          size="sm"
          onPress={() => void attachedQuery.refetch()}
        >
          Retry
        </Button>
      </div>
    );
  }

  const handleChange = (next: string[]): void => {
    setMutation.mutate(
      { taskId, previous: attachedIds, next },
      {
        onError: (err) => {
          pushToast("error", `Failed to update prompts: ${err.message}`);
        },
      },
    );
  };

  return (
    <MultiSelect<string>
      label="Task prompts"
      values={attachedIds}
      options={options}
      onChange={handleChange}
      placeholder="Search prompts…"
      emptyText="No prompts available"
      testId="task-dialog-prompts-select"
    />
  );
}

// ─────────────────────────────────────────────────────────────────────────────

interface AttachmentsSectionProps {
  taskId: string;
}

function AttachmentsSection({ taskId }: AttachmentsSectionProps): ReactElement {
  const query = useAttachmentsByTask(taskId);
  const deleteMutation = useDeleteAttachmentMutation();
  const uploadMutation = useUploadAttachmentMutation();
  const { pushToast } = useToast();

  if (query.status === "pending") {
    return (
      <div className={styles.attachmentSkeletonStack} aria-busy="true">
        <div className={styles.attachmentSkeletonRow} />
        <div className={styles.attachmentSkeletonRow} />
      </div>
    );
  }

  if (query.status === "error") {
    return (
      <div className={styles.attachmentErrorBanner} role="alert">
        <p className={styles.attachmentErrorMessage}>
          Failed to load attachments: {query.error.message}
        </p>
        <Button
          variant="secondary"
          size="sm"
          onPress={() => void query.refetch()}
        >
          Retry
        </Button>
      </div>
    );
  }

  const attachments = query.data;

  const handleDelete = (id: string): void => {
    deleteMutation.mutate(id, {
      onSuccess: () => {
        pushToast("success", "Attachment deleted");
      },
      onError: (err) => {
        pushToast("error", `Failed to delete attachment: ${err.message}`);
      },
    });
  };

  const handleUpload = (): void => {
    void (async () => {
      // Tauri v2's `dialog` plugin does NOT treat `["*"]` as a wildcard:
      // the picker filters by the literal extension `*` and ends up
      // showing nothing selectable on macOS (audit F-13). Use an
      // explicit set of doc/image attachment extensions — Tauri keeps
      // the "All files" affordance available via the picker UI.
      const result = await open({
        multiple: false,
        filters: [
          {
            name: "Documents",
            extensions: [
              "md",
              "png",
              "jpg",
              "jpeg",
              "gif",
              "webp",
              "svg",
              "pdf",
            ],
          },
        ],
      });
      if (result === null) return;
      const sourcePath = typeof result === "string" ? result : result[0];
      if (!sourcePath) return;
      const originalFilename =
        sourcePath.replace(/\\/g, "/").split("/").pop() ?? sourcePath;
      uploadMutation.mutate(
        { taskId, sourcePath, originalFilename, mimeType: null },
        {
          onSuccess: () => {
            pushToast("success", "File uploaded");
          },
          onError: (err) => {
            pushToast("error", `Failed to upload file: ${err.message}`);
          },
        },
      );
    })();
  };

  const uploadButton = (
    <Button
      variant="secondary"
      size="sm"
      isPending={uploadMutation.status === "pending"}
      onPress={handleUpload}
      data-testid="task-dialog-upload-btn"
    >
      Upload file
    </Button>
  );

  if (attachments.length === 0) {
    return (
      <div className={styles.attachmentEmptyState}>
        <p className={styles.sectionEmptyHint}>No attachments</p>
        {uploadButton}
      </div>
    );
  }

  return (
    <div className={styles.attachmentList}>
      {attachments.map((attachment) => (
        <AttachmentRow
          key={attachment.id}
          attachment={attachment}
          onDelete={handleDelete}
          isDeleting={
            deleteMutation.isPending &&
            deleteMutation.variables === attachment.id
          }
        />
      ))}
      {uploadButton}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────

/** Slug chip — read-only mono-font badge. */
function SlugChip({ slug }: { slug: string }): ReactElement {
  return (
    <span className={styles.slugChip} data-testid="task-dialog-slug-chip">
      {slug}
    </span>
  );
}

// ─────────────────────────────────────────────────────────────────────────────

/**
 * Local option-row shape for `FieldSelect`. Empty-string ids are
 * supported to encode "no selection" / "no value" choices (e.g. role).
 */
interface FieldSelectOption {
  id: string;
  label: string;
}

/**
 * Custom Select field — wraps the shared `<Select>` primitive so the
 * trigger lines up with sibling `<Input>`s in TaskDialog. Empty-string
 * `value` is treated as "no selection"; `onChange("")` fires when the
 * user picks an item with an empty id (e.g. the "(no role)" option).
 *
 * RAC's `selectedKey` API uses `Key | null` — we round-trip empty
 * strings to/from `null` only at the placeholder boundary so existing
 * call-sites can stay string-based.
 */
function FieldSelect({
  label,
  value,
  onChange,
  options,
  placeholder,
  disabled,
  testId,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  options: FieldSelectOption[];
  /** Rendered as the empty-state placeholder when `value` is "". */
  placeholder?: string;
  disabled?: boolean;
  testId?: string;
}): ReactElement {
  // RAC's `selectedKey={null}` triggers the placeholder; map "" → null.
  const selectedKey = value === "" ? null : value;

  return (
    <Select
      label={label}
      selectedKey={selectedKey}
      onSelectionChange={(key) => {
        // Normalize back to string so call-sites stay string-only.
        onChange(key === null ? "" : String(key));
      }}
      isDisabled={disabled ?? false}
      className={styles.fieldGroup}
      triggerClassName={styles.fieldTrigger}
      {...(placeholder ? { placeholder } : {})}
      {...(testId ? { "data-testid": testId } : {})}
    >
      {options.map((opt) => (
        <SelectItem key={opt.id} id={opt.id} textValue={opt.label}>
          {opt.label}
        </SelectItem>
      ))}
    </Select>
  );
}

// ─────────────────────────────────────────────────────────────────────────────

/**
 * Exported content body (round-19e). The task editor body is now
 * reused by the routed `<TaskView>` page — same form fields,
 * mutations, footer. Keep the form in one place to avoid drift.
 */
export interface TaskDialogContentProps {
  taskId: string;
  onClose: () => void;
}

export function TaskDialogContent({
  taskId,
  onClose,
}: TaskDialogContentProps): ReactElement {
  const query = useTask(taskId);
  const updateMutation = useUpdateTaskMutation();
  const deleteMutation = useDeleteTaskMutation();
  const { pushToast } = useToast();
  const { activeSpaceId } = useActiveSpace();

  // Local edit state.
  const [localTitle, setLocalTitle] = useState("");
  const [localDescription, setLocalDescription] = useState("");
  const [localBoardId, setLocalBoardId] = useState("");
  const [localColumnId, setLocalColumnId] = useState("");
  const [localRoleId, setLocalRoleId] = useState<string>(""); // "" = null (no role)
  const [saveError, setSaveError] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);

  // Remote data for dropdowns.
  const boardsQuery = useBoards();
  const columnsQuery = useColumns(localBoardId);
  const rolesQuery = useRoles();

  // Sync local state when task data loads or taskId changes.
  useEffect(() => {
    if (query.data) {
      setLocalTitle(query.data.title);
      setLocalDescription(query.data.description ?? "");
      setLocalBoardId(query.data.boardId);
      setLocalColumnId(query.data.columnId);
      setLocalRoleId(query.data.roleId ?? "");
      setSaveError(null);
      setConfirmDelete(false);
    }
  }, [query.data, taskId]);

  // Filter boards to the active space (same logic as BoardsList).
  const allBoards = boardsQuery.data ?? [];
  const filteredBoards = activeSpaceId
    ? allBoards.filter((b) => b.spaceId === activeSpaceId)
    : allBoards;

  const allColumns = columnsQuery.data ?? [];
  const allRoles = rolesQuery.data ?? [];

  // ── Pending ────────────────────────────────────────────────────────

  if (query.status === "pending") {
    return (
      <>
        <div className={styles.section}>
          <div className={cn(styles.skeletonRow, styles.skeletonRowNarrow)} />
          <div className={cn(styles.skeletonRow, styles.skeletonRowWide)} />
        </div>
        <div className={styles.section}>
          <div className={cn(styles.skeletonRow, styles.skeletonRowMedium)} />
          <div className={styles.skeletonBlock} />
        </div>
        <EditorShell.Footer className={styles.footer}>
          <div className={styles.footerActions}>
            <Button
              variant="secondary"
              size="md"
              isDisabled
              data-testid="task-dialog-cancel"
            >
              Cancel
            </Button>
            <Button
              variant="primary"
              size="md"
              isDisabled
              data-testid="task-dialog-save"
            >
              Save changes
            </Button>
          </div>
        </EditorShell.Footer>
      </>
    );
  }

  // ── Error ──────────────────────────────────────────────────────────

  if (query.status === "error") {
    return (
      <>
        <div
          className={styles.errorBanner}
          role="alert"
          data-testid="task-dialog-fetch-error"
        >
          <p className={styles.errorBannerMessage}>
            Failed to load task: {query.error.message}
          </p>
          <Button
            variant="secondary"
            size="sm"
            onPress={() => void query.refetch()}
          >
            Retry
          </Button>
        </div>
        <EditorShell.Footer className={styles.footer}>
          <div className={styles.footerActions}>
            <Button
              variant="secondary"
              size="md"
              onPress={onClose}
              data-testid="task-dialog-cancel"
            >
              Close
            </Button>
          </div>
        </EditorShell.Footer>
      </>
    );
  }

  // ── Not found ─────────────────────────────────────────────────────

  if (!query.data) {
    return (
      <>
        <div
          className={styles.notFoundBanner}
          role="alert"
          data-testid="task-dialog-not-found"
        >
          <p className={styles.notFoundBannerMessage}>Task not found.</p>
        </div>
        <EditorShell.Footer className={styles.footer}>
          <div className={styles.footerActions}>
            <Button
              variant="secondary"
              size="md"
              onPress={onClose}
              data-testid="task-dialog-cancel"
            >
              Close
            </Button>
          </div>
        </EditorShell.Footer>
      </>
    );
  }

  // ── Loaded ─────────────────────────────────────────────────────────

  const task = query.data;

  const handleBoardChange = (newBoardId: string): void => {
    setLocalBoardId(newBoardId);
    // Reset column selection when board changes — columns belong to a board.
    setLocalColumnId("");
  };

  const handleSave = (): void => {
    setSaveError(null);
    const trimmedTitle = localTitle.trim();
    if (!trimmedTitle) {
      setSaveError("Title cannot be empty.");
      return;
    }
    const trimmedDescription = localDescription.trim() || null;

    // Build partial mutation payload — only include dirty fields.
    const mutationArgs: Parameters<typeof updateMutation.mutate>[0] = {
      id: task.id,
      boardId: localBoardId || task.boardId,
    };

    if (trimmedTitle !== task.title) {
      mutationArgs.title = trimmedTitle;
    }
    if (trimmedDescription !== task.description) {
      mutationArgs.description = trimmedDescription;
    }
    if (localColumnId && localColumnId !== task.columnId) {
      mutationArgs.columnId = localColumnId;
    }
    // roleId: "" maps to null (no role), otherwise the selected id.
    const newRoleId = localRoleId === "" ? null : localRoleId;
    if (newRoleId !== task.roleId) {
      mutationArgs.roleId = newRoleId;
    }

    updateMutation.mutate(mutationArgs, {
      onSuccess: () => {
        pushToast("success", "Task saved");
        onClose();
      },
      onError: (err) => {
        pushToast("error", `Failed to save task: ${err.message}`);
        setSaveError(`Failed to save: ${err.message}`);
      },
    });
  };

  const handleCancel = (): void => {
    setLocalTitle(task.title);
    setLocalDescription(task.description ?? "");
    setLocalBoardId(task.boardId);
    setLocalColumnId(task.columnId);
    setLocalRoleId(task.roleId ?? "");
    setSaveError(null);
    setConfirmDelete(false);
    onClose();
  };

  const handleDeleteRequest = (): void => {
    setConfirmDelete(true);
  };

  const handleDeleteConfirm = (): void => {
    deleteMutation.mutate(
      { id: task.id, boardId: task.boardId },
      {
        onSuccess: () => {
          pushToast("success", "Task deleted");
          onClose();
        },
        onError: (err) => {
          pushToast("error", `Failed to delete task: ${err.message}`);
          setConfirmDelete(false);
        },
      },
    );
  };

  const handleDeleteCancel = (): void => {
    setConfirmDelete(false);
  };

  return (
    <>
      <Scrollable axis="y" className={styles.scrollArea}>
      {/* Slug chip */}
      <div className={styles.slugRow}>
        <SlugChip slug={task.slug} />
      </div>

      {/* Title */}
      <div className={styles.section}>
        <Input
          label="Title"
          value={localTitle}
          onChange={setLocalTitle}
          placeholder="Task title"
          className={styles.titleInput}
          data-testid="task-dialog-title-input"
        />
      </div>

      {/* Description — implicit view ⇄ edit toggle via MarkdownField (ctq-76 #11). */}
      <div className={styles.section}>
        <p className={styles.sectionLabel}>Description</p>
        <MarkdownField
          value={localDescription}
          onChange={setLocalDescription}
          placeholder="Add a description…"
          ariaLabel="Description"
          data-testid="task-dialog-description-textarea"
        />
      </div>

      {/* Board + Column row */}
      <div className={cn(styles.section, styles.rowSection)}>
        <FieldSelect
          label="Board"
          value={localBoardId}
          onChange={handleBoardChange}
          options={
            filteredBoards.length === 0
              ? [{ id: localBoardId, label: localBoardId }]
              : filteredBoards.map((b) => ({ id: b.id, label: b.name }))
          }
          disabled={boardsQuery.status === "pending"}
          testId="task-dialog-board-select"
        />

        <FieldSelect
          label="Status / Column"
          value={localColumnId}
          onChange={setLocalColumnId}
          options={allColumns.map((c) => ({ id: c.id, label: c.name }))}
          placeholder="— select —"
          disabled={columnsQuery.status === "pending" || !localBoardId}
          testId="task-dialog-column-select"
        />
      </div>

      {/* Role */}
      <div className={styles.section}>
        <FieldSelect
          label="Role"
          value={localRoleId}
          onChange={setLocalRoleId}
          options={[
            { id: "", label: "(no role)" },
            ...allRoles.map((r) => ({ id: r.id, label: r.name })),
          ]}
          disabled={rolesQuery.status === "pending"}
          testId="task-dialog-role-select"
        />
      </div>

      {/* Attached prompts */}
      <div
        className={styles.sectionBlock}
        data-testid="task-dialog-prompts-section"
      >
        <h3 className={styles.sectionHeading}>Attached prompts</h3>
        <PromptsSection taskId={task.id} />
      </div>

      {/* Attachments */}
      <div
        className={styles.sectionBlock}
        data-testid="task-dialog-placeholder-attachments"
      >
        <h3 className={styles.sectionHeading}>Attachments</h3>
        <AttachmentsSection taskId={task.id} />
      </div>

      {/* Agent reports */}
      <div
        className={styles.sectionBlock}
        data-testid="task-dialog-placeholder-agent-reports"
      >
        <h3 className={styles.sectionHeading}>Agent reports</h3>
        <AgentReportsList taskId={task.id} />
      </div>

      </Scrollable>

      {/* Footer */}
      <EditorShell.Footer className={styles.footer}>
        {/* Delete (trash) button — left side */}
        {confirmDelete ? (
          <div className={styles.deleteConfirm} data-testid="task-dialog-delete-confirm">
            <span className={styles.deleteConfirmText}>Delete task?</span>
            <Button
              variant="secondary"
              size="sm"
              onPress={handleDeleteCancel}
              data-testid="task-dialog-delete-cancel"
            >
              No
            </Button>
            <Button
              variant="ghost"
              size="sm"
              isPending={deleteMutation.status === "pending"}
              onPress={handleDeleteConfirm}
              className={styles.deleteConfirmBtn}
              data-testid="task-dialog-delete-confirm-btn"
            >
              Yes, delete
            </Button>
          </div>
        ) : (
          <Button
            variant="ghost"
            size="sm"
            onPress={handleDeleteRequest}
            className={styles.deleteBtn}
            aria-label="Delete task"
            data-testid="task-dialog-delete-btn"
          >
            🗑
          </Button>
        )}

        <div className={styles.footerActions}>
          {saveError ? (
            <p
              className={styles.saveError}
              role="alert"
              data-testid="task-dialog-save-error"
            >
              {saveError}
            </p>
          ) : null}
          <Button
            variant="secondary"
            size="md"
            onPress={handleCancel}
            data-testid="task-dialog-cancel"
          >
            Cancel
          </Button>
          <Button
            variant="primary"
            size="md"
            isPending={updateMutation.status === "pending"}
            onPress={handleSave}
            data-testid="task-dialog-save"
          >
            Save changes
          </Button>
        </div>
      </EditorShell.Footer>
    </>
  );
}
