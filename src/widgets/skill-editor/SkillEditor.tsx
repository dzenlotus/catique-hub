/**
 * SkillEditor — skill detail / edit modal.
 *
 * Props:
 *   - `skillId` — null → dialog closed; string → dialog open for that skill.
 *   - `onClose`  — called on Cancel, successful Save, or Esc (via RAC).
 */

import { useEffect, useState, type ReactElement } from "react";
import { useSkill, useUpdateSkillMutation } from "@entities/skill";
import { Dialog, Button, Input } from "@shared/ui";
import { cn } from "@shared/lib";

import styles from "./SkillEditor.module.css";

export interface SkillEditorProps {
  /** null = closed, string = open for this skill id */
  skillId: string | null;
  /** Called on cancel, successful save, or Esc. */
  onClose: () => void;
}

/**
 * `SkillEditor` — modal for viewing and editing a skill's name, description and color.
 *
 * Delegates open/close tracking to `skillId` — when null the `<Dialog>`
 * `isOpen` prop is false, so RAC handles exit animations and focus restoration.
 */
export function SkillEditor({ skillId, onClose }: SkillEditorProps): ReactElement {
  const isOpen = skillId !== null;

  return (
    <Dialog
      title="Skill"
      isOpen={isOpen}
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
      isDismissable
      className={styles.body}
      data-testid="skill-editor"
    >
      {() =>
        skillId !== null ? (
          <SkillEditorContent skillId={skillId} onClose={onClose} />
        ) : null
      }
    </Dialog>
  );
}

// ─────────────────────────────────────────────────────────────────────────────

/**
 * `SkillEditorPanel` — non-modal version mounted inline on the
 * `/skills/:skillId` route per audit-#9.
 */
export function SkillEditorPanel({
  skillId,
  onClose,
}: { skillId: string; onClose: () => void }): ReactElement {
  return (
    <div className={styles.panel} data-testid="skill-editor-panel">
      <SkillEditorContent skillId={skillId} onClose={onClose} />
    </div>
  );
}

interface SkillEditorContentProps {
  skillId: string;
  onClose: () => void;
}

export function SkillEditorContent({
  skillId,
  onClose,
}: SkillEditorContentProps): ReactElement {
  const query = useSkill(skillId);
  const updateMutation = useUpdateSkillMutation();

  // Local edit state — initialised from the loaded skill.
  const [localName, setLocalName] = useState("");
  const [localColor, setLocalColor] = useState("");
  const [localDescription, setLocalDescription] = useState("");
  const [saveError, setSaveError] = useState<string | null>(null);

  // Sync local state when skill data loads or skillId changes.
  useEffect(() => {
    if (query.data) {
      setLocalName(query.data.name);
      setLocalColor(query.data.color ?? "");
      setLocalDescription(query.data.description ?? "");
      setSaveError(null);
    }
  }, [query.data, skillId]);

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
            data-testid="skill-editor-cancel"
          >
            Cancel
          </Button>
          <Button
            variant="primary"
            size="md"
            isDisabled
            data-testid="skill-editor-save"
          >
            Save
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
          data-testid="skill-editor-fetch-error"
        >
          <p className={styles.errorBannerMessage}>
            Failed to load skill: {query.error.message}
          </p>
          <Button
            variant="secondary"
            size="sm"
            onPress={() => void query.refetch()}
          >
            Retry
          </Button>
        </div>
        <div className={styles.footer}>
          <Button
            variant="ghost"
            size="md"
            onPress={onClose}
            data-testid="skill-editor-cancel"
          >
            Close
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
          data-testid="skill-editor-not-found"
        >
          <p className={styles.notFoundBannerMessage}>
            Skill not found.
          </p>
        </div>
        <div className={styles.footer}>
          <Button
            variant="ghost"
            size="md"
            onPress={onClose}
            data-testid="skill-editor-cancel"
          >
            Close
          </Button>
        </div>
      </>
    );
  }

  // ── Loaded ─────────────────────────────────────────────────────────

  const skill = query.data;

  const handleSave = (): void => {
    setSaveError(null);
    const trimmedName = localName.trim();
    if (!trimmedName) {
      setSaveError("Name cannot be empty.");
      return;
    }

    // Empty string → clear to null; non-empty → use value as-is.
    const resolvedColor = localColor === "" ? null : localColor;
    const resolvedDescription = localDescription.trim() === "" ? null : localDescription;

    type MutationArgs = Parameters<typeof updateMutation.mutate>[0];
    const mutationArgs: MutationArgs = { id: skill.id };

    if (trimmedName !== skill.name) {
      mutationArgs.name = trimmedName;
    }
    // For nullable description: only include when resolved value differs from stored.
    if (resolvedDescription !== skill.description) {
      mutationArgs.description = resolvedDescription;
    }
    // For nullable color: only include when the resolved value differs from stored.
    if (resolvedColor !== skill.color) {
      mutationArgs.color = resolvedColor;
    }

    updateMutation.mutate(mutationArgs, {
      onSuccess: () => {
        onClose();
      },
      onError: (err) => {
        setSaveError(`Failed to save: ${err.message}`);
      },
    });
  };

  const handleCancel = (): void => {
    // Reset local state back to skill values before closing.
    setLocalName(skill.name);
    setLocalColor(skill.color ?? "");
    setLocalDescription(skill.description ?? "");
    setSaveError(null);
    onClose();
  };

  return (
    <>
      {/* Name */}
      <div className={styles.section}>
        <Input
          label="Name"
          value={localName}
          onChange={setLocalName}
          placeholder="Skill name"
          className={styles.fullWidthInput}
          data-testid="skill-editor-name-input"
        />
      </div>

      {/* Description */}
      <div className={styles.section}>
        <Input
          label="Description"
          value={localDescription}
          onChange={setLocalDescription}
          placeholder="Short description of the skill"
          className={styles.fullWidthInput}
          data-testid="skill-editor-description-input"
        />
      </div>

      {/* Color */}
      <div className={styles.section}>
        <p className={styles.sectionLabel}>Color</p>
        <div className={styles.colorRow}>
          {localColor !== "" && (
            <span
              className={styles.colorSwatch}
              style={{ backgroundColor: localColor }}
              aria-hidden="true"
            />
          )}
          <input
            type="color"
            className={styles.colorInput}
            value={localColor === "" ? "#000000" : localColor}
            onChange={(e) => setLocalColor(e.target.value)}
            aria-label="Skill color"
            data-testid="skill-editor-color-input"
          />
          {localColor !== "" && (
            <Button
              variant="ghost"
              size="sm"
              onPress={() => setLocalColor("")}
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
            data-testid="skill-editor-save-error"
          >
            {saveError}
          </p>
        ) : null}
        <Button
          variant="ghost"
          size="md"
          onPress={handleCancel}
          data-testid="skill-editor-cancel"
        >
          Cancel
        </Button>
        <Button
          variant="primary"
          size="md"
          isPending={updateMutation.status === "pending"}
          onPress={handleSave}
          data-testid="skill-editor-save"
        >
          Save
        </Button>
      </div>
    </>
  );
}
