/**
 * AttachPromptDialog — modal for attaching an existing Prompt to a target
 * (Board / Column / Task / Role) via the join-table IPCs.
 *
 * Props:
 *   - `isOpen`        — controls dialog visibility.
 *   - `onClose`       — called on Cancel, successful Save, or Esc.
 *   - `onAttached`    — optional callback invoked after a successful attach.
 *   - `defaultTarget` — optional target to pre-populate the form with.
 *   - `lockedTarget`  — when true, the target is fixed to `defaultTarget`
 *                       and the kind/target pickers are hidden. Caller
 *                       must supply `defaultTarget` when locking.
 *
 * Form steps (free mode):
 *   1. Pick target kind (radio group): Board / Column / Task / Role.
 *   2. Pick a target (cascading Comboboxes depending on kind).
 *   3. Pick a prompt (Combobox from usePrompts()).
 *
 * Locked mode (ctq-89): only step 3 is rendered — `defaultTarget` is
 * shown as a read-only summary line so the user knows what they're
 * attaching to.
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

// ─── Public types ────────────────────────────────────────────────────────────

/**
 * Discriminated union describing what a prompt is being attached to.
 * `kind` selects the join-table; `id` is the entity primary key on the
 * matching domain table (board / column / task / role).
 */
export type AttachTarget =
  | { kind: "board"; id: string }
  | { kind: "column"; id: string }
  | { kind: "task"; id: string }
  | { kind: "role"; id: string };

export interface AttachPromptDialogProps {
  isOpen: boolean;
  onClose: () => void;
  onAttached?: () => void;
  /** Pre-fills the target. In free mode the form is editable; in
   *  locked mode (`lockedTarget=true`) this is the only target. */
  defaultTarget?: AttachTarget;
  /** When `true`, the kind + target pickers are hidden. The dialog
   *  uses `defaultTarget` directly for the attach mutation. The caller
   *  is responsible for supplying `defaultTarget` when locking. */
  lockedTarget?: boolean;
}

// ─── Target-kind discriminant ─────────────────────────────────────────────────

type TargetKind = AttachTarget["kind"];

const TARGET_KINDS: { value: TargetKind; label: string }[] = [
  { value: "board", label: "Board" },
  { value: "column", label: "Column" },
  { value: "task", label: "Task" },
  { value: "role", label: "Role" },
];

const TARGET_KIND_LABEL: Record<TargetKind, string> = {
  board: "Board",
  column: "Column",
  task: "Task",
  role: "Role",
};

// ─── Shell ───────────────────────────────────────────────────────────────────

/**
 * `AttachPromptDialog` — controlled Dialog shell.
 * RAC unmounts content after the close animation, so hook state resets once
 * the dialog is fully closed without collapsing the panel during exit.
 */
export function AttachPromptDialog({
  isOpen,
  onClose,
  onAttached,
  defaultTarget,
  lockedTarget = false,
}: AttachPromptDialogProps): ReactElement {
  return (
    <Dialog
      title="Attach prompt"
      isOpen={isOpen}
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
      isDismissable
      className={styles.dialogBody}
      data-testid="attach-prompt-dialog"
    >
      {() => (
        <AttachPromptDialogContent
          onClose={onClose}
          {...(onAttached !== undefined ? { onAttached } : {})}
          {...(defaultTarget !== undefined ? { defaultTarget } : {})}
          lockedTarget={lockedTarget}
        />
      )}
    </Dialog>
  );
}

// ─── Content ─────────────────────────────────────────────────────────────────

interface AttachPromptDialogContentProps {
  onClose: () => void;
  onAttached?: () => void;
  defaultTarget?: AttachTarget;
  lockedTarget: boolean;
}

function AttachPromptDialogContent({
  onClose,
  onAttached,
  defaultTarget,
  lockedTarget,
}: AttachPromptDialogContentProps): ReactElement {
  const { pushToast } = useToast();

  // When locked, the form's `kind` is fixed to the locked target's kind.
  // Otherwise it starts at `defaultTarget?.kind` (if any) or "board".
  const [kind, setKind] = useState<TargetKind>(
    defaultTarget?.kind ?? "board",
  );

  // Cascade board → column / task. In locked mode none of these are
  // user-editable, but we still seed `selectedTargetId` so the submit
  // path can dispatch the right mutation without branching on locked.
  const [selectedBoardId, setSelectedBoardId] = useState<string>(
    defaultTarget?.kind === "board" ? defaultTarget.id : "",
  );
  const [selectedTargetId, setSelectedTargetId] = useState<string>(
    defaultTarget !== undefined && defaultTarget.kind !== "board"
      ? defaultTarget.id
      : "",
  );
  const [selectedPromptId, setSelectedPromptId] = useState<string>("");

  const [saveError, setSaveError] = useState<string | null>(null);

  // Mutations
  const addBoardPrompt = useAddBoardPromptMutation();
  const addColumnPrompt = useAddColumnPromptMutation();
  const addTaskPrompt = useAddTaskPromptMutation();
  const addRolePrompt = useAddRolePromptMutation();

  // Data queries — skipped in locked mode so we don't hit the IPC for
  // pickers we never render.
  const boardsQuery = useBoards();
  const columnsQuery = useColumns(
    !lockedTarget && kind === "column" ? selectedBoardId : "",
  );
  const tasksQuery = useTasksByBoard(
    !lockedTarget && kind === "task" ? selectedBoardId : "",
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
  const targetId = kind === "board" ? selectedBoardId : selectedTargetId;

  const isPending =
    addBoardPrompt.status === "pending" ||
    addColumnPrompt.status === "pending" ||
    addTaskPrompt.status === "pending" ||
    addRolePrompt.status === "pending";

  // In locked mode the target is guaranteed populated from props, so
  // submission only waits on the prompt selection.
  const canSubmit =
    selectedPromptId.length > 0 &&
    targetId.length > 0 &&
    (lockedTarget ? true : needsBoardFirst ? selectedBoardId.length > 0 : true);

  // ── Submit ─────────────────────────────────────────────────────────

  const handleSave = (): void => {
    setSaveError(null);
    if (!canSubmit) return;

    const position = 0;

    const opts = {
      onSuccess: () => {
        pushToast("success", "Prompt attached");
        onAttached?.();
        onClose();
      },
      onError: (err: Error) => {
        pushToast("error", `Failed to attach prompt: ${err.message}`);
        setSaveError(`Failed to attach: ${err.message}`);
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
      {/* Step 1+2 collapsed into a read-only summary in locked mode. */}
      {lockedTarget && defaultTarget !== undefined ? (
        <div
          className={styles.section}
          data-testid="attach-prompt-dialog-locked-target"
        >
          <p className={styles.sectionLabel}>Target</p>
          <p className={styles.lockedTarget}>
            {TARGET_KIND_LABEL[defaultTarget.kind]}
          </p>
        </div>
      ) : (
        <>
          {/* Step 1 — target kind */}
          <div className={styles.section}>
            <p className={styles.sectionLabel}>Target kind</p>
            <div
              className={styles.kindGroup}
              role="radiogroup"
              aria-label="Target kind"
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
            <p className={styles.sectionLabel}>Target</p>

            {/* Board picker — shown for all kinds that need a board */}
            {kind === "board" && (
              <Combobox
                label="Board"
                items={boardItems}
                placeholder="Select a board…"
                emptyState="No boards available"
                className={styles.combobox}
                onSelectionChange={handleBoardSelect}
                selectedKey={selectedBoardId !== "" ? selectedBoardId : null}
              />
            )}

            {/* Column: first board, then column */}
            {kind === "column" && (
              <>
                <Combobox
                  label="Board"
                  items={boardItems}
                  placeholder="Select a board first…"
                  emptyState="No boards available"
                  className={styles.combobox}
                  onSelectionChange={handleBoardSelect}
                  selectedKey={selectedBoardId !== "" ? selectedBoardId : null}
                />
                <Combobox
                  label="Column"
                  items={columnItems}
                  placeholder={
                    selectedBoardId !== ""
                      ? "Select a column…"
                      : "Select a board first"
                  }
                  emptyState="No columns on this board"
                  className={styles.combobox}
                  isDisabled={selectedBoardId === ""}
                  onSelectionChange={handleTargetSelect}
                  selectedKey={
                    selectedTargetId !== "" ? selectedTargetId : null
                  }
                />
              </>
            )}

            {/* Task: first board, then task */}
            {kind === "task" && (
              <>
                <Combobox
                  label="Board"
                  items={boardItems}
                  placeholder="Select a board first…"
                  emptyState="No boards available"
                  className={styles.combobox}
                  onSelectionChange={handleBoardSelect}
                  selectedKey={selectedBoardId !== "" ? selectedBoardId : null}
                />
                <Combobox
                  label="Task"
                  items={taskItems}
                  placeholder={
                    selectedBoardId !== ""
                      ? "Select a task…"
                      : "Select a board first"
                  }
                  emptyState="No tasks on this board"
                  className={styles.combobox}
                  isDisabled={selectedBoardId === ""}
                  onSelectionChange={handleTargetSelect}
                  selectedKey={
                    selectedTargetId !== "" ? selectedTargetId : null
                  }
                />
              </>
            )}

            {/* Role picker */}
            {kind === "role" && (
              <Combobox
                label="Role"
                items={roleItems}
                placeholder="Select a role…"
                emptyState="No roles available"
                className={styles.combobox}
                onSelectionChange={handleTargetSelect}
                selectedKey={selectedTargetId !== "" ? selectedTargetId : null}
              />
            )}
          </div>
        </>
      )}

      {/* Step 3 — prompt selection */}
      <div className={styles.section}>
        <Combobox
          label="Prompt"
          items={promptItems}
          placeholder="Select a prompt…"
          emptyState="No prompts available"
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
          Cancel
        </Button>
        <Button
          variant="primary"
          size="md"
          isPending={isPending}
          isDisabled={!canSubmit}
          onPress={handleSave}
          data-testid="attach-prompt-dialog-save"
        >
          Attach
        </Button>
      </div>
    </>
  );
}
