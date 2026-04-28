/**
 * TaskDialog — task detail / edit modal.
 *
 * Scope (E4.1 slice): title + description editing.
 * Agent reports are wired via AgentReportsList (taskId filter).
 * Prompts: empty state shown — no list_task_prompts IPC exists yet (E4 vslice).
 * Attachments: placeholder — no FE vslice yet.
 *
 * Props:
 *   - `taskId` — null → dialog closed; string → dialog open for that task.
 *   - `onClose` — called on Cancel, successful Save, or Esc (via RAC).
 */

import { useEffect, useState, type ReactElement } from "react";
import { useTask, useUpdateTaskMutation } from "@entities/task";
import {
  useAttachmentsByTask,
  useDeleteAttachmentMutation,
  AttachmentRow,
} from "@entities/attachment";
import { Dialog, Button, Input, Tooltip, TooltipTrigger, MarkdownPreview } from "@shared/ui";
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
 * `TaskDialog` — modal for viewing and editing a task's title and description.
 *
 * The dialog delegates open/close tracking to `taskId` — when null the
 * `<Dialog>` `isOpen` prop is false, so RAC handles exit animations and
 * focus restoration correctly.
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
  const { pushToast } = useToast();

  // ── Pending ──────────────────────────────────────────────────────
  if (query.status === "pending") {
    return (
      <div className={styles.attachmentSkeletonStack} aria-busy="true">
        <div className={styles.attachmentSkeletonRow} />
        <div className={styles.attachmentSkeletonRow} />
      </div>
    );
  }

  // ── Error ────────────────────────────────────────────────────────
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

  // ── Loaded ───────────────────────────────────────────────────────
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

  if (attachments.length === 0) {
    return (
      <div className={styles.attachmentEmptyState}>
        <p className={styles.sectionEmptyHint}>Нет вложений</p>
        <TooltipTrigger>
          <Button variant="secondary" size="sm" isDisabled>
            Загрузить файл
          </Button>
          <Tooltip placement="bottom">Загрузка через UI появится в E5</Tooltip>
        </TooltipTrigger>
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
  const { pushToast } = useToast();

  // Local edit state — initialised from the loaded task.
  const [localTitle, setLocalTitle] = useState("");
  const [localDescription, setLocalDescription] = useState("");
  const [saveError, setSaveError] = useState<string | null>(null);
  const [descViewMode, setDescViewMode] = useState<"edit" | "preview">("edit");

  // Sync local state when task data loads or taskId changes.
  useEffect(() => {
    if (query.data) {
      setLocalTitle(query.data.title);
      setLocalDescription(query.data.description ?? "");
      setSaveError(null);
    }
  }, [query.data, taskId]);

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
          <p className={styles.notFoundBannerMessage}>
            Задача не найдена.
          </p>
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

  const handleSave = (): void => {
    setSaveError(null);
    const trimmedTitle = localTitle.trim();
    if (!trimmedTitle) {
      setSaveError("Название не может быть пустым.");
      return;
    }
    const trimmedDescription = localDescription.trim() || null;
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
    updateMutation.mutate(
      mutationArgs,
      {
        onSuccess: () => {
          pushToast("success", "Задача сохранена");
          onClose();
        },
        onError: (err) => {
          pushToast("error", `Не удалось сохранить задачу: ${err.message}`);
          setSaveError(`Не удалось сохранить: ${err.message}`);
        },
      },
    );
  };

  const handleCancel = (): void => {
    // Reset local state back to task values before closing.
    setLocalTitle(task.title);
    setLocalDescription(task.description ?? "");
    setSaveError(null);
    onClose();
  };

  return (
    <>
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

      {/* Prompts attached — empty state until list_task_prompts IPC lands */}
      <div
        className={styles.sectionBlock}
        data-testid="task-dialog-placeholder-prompts"
      >
        <h3 className={styles.sectionHeading}>Прикреплённые промпты</h3>
        <div className={styles.sectionEmptyState}>
          <p className={styles.sectionEmptyHint}>
            Промпты не прикреплены
          </p>
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

      {/* Agent reports — wired via AgentReportsList with taskId filter */}
      <div
        className={styles.sectionBlock}
        data-testid="task-dialog-placeholder-agent-reports"
      >
        <h3 className={styles.sectionHeading}>Отчёты агента</h3>
        <AgentReportsList taskId={task.id} />
      </div>

      {/* Footer */}
      <div className={styles.footer}>
        {saveError ? (
          <p className={styles.saveError} role="alert" data-testid="task-dialog-save-error">
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
    </>
  );
}
