/**
 * SkillCreateDialog — modal for creating a new skill.
 *
 * Props:
 *   - `isOpen`    — controls dialog visibility.
 *   - `onClose`   — called on Cancel, successful Save, or Esc.
 *   - `onCreated` — optional callback with the newly-created Skill.
 *
 * Fields: name (required), description (optional, single-line),
 * color (optional with reset).
 */

import { useState, type ReactElement } from "react";

import { useCreateSkillMutation } from "@entities/skill";
import type { Skill } from "@entities/skill";
import { Dialog, Button, Input } from "@shared/ui";

import styles from "./SkillCreateDialog.module.css";

export interface SkillCreateDialogProps {
  isOpen: boolean;
  onClose: () => void;
  onCreated?: (skill: Skill) => void;
}

/**
 * `SkillCreateDialog` — modal dialog for creating a new skill.
 */
export function SkillCreateDialog({
  isOpen,
  onClose,
  onCreated,
}: SkillCreateDialogProps): ReactElement {
  return (
    <Dialog
      title="Create skill"
      isOpen={isOpen}
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
      isDismissable
      className={styles.dialogBody}
      data-testid="skill-create-dialog"
    >
      {() => (
        <SkillCreateDialogContent
          onClose={onClose}
          {...(onCreated !== undefined ? { onCreated } : {})}
        />
      )}
    </Dialog>
  );
}

// ─────────────────────────────────────────────────────────────────────────────

interface SkillCreateDialogContentProps {
  onClose: () => void;
  onCreated?: (skill: Skill) => void;
}

function SkillCreateDialogContent({
  onClose,
  onCreated,
}: SkillCreateDialogContentProps): ReactElement {
  const createMutation = useCreateSkillMutation();

  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
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
    if (description !== "") args.description = description;
    if (color !== "") args.color = color;

    createMutation.mutate(args, {
      onSuccess: (skill) => {
        onCreated?.(skill);
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
          placeholder="Skill name"
          autoFocus
          className={styles.fullWidthInput}
          data-testid="skill-create-dialog-name-input"
        />
      </div>

      {/* Description */}
      <div className={styles.section}>
        <Input
          label="Description"
          value={description}
          onChange={setDescription}
          placeholder="Short description of the skill"
          className={styles.fullWidthInput}
          data-testid="skill-create-dialog-description-input"
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
            aria-label="Skill color"
            data-testid="skill-create-dialog-color-input"
          />
          {color !== "" && (
            <Button
              variant="ghost"
              size="sm"
              onPress={() => setColor("")}
              data-testid="skill-create-dialog-color-reset"
            >
              Reset
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
            data-testid="skill-create-dialog-error"
          >
            {saveError}
          </p>
        ) : null}
        <Button
          variant="ghost"
          size="md"
          onPress={handleCancel}
          data-testid="skill-create-dialog-cancel"
        >
          Cancel
        </Button>
        <Button
          variant="primary"
          size="md"
          isPending={createMutation.status === "pending"}
          isDisabled={!canSubmit}
          onPress={handleSave}
          data-testid="skill-create-dialog-save"
        >
          Create
        </Button>
      </div>
    </>
  );
}
