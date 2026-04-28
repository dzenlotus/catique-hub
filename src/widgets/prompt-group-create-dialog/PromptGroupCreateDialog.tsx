/**
 * PromptGroupCreateDialog — modal for creating a new prompt group.
 *
 * Props:
 *   - `isOpen`    — controls dialog visibility.
 *   - `onClose`   — called on Cancel, successful Save, or Esc.
 *   - `onCreated` — optional callback with the newly-created PromptGroup.
 *
 * Fields: name (required), color (optional with reset).
 */

import { useState, type ReactElement } from "react";

import { useCreatePromptGroupMutation } from "@entities/prompt-group";
import type { PromptGroup } from "@entities/prompt-group";
import { Dialog, Button, Input } from "@shared/ui";

import styles from "./PromptGroupCreateDialog.module.css";

export interface PromptGroupCreateDialogProps {
  isOpen: boolean;
  onClose: () => void;
  onCreated?: (group: PromptGroup) => void;
}

/**
 * `PromptGroupCreateDialog` — modal dialog for creating a new prompt group.
 */
export function PromptGroupCreateDialog({
  isOpen,
  onClose,
  onCreated,
}: PromptGroupCreateDialogProps): ReactElement {
  return (
    <Dialog
      title="Создать группу промптов"
      isOpen={isOpen}
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
      isDismissable
      className={styles.dialogBody}
      data-testid="prompt-group-create-dialog"
    >
      {() =>
        isOpen ? (
          <PromptGroupCreateDialogContent
            onClose={onClose}
            {...(onCreated !== undefined ? { onCreated } : {})}
          />
        ) : null
      }
    </Dialog>
  );
}

// ─────────────────────────────────────────────────────────────────────────────

interface PromptGroupCreateDialogContentProps {
  onClose: () => void;
  onCreated?: (group: PromptGroup) => void;
}

function PromptGroupCreateDialogContent({
  onClose,
  onCreated,
}: PromptGroupCreateDialogContentProps): ReactElement {
  const createMutation = useCreatePromptGroupMutation();

  const [name, setName] = useState("");
  const [color, setColor] = useState("");
  const [saveError, setSaveError] = useState<string | null>(null);

  const canSubmit = name.trim().length > 0;

  const handleSave = (): void => {
    setSaveError(null);
    const trimmedName = name.trim();
    if (!trimmedName) {
      setSaveError("Название не может быть пустым.");
      return;
    }

    type MutationArgs = Parameters<typeof createMutation.mutate>[0];
    const args: MutationArgs = { name: trimmedName };
    if (color !== "") args.color = color;

    createMutation.mutate(args, {
      onSuccess: (group) => {
        onCreated?.(group);
        onClose();
      },
      onError: (err) => {
        setSaveError(`Не удалось создать: ${err.message}`);
      },
    });
  };

  const handleCancel = (): void => {
    onClose();
  };

  return (
    <>
      {/* Name */}
      <div className={styles.section}>
        <Input
          label="Название"
          value={name}
          onChange={setName}
          placeholder="Название группы"
          autoFocus
          className={styles.fullWidthInput}
          data-testid="prompt-group-create-dialog-name-input"
        />
      </div>

      {/* Color */}
      <div className={styles.section}>
        <p className={styles.sectionLabel}>Цвет</p>
        <div className={styles.colorRow}>
          {color !== "" && (
            <span
              className={styles.colorSwatch}
              style={{ backgroundColor: color }}
              aria-hidden="true"
            />
          )}
          <input
            type="color"
            className={styles.colorInput}
            value={color === "" ? "#000000" : color}
            onChange={(e) => setColor(e.target.value)}
            aria-label="Цвет группы"
            data-testid="prompt-group-create-dialog-color-input"
          />
          {color !== "" && (
            <Button
              variant="ghost"
              size="sm"
              onPress={() => setColor("")}
              data-testid="prompt-group-create-dialog-color-reset"
            >
              Сбросить
            </Button>
          )}
        </div>
      </div>

      {/* Footer */}
      <div className={styles.footer}>
        {saveError ? (
          <p
            className={styles.saveError}
            role="alert"
            data-testid="prompt-group-create-dialog-error"
          >
            {saveError}
          </p>
        ) : null}
        <Button
          variant="ghost"
          size="md"
          onPress={handleCancel}
          data-testid="prompt-group-create-dialog-cancel"
        >
          Отмена
        </Button>
        <Button
          variant="primary"
          size="md"
          isPending={createMutation.status === "pending"}
          isDisabled={!canSubmit}
          onPress={handleSave}
          data-testid="prompt-group-create-dialog-save"
        >
          Создать
        </Button>
      </div>
    </>
  );
}
