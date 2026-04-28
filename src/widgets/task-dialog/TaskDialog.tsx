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

import React, { useEffect, useState, type ReactElement } from "react";
import { open } from "@tauri-apps/plugin-dialog";
import {
  useTask,
  useUpdateTaskMutation,
  useDeleteTaskMutation,
} from "@entities/task";
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
import { Dialog, Button, Input, MarkdownPreview } from "@shared/ui";
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
      title="Задача"
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
          Не удалось загрузить вложения: {query.error.message}
        </p>
        <Button
          variant="secondary"
          size="sm"
          onPress={() => void query.refetch()}
        >
          Повторить
        </Button>
      </div>
    );
  }

  const attachments = query.data;

  const handleDelete = (id: string): void => {
    deleteMutation.mutate(id, {
      onSuccess: () => {
        pushToast("success", "Вложение удалено");
      },
      onError: (err) => {
        pushToast("error", `Не удалось удалить вложение: ${err.message}`);
      },
    });
  };

  const handleUpload = (): void => {
    void (async () => {
      const result = await open({
        multiple: false,
        filters: [{ name: "Любой файл", extensions: ["*"] }],
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
            pushToast("success", "Файл загружен");
          },
          onError: (err) => {
            pushToast("error", `Не удалось загрузить файл: ${err.message}`);
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
      Загрузить файл
    </Button>
  );

  if (attachments.length === 0) {
    return (
      <div className={styles.attachmentEmptyState}>
        <p className={styles.sectionEmptyHint}>Нет вложений</p>
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

/** Inline native-select field with DS v1 styling. */
function FieldSelect({
  label,
  value,
  onChange,
  disabled,
  testId,
  children,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  disabled?: boolean;
  testId?: string;
  children: React.ReactNode;
}): ReactElement {
  return (
    <div className={styles.fieldGroup}>
      <label className={styles.fieldLabel}>{label}</label>
      <select
        className={styles.fieldSelect}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        disabled={disabled}
        data-testid={testId}
      >
        {children}
      </select>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────

interface TaskDialogContentProps {
  taskId: string;
  onClose: () => void;
}

function TaskDialogContent({
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
  const [descViewMode, setDescViewMode] = useState<"edit" | "preview">("edit");
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
        <div className={styles.footer}>
          <Button
            variant="ghost"
            size="md"
            isDisabled
            data-testid="task-dialog-cancel"
          >
            Отмена
          </Button>
          <Button
            variant="primary"
            size="md"
            isDisabled
            data-testid="task-dialog-save"
          >
            Сохранить
          </Button>
        </div>
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
            Не удалось загрузить задачу: {query.error.message}
          </p>
          <Button
            variant="secondary"
            size="sm"
            onPress={() => void query.refetch()}
          >
            Повторить
          </Button>
        </div>
        <div className={styles.footer}>
          <Button
            variant="ghost"
            size="md"
            onPress={onClose}
            data-testid="task-dialog-cancel"
          >
            Закрыть
          </Button>
        </div>
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
          <p className={styles.notFoundBannerMessage}>Задача не найдена.</p>
        </div>
        <div className={styles.footer}>
          <Button
            variant="ghost"
            size="md"
            onPress={onClose}
            data-testid="task-dialog-cancel"
          >
            Закрыть
          </Button>
        </div>
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
      setSaveError("Название не может быть пустым.");
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
        pushToast("success", "Задача сохранена");
        onClose();
      },
      onError: (err) => {
        pushToast("error", `Не удалось сохранить задачу: ${err.message}`);
        setSaveError(`Не удалось сохранить: ${err.message}`);
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
          pushToast("success", "Задача удалена");
          onClose();
        },
        onError: (err) => {
          pushToast("error", `Не удалось удалить задачу: ${err.message}`);
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
      {/* Slug chip */}
      <div className={styles.slugRow}>
        <SlugChip slug={task.slug} />
      </div>

      {/* Title */}
      <div className={styles.section}>
        <Input
          label="Название"
          value={localTitle}
          onChange={setLocalTitle}
          placeholder="Название задачи"
          className={styles.titleInput}
          data-testid="task-dialog-title-input"
        />
      </div>

      {/* Description */}
      <div className={styles.section}>
        <p className={styles.sectionLabel}>Описание</p>
        <div
          role="group"
          aria-label="Режим редактора описания"
          className={styles.modeToggle}
          data-testid="task-dialog-description-mode-toggle"
        >
          <Button
            variant="ghost"
            size="sm"
            className={styles.modeToggleBtn}
            aria-pressed={descViewMode === "edit"}
            onPress={() => setDescViewMode("edit")}
            data-testid="task-dialog-description-mode-edit"
          >
            Редактировать
          </Button>
          <Button
            variant="ghost"
            size="sm"
            className={styles.modeToggleBtn}
            aria-pressed={descViewMode === "preview"}
            onPress={() => setDescViewMode("preview")}
            data-testid="task-dialog-description-mode-preview"
          >
            Превью
          </Button>
        </div>
        {descViewMode === "edit" ? (
          <textarea
            className={styles.descriptionTextarea}
            value={localDescription}
            onChange={(e) => setLocalDescription(e.target.value)}
            placeholder="Добавьте описание..."
            data-testid="task-dialog-description-textarea"
            aria-label="Описание"
          />
        ) : (
          <MarkdownPreview
            source={localDescription}
            className={styles.descriptionPreview}
          />
        )}
      </div>

      {/* Board + Column row */}
      <div className={cn(styles.section, styles.rowSection)}>
        <FieldSelect
          label="Доска"
          value={localBoardId}
          onChange={handleBoardChange}
          disabled={boardsQuery.status === "pending"}
          testId="task-dialog-board-select"
        >
          {filteredBoards.length === 0 ? (
            <option value={localBoardId}>{localBoardId}</option>
          ) : (
            filteredBoards.map((b) => (
              <option key={b.id} value={b.id}>
                {b.name}
              </option>
            ))
          )}
        </FieldSelect>

        <FieldSelect
          label="Статус / Колонка"
          value={localColumnId}
          onChange={setLocalColumnId}
          disabled={columnsQuery.status === "pending" || !localBoardId}
          testId="task-dialog-column-select"
        >
          {localColumnId === "" ? (
            <option value="">— выберите —</option>
          ) : null}
          {allColumns.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </FieldSelect>
      </div>

      {/* Role */}
      <div className={styles.section}>
        <FieldSelect
          label="Роль агента"
          value={localRoleId}
          onChange={setLocalRoleId}
          disabled={rolesQuery.status === "pending"}
          testId="task-dialog-role-select"
        >
          <option value="">(нет роли)</option>
          {allRoles.map((r) => (
            <option key={r.id} value={r.id}>
              {r.name}
            </option>
          ))}
        </FieldSelect>
      </div>

      {/* Attached prompts — empty state placeholder */}
      <div
        className={styles.sectionBlock}
        data-testid="task-dialog-placeholder-prompts"
      >
        <h3 className={styles.sectionHeading}>Прикреплённые промпты</h3>
        <div className={styles.sectionEmptyState}>
          <p className={styles.sectionEmptyHint}>Промпты не прикреплены</p>
          <p className={styles.sectionComingHint}>
            (появится с вслайсом прикрепления промптов E4)
          </p>
        </div>
      </div>

      {/* Attachments */}
      <div
        className={styles.sectionBlock}
        data-testid="task-dialog-placeholder-attachments"
      >
        <h3 className={styles.sectionHeading}>Вложения</h3>
        <AttachmentsSection taskId={task.id} />
      </div>

      {/* Agent reports */}
      <div
        className={styles.sectionBlock}
        data-testid="task-dialog-placeholder-agent-reports"
      >
        <h3 className={styles.sectionHeading}>Отчёты агента</h3>
        <AgentReportsList taskId={task.id} />
      </div>

      {/* Footer */}
      <div className={styles.footer}>
        {/* Delete (trash) button — left side */}
        {confirmDelete ? (
          <div className={styles.deleteConfirm} data-testid="task-dialog-delete-confirm">
            <span className={styles.deleteConfirmText}>Удалить задачу?</span>
            <Button
              variant="secondary"
              size="sm"
              onPress={handleDeleteCancel}
              data-testid="task-dialog-delete-cancel"
            >
              Нет
            </Button>
            <Button
              variant="ghost"
              size="sm"
              isPending={deleteMutation.status === "pending"}
              onPress={handleDeleteConfirm}
              className={styles.deleteConfirmBtn}
              data-testid="task-dialog-delete-confirm-btn"
            >
              Да, удалить
            </Button>
          </div>
        ) : (
          <Button
            variant="ghost"
            size="sm"
            onPress={handleDeleteRequest}
            className={styles.deleteBtn}
            aria-label="Удалить задачу"
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
            variant="ghost"
            size="md"
            onPress={handleCancel}
            data-testid="task-dialog-cancel"
          >
            Отмена
          </Button>
          <Button
            variant="primary"
            size="md"
            isPending={updateMutation.status === "pending"}
            onPress={handleSave}
            data-testid="task-dialog-save"
          >
            Сохранить
          </Button>
        </div>
      </div>
    </>
  );
}
