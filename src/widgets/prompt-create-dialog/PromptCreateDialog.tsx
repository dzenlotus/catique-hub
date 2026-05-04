/**
 * PromptCreateDialog — modal for creating a new prompt.
 *
 * Props:
 *   - `isOpen`     — controls dialog visibility.
 *   - `onClose`    — called on Cancel, successful Save, or Esc.
 *   - `onCreated`  — optional callback with the newly-created Prompt.
 *
 * Optional fields (color, shortDescription) are omitted from the payload
 * when empty — never sent as empty strings. Matches `CreatePromptArgs`.
 */

import { useState, type ReactElement } from "react";

import { useCreatePromptMutation } from "@entities/prompt";
import type { Prompt } from "@entities/prompt";
import { Dialog, Button, Input, IconPicker } from "@shared/ui";

import styles from "./PromptCreateDialog.module.css";

export interface PromptCreateDialogProps {
  isOpen: boolean;
  onClose: () => void;
  onCreated?: (prompt: Prompt) => void;
}

/**
 * `PromptCreateDialog` — modal dialog for creating a new prompt.
 */
export function PromptCreateDialog({
  isOpen,
  onClose,
  onCreated,
}: PromptCreateDialogProps): ReactElement {
  return (
    <Dialog
      title="Create prompt"
      isOpen={isOpen}
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
      isDismissable
      className={styles.dialogBody}
      data-testid="prompt-create-dialog"
    >
      {() => (
        <PromptCreateDialogContent
          onClose={onClose}
          {...(onCreated !== undefined ? { onCreated } : {})}
        />
      )}
    </Dialog>
  );
}

// ─────────────────────────────────────────────────────────────────────────────

interface PromptCreateDialogContentProps {
  onClose: () => void;
  onCreated?: (prompt: Prompt) => void;
}

function PromptCreateDialogContent({
  onClose,
  onCreated,
}: PromptCreateDialogContentProps): ReactElement {
  const createMutation = useCreatePromptMutation();

  const [name, setName] = useState("");
  const [content, setContent] = useState("");
  const [shortDescription, setShortDescription] = useState("");
  const [color, setColor] = useState("");
  const [icon, setIcon] = useState<string | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);

  const canSubmit = name.trim().length > 0 && content.trim().length > 0;

  const handleSave = (): void => {
    setSaveError(null);
    const trimmedName = name.trim();
    const trimmedContent = content.trim();
    if (!trimmedName) {
      setSaveError("Name cannot be empty.");
      return;
    }
    if (!trimmedContent) {
      setSaveError("Content cannot be empty.");
      return;
    }

    // Build payload — omit optional fields when empty.
    type MutationArgs = Parameters<typeof createMutation.mutate>[0];
    const args: MutationArgs = { name: trimmedName, content: trimmedContent };
    const trimmedShortDesc = shortDescription.trim();
    if (trimmedShortDesc !== "") args.shortDescription = trimmedShortDesc;
    if (color !== "") args.color = color;
    if (icon !== null) args.icon = icon;

    createMutation.mutate(args, {
      onSuccess: (prompt) => {
        onCreated?.(prompt);
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
      {/* Name */}
      <div className={styles.section}>
        <Input
          label="Name"
          value={name}
          onChange={setName}
          placeholder="Prompt name"
          autoFocus
          className={styles.fullWidthInput}
          data-testid="prompt-create-dialog-name-input"
        />
      </div>

      {/* Short description */}
      <div className={styles.section}>
        <Input
          label="Short description"
          value={shortDescription}
          onChange={setShortDescription}
          placeholder="Optional short description…"
          className={styles.fullWidthInput}
          data-testid="prompt-create-dialog-shortdesc-input"
        />
      </div>

      {/* Icon */}
      <div className={styles.section}>
        <p className={styles.sectionLabel}>Icon</p>
        <IconPicker
          value={icon}
          onChange={setIcon}
          ariaLabel="Prompt icon"
          data-testid="prompt-create-dialog-icon-picker"
        />
      </div>

      {/* Color */}
      <div className={styles.section}>
        <p className={styles.sectionLabel}>Color</p>
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
            aria-label="Prompt color"
            data-testid="prompt-create-dialog-color-input"
          />
          {color !== "" && (
            <Button
              variant="ghost"
              size="sm"
              onPress={() => setColor("")}
              data-testid="prompt-create-dialog-color-reset"
            >
              Reset
            </Button>
          )}
        </div>
      </div>

      {/* Content */}
      <div className={styles.section}>
        <p className={styles.sectionLabel}>Content</p>
        <textarea
          className={styles.contentTextarea}
          value={content}
          onChange={(e) => setContent(e.target.value)}
          placeholder="Prompt content (Markdown)…"
          data-testid="prompt-create-dialog-content-textarea"
          aria-label="Content"
        />
      </div>

      {/* Footer */}
      <div className={styles.footer}>
        {saveError ? (
          <p
            className={styles.saveError}
            role="alert"
            data-testid="prompt-create-dialog-error"
          >
            {saveError}
          </p>
        ) : null}
        <Button
          variant="ghost"
          size="md"
          onPress={handleCancel}
          data-testid="prompt-create-dialog-cancel"
        >
          Cancel
        </Button>
        <Button
          variant="primary"
          size="md"
          isPending={createMutation.status === "pending"}
          isDisabled={!canSubmit}
          onPress={handleSave}
          data-testid="prompt-create-dialog-save"
        >
          Create
        </Button>
      </div>
    </>
  );
}
