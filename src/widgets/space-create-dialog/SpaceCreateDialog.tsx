/**
 * SpaceCreateDialog — modal for creating a new space.
 *
 * Props:
 *   - `isOpen`     — controls dialog visibility.
 *   - `onClose`    — called on Cancel, successful Save, or Esc.
 *   - `onCreated`  — optional callback with the newly-created Space.
 *
 * Required fields: name, prefix. Optional: description.
 * Optional fields are omitted from the payload when empty — never sent as
 * empty strings. Matches `CreateSpaceArgs`.
 *
 * On success: closes the dialog, calls `onCreated`, and sets the new space
 * as the active space via `useActiveSpace()` context.
 */

import { useState, type ReactElement } from "react";

import { useCreateSpaceMutation, validatePrefix } from "@entities/space";
import type { Space } from "@entities/space";
import { useActiveSpace } from "@app/providers/ActiveSpaceProvider";
import { Dialog, Button, Input } from "@shared/ui";

import styles from "./SpaceCreateDialog.module.css";

export interface SpaceCreateDialogProps {
  isOpen: boolean;
  onClose: () => void;
  onCreated?: (space: Space) => void;
}

/**
 * `SpaceCreateDialog` — modal dialog for creating a new space.
 */
export function SpaceCreateDialog({
  isOpen,
  onClose,
  onCreated,
}: SpaceCreateDialogProps): ReactElement {
  return (
    <Dialog
      title="Создать пространство"
      isOpen={isOpen}
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
      isDismissable
      className={styles.dialogBody}
      data-testid="space-create-dialog"
    >
      {() => (
        <SpaceCreateDialogContent
          onClose={onClose}
          {...(onCreated !== undefined ? { onCreated } : {})}
        />
      )}
    </Dialog>
  );
}

// ─────────────────────────────────────────────────────────────────────────────

interface SpaceCreateDialogContentProps {
  onClose: () => void;
  onCreated?: (space: Space) => void;
}

function SpaceCreateDialogContent({
  onClose,
  onCreated,
}: SpaceCreateDialogContentProps): ReactElement {
  const createMutation = useCreateSpaceMutation();
  const { setActiveSpaceId } = useActiveSpace();

  const [name, setName] = useState("");
  const [prefix, setPrefix] = useState("");
  const [description, setDescription] = useState("");
  const [prefixError, setPrefixError] = useState<string | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);

  const handlePrefixChange = (value: string): void => {
    setPrefix(value);
    // Validate on every keystroke so the hint appears immediately.
    setPrefixError(validatePrefix(value));
  };

  const canSubmit =
    name.trim().length > 0 &&
    prefix.trim().length > 0 &&
    validatePrefix(prefix.trim()) === null;

  const handleSave = (): void => {
    setSaveError(null);
    const trimmedName = name.trim();
    const trimmedPrefix = prefix.trim();

    if (!trimmedName) {
      setSaveError("Название не может быть пустым.");
      return;
    }

    const prefixValidation = validatePrefix(trimmedPrefix);
    if (prefixValidation !== null) {
      setPrefixError(prefixValidation);
      return;
    }

    type MutationArgs = Parameters<typeof createMutation.mutate>[0];
    const args: MutationArgs = { name: trimmedName, prefix: trimmedPrefix };
    const trimmedDesc = description.trim();
    if (trimmedDesc !== "") args.description = trimmedDesc;

    createMutation.mutate(args, {
      onSuccess: (space) => {
        setActiveSpaceId(space.id);
        onCreated?.(space);
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
          placeholder="Название пространства"
          autoFocus
          className={styles.fullWidthInput}
          data-testid="space-create-dialog-name-input"
        />
      </div>

      {/* Prefix */}
      <div className={styles.section}>
        <Input
          label="Префикс"
          value={prefix}
          onChange={handlePrefixChange}
          placeholder="например, dev"
          className={styles.fullWidthInput}
          data-testid="space-create-dialog-prefix-input"
        />
        {prefixError !== null && prefix.length > 0 ? (
          <p
            className={styles.fieldError}
            role="alert"
            data-testid="space-create-dialog-prefix-error"
          >
            {prefixError}
          </p>
        ) : null}
      </div>

      {/* Description (optional) */}
      <div className={styles.section}>
        <Input
          label="Описание"
          value={description}
          onChange={setDescription}
          placeholder="Необязательное описание..."
          className={styles.fullWidthInput}
          data-testid="space-create-dialog-description-input"
        />
      </div>

      {/* Footer */}
      <div className={styles.footer}>
        {saveError ? (
          <p
            className={styles.saveError}
            role="alert"
            data-testid="space-create-dialog-error"
          >
            {saveError}
          </p>
        ) : null}
        <Button
          variant="ghost"
          size="md"
          onPress={handleCancel}
          data-testid="space-create-dialog-cancel"
        >
          Отмена
        </Button>
        <Button
          variant="primary"
          size="md"
          isPending={createMutation.status === "pending"}
          isDisabled={!canSubmit}
          onPress={handleSave}
          data-testid="space-create-dialog-save"
        >
          Создать
        </Button>
      </div>
    </>
  );
}
