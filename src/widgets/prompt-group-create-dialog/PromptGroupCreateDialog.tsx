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
      title="Create prompt group"
      isOpen={isOpen}
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
      isDismissable
      className={styles.dialogBody}
      data-testid="prompt-group-create-dialog"
    >
      {() => (
        <PromptGroupCreateDialogContent
          onClose={onClose}
          {...(onCreated !== undefined ? { onCreated } : {})}
        />
      )}
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
      setSaveError("Name cannot be empty.");
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
        setSaveError(`Failed to create: ${err.message}`);
      },
    });
  };

  const handleCancel = (): void => {
    onClose();
  };

  return (
    <>
      {/*
       * audit-D: identity picker (color) renders on the LEFT of the
       * name field in a horizontal row. Compact ~64-72 px square so
       * the name column flexes to fill remaining width. Reset hangs
       * below the color square inside the same column to keep the
       * picker self-contained.
       */}
      <div
        className={styles.identityRow}
        data-testid="prompt-group-create-dialog-identity-row"
      >
        <div className={styles.identityPicker}>
          <input
            type="color"
            className={styles.colorInput}
            value={color === "" ? "#000000" : color}
            onChange={(e) => setColor(e.target.value)}
            aria-label="Group color"
            data-testid="prompt-group-create-dialog-color-input"
          />
          {color !== "" && (
            <Button
              variant="ghost"
              size="sm"
              onPress={() => setColor("")}
              data-testid="prompt-group-create-dialog-color-reset"
            >
              Reset
            </Button>
          )}
        </div>
        <div className={styles.identityFields}>
          <Input
            label="Name"
            value={name}
            onChange={setName}
            placeholder="Group name"
            autoFocus
            className={styles.fullWidthInput}
            data-testid="prompt-group-create-dialog-name-input"
          />
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
          Cancel
        </Button>
        <Button
          variant="primary"
          size="md"
          isPending={createMutation.status === "pending"}
          isDisabled={!canSubmit}
          onPress={handleSave}
          data-testid="prompt-group-create-dialog-save"
        >
          Create
        </Button>
      </div>
    </>
  );
}
