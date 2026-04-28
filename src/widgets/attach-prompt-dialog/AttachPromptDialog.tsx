/**
 * AttachPromptDialog — modal for attaching an existing Prompt to a target
 * (Board / Column / Task / Role) via the join-table IPCs.
 *
 * Props:
 *   - `isOpen`      — controls dialog visibility.
 *   - `onClose`     — called on Cancel, successful Save, or Esc.
 *   - `onAttached`  — optional callback invoked after a successful attach.
 *
 * Form steps:
 *   1. Pick target kind (radio group): Доска / Колонка / Задача / Роль.
 *   2. Pick a target (cascading Comboboxes depending on kind).
 *   3. Pick a prompt (Combobox from usePrompts()).
 */

import { useState, type ReactElement } from "react";
import type { Key } from "react-aria-components";

import { useToast } from "@app/providers/ToastProvider";
import {
  useBoards,
  useAddBoardPromptMutation,
} from "@entities/board";
import {
  useColumns,
  useAddColumnPromptMutation,
} from "@entities/column";
import {
  useTasksByBoard,
  useAddTaskPromptMutation,
} from "@entities/task";
import {
  useRoles,
  useAddRolePromptMutation,
} from "@entities/role";
import { usePrompts } from "@entities/prompt";
import { Dialog, Button, Combobox } from "@shared/ui";
import type { ComboboxItem } from "@shared/ui";

import styles from "./AttachPromptDialog.module.css";

// ─── Public props ────────────────────────────────────────────────────────────

export interface AttachPromptDialogProps {
  isOpen: boolean;
  onClose: () => void;
  onAttached?: () => void;
}

// ─── Target-kind discriminant ─────────────────────────────────────────────────

type TargetKind = "board" | "column" | "task" | "role";

const TARGET_KINDS: { value: TargetKind; label: string }[] = [
  { value: "board", label: "Доска" },
  { value: "column", label: "Колонка" },
  { value: "task", label: "Задача" },
  { value: "role", label: "Роль" },
];

// ─── Shell ───────────────────────────────────────────────────────────────────

/**
 * `AttachPromptDialog` — controlled Dialog shell.
 * Mounts content lazily so hook state resets on close.
 */
export function AttachPromptDialog({
  isOpen,
  onClose,
  onAttached,
}: AttachPromptDialogProps): ReactElement {
  return (
    <Dialog
      title="Прикрепить промпт"
      isOpen={isOpen}
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
      isDismissable
      className={styles.dialogBody}
      data-testid="attach-prompt-dialog"
    >
      {() =>
        isOpen ? (
          <AttachPromptDialogContent
            onClose={onClose}
            {...(onAttached !== undefined ? { onAttached } : {})}
          />
        ) : null
      }
    </Dialog>
  );
}

// ─── Content ─────────────────────────────────────────────────────────────────

interface AttachPromptDialogContentProps {
  onClose: () => void;
  onAttached?: () => void;
}

function AttachPromptDialogContent({
  onClose,
  onAttached,
}: AttachPromptDialogContentProps): ReactElement {
  const { pushToast } = useToast();
  const [kind, setKind] = useState<TargetKind>("board");

  // Cascade board → column / task
  const [selectedBoardId, setSelectedBoardId] = useState<string>("");
  const [selectedTargetId, setSelectedTargetId] = useState<string>("");
  const [selectedPromptId, setSelectedPromptId] = useState<string>("");

  const [saveError, setSaveError] = useState<string | null>(null);

  // Mutations
  const addBoardPrompt = useAddBoardPromptMutation();
  const addColumnPrompt = useAddColumnPromptMutation();
  const addTaskPrompt = useAddTaskPromptMutation();
  const addRolePrompt = useAddRolePromptMutation();

  // Data queries
  const boardsQuery = useBoards();
  const columnsQuery = useColumns(
    kind === "column" ? selectedBoardId : "",
  );
  const tasksQuery = useTasksByBoard(
    kind === "task" ? selectedBoardId : "",
  );
  const rolesQuery = useRoles();
  const promptsQuery = usePrompts();

  // ── Derived combobox items ──────────────────────────────────────────

  const boardItems: ComboboxItem[] = (boardsQuery.data ?? []).map((b) => ({
    id: b.id,
    label: b.name,
  }));

  const columnItems: ComboboxItem[] = (columnsQuery.data ?? []).map((c) => ({
    id: c.id,
    label: c.name,
  }));

  const taskItems: ComboboxItem[] = (tasksQuery.data ?? []).map((t) => ({
    id: t.id,
    label: t.title,
  }));

  const roleItems: ComboboxItem[] = (rolesQuery.data ?? []).map((r) => ({
    id: r.id,
    label: r.name,
  }));

  const promptItems: ComboboxItem[] = (promptsQuery.data ?? []).map((p) => ({
    id: p.id,
    label: p.name,
    ...(p.shortDescription != null ? { detail: p.shortDescription } : {}),
  }));

  // ── Kind change — reset cascade ────────────────────────────────────

  const handleKindChange = (next: TargetKind): void => {
    setKind(next);
    setSelectedBoardId("");
    setSelectedTargetId("");
  };

  // ── Validation ─────────────────────────────────────────────────────

  const needsBoardFirst = kind === "column" || kind === "task";
  const targetId =
    kind === "board"
      ? selectedBoardId
      : kind === "role"
        ? selectedTargetId
        : selectedTargetId;

  const isPending =
    addBoardPrompt.status === "pending" ||
    addColumnPrompt.status === "pending" ||
    addTaskPrompt.status === "pending" ||
    addRolePrompt.status === "pending";

  const canSubmit =
    selectedPromptId.length > 0 &&
    targetId.length > 0 &&
    (needsBoardFirst ? selectedBoardId.length > 0 : true);

  // ── Submit ─────────────────────────────────────────────────────────

  const handleSave = (): void => {
    setSaveError(null);
    if (!canSubmit) return;

    const position = 0;

    const opts = {
      onSuccess: () => {
        pushToast("success", "Промпт прикреплён");
        onAttached?.();
        onClose();
      },
      onError: (err: Error) => {
        pushToast("error", `Не удалось прикрепить промпт: ${err.message}`);
        setSaveError(`Не удалось прикрепить: ${err.message}`);
      },
    };

    switch (kind) {
      case "board":
        addBoardPrompt.mutate(
          { boardId: selectedBoardId, promptId: selectedPromptId, position },
          opts,
        );
        break;
      case "column":
        addColumnPrompt.mutate(
          { columnId: selectedTargetId, promptId: selectedPromptId, position },
          opts,
        );
        break;
      case "task":
        addTaskPrompt.mutate(
          { taskId: selectedTargetId, promptId: selectedPromptId, position },
          opts,
        );
        break;
      case "role":
        addRolePrompt.mutate(
          { roleId: selectedTargetId, promptId: selectedPromptId, position },
          opts,
        );
        break;
    }
  };

  const handleCancel = (): void => {
    onClose();
  };

  // ── Selection helpers ──────────────────────────────────────────────

  const handleBoardSelect = (key: Key | null): void => {
    setSelectedBoardId(key != null ? String(key) : "");
    setSelectedTargetId(""); // reset column/task when board changes
  };

  const handleTargetSelect = (key: Key | null): void => {
    setSelectedTargetId(key != null ? String(key) : "");
  };

  const handlePromptSelect = (key: Key | null): void => {
    setSelectedPromptId(key != null ? String(key) : "");
  };

  // ── Render ─────────────────────────────────────────────────────────

  return (
    <>
      {/* Step 1 — target kind */}
      <div className={styles.section}>
        <p className={styles.sectionLabel}>Тип цели</p>
        <div
          className={styles.kindGroup}
          role="radiogroup"
          aria-label="Тип цели"
          data-testid="attach-prompt-dialog-target-kind"
        >
          {TARGET_KINDS.map(({ value, label }) => (
            <label key={value} className={styles.kindOption}>
              <input
                type="radio"
                name="attach-target-kind"
                value={value}
                checked={kind === value}
                onChange={() => handleKindChange(value)}
                className={styles.kindRadio}
              />
              {label}
            </label>
          ))}
        </div>
      </div>

      {/* Step 2 — target selection */}
      <div
        className={styles.section}
        data-testid="attach-prompt-dialog-target"
      >
        <p className={styles.sectionLabel}>Цель</p>

        {/* Board picker — shown for all kinds that need a board */}
        {kind === "board" && (
          <Combobox
            label="Доска"
            items={boardItems}
            placeholder="Выберите доску..."
            emptyState="Нет доступных досок"
            className={styles.combobox}
            onSelectionChange={handleBoardSelect}
            selectedKey={selectedBoardId !== "" ? selectedBoardId : null}
          />
        )}

        {/* Column: first board, then column */}
        {kind === "column" && (
          <>
            <Combobox
              label="Доска"
              items={boardItems}
              placeholder="Сначала выберите доску..."
              emptyState="Нет доступных досок"
              className={styles.combobox}
              onSelectionChange={handleBoardSelect}
              selectedKey={selectedBoardId !== "" ? selectedBoardId : null}
            />
            <Combobox
              label="Колонка"
              items={columnItems}
              placeholder={
                selectedBoardId !== ""
                  ? "Выберите колонку..."
                  : "Сначала выберите доску"
              }
              emptyState="Нет колонок на этой доске"
              className={styles.combobox}
              isDisabled={selectedBoardId === ""}
              onSelectionChange={handleTargetSelect}
              selectedKey={selectedTargetId !== "" ? selectedTargetId : null}
            />
          </>
        )}

        {/* Task: first board, then task */}
        {kind === "task" && (
          <>
            <Combobox
              label="Доска"
              items={boardItems}
              placeholder="Сначала выберите доску..."
              emptyState="Нет доступных досок"
              className={styles.combobox}
              onSelectionChange={handleBoardSelect}
              selectedKey={selectedBoardId !== "" ? selectedBoardId : null}
            />
            <Combobox
              label="Задача"
              items={taskItems}
              placeholder={
                selectedBoardId !== ""
                  ? "Выберите задачу..."
                  : "Сначала выберите доску"
              }
              emptyState="Нет задач на этой доске"
              className={styles.combobox}
              isDisabled={selectedBoardId === ""}
              onSelectionChange={handleTargetSelect}
              selectedKey={selectedTargetId !== "" ? selectedTargetId : null}
            />
          </>
        )}

        {/* Role picker */}
        {kind === "role" && (
          <Combobox
            label="Роль"
            items={roleItems}
            placeholder="Выберите роль..."
            emptyState="Нет доступных ролей"
            className={styles.combobox}
            onSelectionChange={handleTargetSelect}
            selectedKey={selectedTargetId !== "" ? selectedTargetId : null}
          />
        )}
      </div>

      {/* Step 3 — prompt selection */}
      <div className={styles.section}>
        <Combobox
          label="Промпт"
          items={promptItems}
          placeholder="Выберите промпт..."
          emptyState="Нет доступных промптов"
          className={styles.combobox}
          onSelectionChange={handlePromptSelect}
          selectedKey={selectedPromptId !== "" ? selectedPromptId : null}
          data-testid="attach-prompt-dialog-prompt"
        />
      </div>

      {/* Footer */}
      <div className={styles.footer}>
        {saveError != null ? (
          <p
            className={styles.saveError}
            role="alert"
            data-testid="attach-prompt-dialog-error"
          >
            {saveError}
          </p>
        ) : null}
        <Button
          variant="ghost"
          size="md"
          onPress={handleCancel}
          data-testid="attach-prompt-dialog-cancel"
        >
          Отмена
        </Button>
        <Button
          variant="primary"
          size="md"
          isPending={isPending}
          isDisabled={!canSubmit}
          onPress={handleSave}
          data-testid="attach-prompt-dialog-save"
        >
          Прикрепить
        </Button>
      </div>
    </>
  );
}
