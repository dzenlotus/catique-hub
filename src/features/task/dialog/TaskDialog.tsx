/**
 * TaskDialog — task detail / edit modal (Design System v1).
 *
 * Fields (in order):
 *   1. Title (text input)
 *   2. Slug (read-only mono badge)
 *   3. Description (textarea + edit/preview toggle)
 *   4. Attached prompts (multiselect)
 *   5. Attachments (wired — upload/delete)
 *   6. Agent reports (wired)
 *
 * Audit-#10 dropped Board + Status; kanban drag handles re-ordering.
 * Round-21 (maintainer feedback): the Assignee picker is gone too —
 * a task's role is the owning board's role, set server-side.
 *
 * Footer: trash-icon delete button (left) + Cancel + Save (right).
 */

import {
  useCallback,
  useEffect,
  useMemo,
  useState,
  type Key,
  type ReactElement,
} from "react";
import { open } from "@tauri-apps/plugin-dialog";
import type { TaskKind } from "@bindings/TaskKind";
import {
  useTask,
  useTaskPrompts,
  useUpdateTaskMutation,
  useDeleteTaskMutation,
  useSetTaskPromptsMutation,
  setTaskDraft,
  clearTaskDraft,
} from "@entities/task";
import {
  useTaskPromptGroups,
  useSetTaskPromptGroupsMutation,
  useGroupedPromptSelect,
} from "@entities/prompt-group";
import {
  useAttachmentsByTask,
  useDeleteAttachmentMutation,
  useUploadAttachmentMutation,
  AttachmentRow,
} from "@entities/attachment";
import {
  Dialog,
  EditorShell,
  Button,
  GroupButton,
  Input,
  MarkdownField,
  SelectTag,
  Scrollable,
} from "@shared/ui";
import { cn } from "@shared/lib";
import { AgentReportsList } from "@widgets/agent-reports-list";
import { useToast } from "@shared/lib";
import { TaskRelations } from "../relations";

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
  const groupsQuery = useTaskPromptGroups(taskId);
  const setMutation = useSetTaskPromptsMutation();
  const setGroupsMutation = useSetTaskPromptGroupsMutation();
  const { pushToast } = useToast();

  const attachedIds = useMemo(
    () => (attachedQuery.data ?? []).map((p) => p.id),
    [attachedQuery.data],
  );
  const attachedGroupIds = useMemo(
    () => groupsQuery.data ?? [],
    [groupsQuery.data],
  );

  const handleChangePrompts = useCallback(
    (next: string[]): void => {
      setMutation.mutate(
        { taskId, previous: attachedIds, next },
        {
          onError: (err) => {
            pushToast("error", `Failed to update prompts: ${err.message}`);
          },
        },
      );
    },
    [setMutation, taskId, attachedIds, pushToast],
  );

  const handleChangeGroups = useCallback(
    (next: string[]): void => {
      setGroupsMutation.mutate(
        { id: taskId, groupIds: next },
        {
          onError: (err) => {
            pushToast("error", `Failed to update prompt groups: ${err.message}`);
          },
        },
      );
    },
    [setGroupsMutation, taskId, pushToast],
  );

  const { options, values, onChange } = useGroupedPromptSelect({
    attachedPromptIds: attachedIds,
    attachedGroupIds,
    onChangePrompts: handleChangePrompts,
    onChangeGroups: handleChangeGroups,
  });

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

  return (
    <SelectTag
      label="Task prompts"
      values={values}
      options={options}
      onChange={onChange}
      placeholder="Search prompts or groups…"
      data-testid="task-dialog-prompts-select"
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

  // Local edit state. boardId/columnId stay on the underlying record
  // (and in the mutation payload) so the task keeps its kanban
  // location after edits — the dropdowns were dropped in audit-#10 but
  // the data is not.
  const [localTitle, setLocalTitle] = useState("");
  const [localDescription, setLocalDescription] = useState("");
  const [localKind, setLocalKind] = useState<TaskKind>("blank");
  const [saveError, setSaveError] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);

  // Sync local state when task data loads or taskId changes. The draft is
  // reset to the saved values so the right-hand XML preview re-aligns with
  // the bundle after a server refresh.
  useEffect(() => {
    if (query.data) {
      setLocalTitle(query.data.title);
      setLocalDescription(query.data.description ?? "");
      setLocalKind(query.data.kind);
      setSaveError(null);
      setConfirmDelete(false);
      clearTaskDraft(taskId);
    }
  }, [query.data, taskId]);

  // Drop the live draft when the editor unmounts (or the task changes) so a
  // stale draft never leaks into the next mount's preview.
  useEffect(() => {
    return () => {
      clearTaskDraft(taskId);
    };
  }, [taskId]);

  // Title / description edits mirror into the per-task draft store so the
  // routed `TaskView` XML preview reflects unsaved text live (the bundle is
  // only refreshed on Save). Local state stays the controlled source of
  // truth for the form itself.
  const handleTitleChange = useCallback(
    (next: string): void => {
      setLocalTitle(next);
      setTaskDraft(taskId, { title: next });
    },
    [taskId],
  );

  const handleDescriptionChange = useCallback(
    (next: string): void => {
      setLocalDescription(next);
      setTaskDraft(taskId, { description: next });
    },
    [taskId],
  );

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
      boardId: task.boardId,
    };

    if (trimmedTitle !== task.title) {
      mutationArgs.title = trimmedTitle;
    }
    if (trimmedDescription !== task.description) {
      mutationArgs.description = trimmedDescription;
    }
    if (localKind !== task.kind) {
      mutationArgs.kind = localKind;
    }
    // audit-#10: column / board are no longer user-editable from the
    // dialog; reordering happens via kanban drag.
    // round-21: roleId is no longer editable — a task's role follows
    // the owning board's role and is resolved server-side.

    updateMutation.mutate(mutationArgs, {
      onSuccess: () => {
        clearTaskDraft(task.id);
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
    setLocalKind(task.kind);
    setSaveError(null);
    setConfirmDelete(false);
    clearTaskDraft(task.id);
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
          onChange={handleTitleChange}
          placeholder="Task title"
          className={styles.titleInput}
          data-testid="task-dialog-title-input"
        />
      </div>

      {/* Type (catique) — task classification. */}
      <div className={styles.section}>
        <p className={styles.sectionLabel}>Type</p>
        <GroupButton
          selectionMode="single"
          selectedKey={localKind}
          onSelectionChange={(key: Key) => setLocalKind(String(key) as TaskKind)}
          size="sm"
          ariaLabel="Task type"
          testId="task-dialog-kind"
        >
          <GroupButton.Item id="blank">Blank</GroupButton.Item>
          <GroupButton.Item id="feature">Feature</GroupButton.Item>
          <GroupButton.Item id="bug">Bug</GroupButton.Item>
          <GroupButton.Item id="research">Research</GroupButton.Item>
        </GroupButton>
      </div>

      {/* Description — implicit view ⇄ edit toggle via MarkdownField (ctq-76 #11). */}
      <div className={styles.section}>
        <p className={styles.sectionLabel}>Description</p>
        <MarkdownField
          value={localDescription}
          onChange={handleDescriptionChange}
          placeholder="Add a description…"
          ariaLabel="Description"
          data-testid="task-dialog-description-textarea"
        />
      </div>

      {/* audit-#10: Board + Column dropdowns are gone — the task already
          lives in a known board+column when this dialog opens; reordering
          happens via kanban drag. Round-21: the Assignee picker is gone
          too — a task's role follows the owning board's role. */}

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

      {/* Linked tasks (catique-4) */}
      <div
        className={styles.sectionBlock}
        data-testid="task-dialog-relations-section"
      >
        <h3 className={styles.sectionHeading}>Linked tasks</h3>
        <TaskRelations taskId={task.id} />
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
