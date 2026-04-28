/**
 * TagCreateDialog — modal for creating a new tag.
 *
 * Props:
 *   - `isOpen`    — controls dialog visibility.
 *   - `onClose`   — called on Cancel, successful Save, or Esc.
 *   - `onCreated` — optional callback with the newly-created Tag.
 *
 * Fields: name (required), color (optional with reset).
 */

import { useState, type ReactElement } from "react";

import { useCreateTagMutation } from "@entities/tag";
import type { Tag } from "@entities/tag";
import { Dialog, Button, Input } from "@shared/ui";

import styles from "./TagCreateDialog.module.css";

export interface TagCreateDialogProps {
  isOpen: boolean;
  onClose: () => void;
  onCreated?: (tag: Tag) => void;
}

/**
 * `TagCreateDialog` — modal dialog for creating a new tag.
 */
export function TagCreateDialog({
  isOpen,
  onClose,
  onCreated,
}: TagCreateDialogProps): ReactElement {
  return (
    <Dialog
      title="Создать тег"
      isOpen={isOpen}
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
      isDismissable
      className={styles.dialogBody}
      data-testid="tag-create-dialog"
    >
      {() =>
        isOpen ? (
          <TagCreateDialogContent
            onClose={onClose}
            {...(onCreated !== undefined ? { onCreated } : {})}
          />
        ) : null
      }
    </Dialog>
  );
}

// ─────────────────────────────────────────────────────────────────────────────

interface TagCreateDialogContentProps {
  onClose: () => void;
  onCreated?: (tag: Tag) => void;
}

function TagCreateDialogContent({
  onClose,
  onCreated,
}: TagCreateDialogContentProps): ReactElement {
  const createMutation = useCreateTagMutation();

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
      onSuccess: (tag) => {
        onCreated?.(tag);
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
          placeholder="Название тега"
          autoFocus
          className={styles.fullWidthInput}
          data-testid="tag-create-dialog-name-input"
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
            aria-label="Цвет тега"
            data-testid="tag-create-dialog-color-input"
          />
          {color !== "" && (
            <Button
              variant="ghost"
              size="sm"
              onPress={() => setColor("")}
              data-testid="tag-create-dialog-color-reset"
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
            data-testid="tag-create-dialog-error"
          >
            {saveError}
          </p>
        ) : null}
        <Button
          variant="ghost"
          size="md"
          onPress={handleCancel}
          data-testid="tag-create-dialog-cancel"
        >
          Отмена
        </Button>
        <Button
          variant="primary"
          size="md"
          isPending={createMutation.status === "pending"}
          isDisabled={!canSubmit}
          onPress={handleSave}
          data-testid="tag-create-dialog-save"
        >
          Создать
        </Button>
      </div>
    </>
  );
}
