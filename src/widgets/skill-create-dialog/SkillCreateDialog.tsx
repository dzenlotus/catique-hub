/**
 * SkillCreateDialog — modal for creating a new skill.
 *
 * Props:
 *   - `isOpen`    — controls dialog visibility.
 *   - `onClose`   — called on Cancel, successful Save, or Esc.
 *   - `onCreated` — optional callback with the newly-created Skill.
 *
 * Fields: name (required), description (optional, single-line).
 *
 * Round-21 (maintainer feedback): the IconColorPicker affordance was
 * removed — Skill has no `icon` field, so the icon grid in the popover
 * was inert and the colour-only path read as confused UI.
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
  const [saveError, setSaveError] = useState<string | null>(null);

  const canSubmit = name.trim().length > 0;

  const handleSave = (): void => {
    setSaveError(null);
    const trimmedName = name.trim();
    if (!trimmedName) {
      setSaveError("Name cannot be empty.");
      return;
    }

    // `position` is required by the Rust handler (non-optional `f64`).
    // Use `Date.now()` so each new skill lands at the end of the list —
    // monotonically increasing, no list dependency, matches the
    // server-side `(position, name)` ordering.
    type MutationArgs = Parameters<typeof createMutation.mutate>[0];
    const args: MutationArgs = { name: trimmedName, position: Date.now() };
    if (description !== "") args.description = description;

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

      {/*
        SKILL-S12: attachments are intentionally NOT collected here.
        Modal-only-for-creation invariant — the create modal stays
        minimal, attachments are managed on the editor page once the
        skill row exists.
      */}
      <p
        className={styles.attachmentsHint}
        data-testid="skill-create-dialog-attachments-hint"
      >
        Files and git references can be added after creation.
      </p>

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
