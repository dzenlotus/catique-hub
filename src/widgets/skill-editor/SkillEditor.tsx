/**
 * SkillEditor — skill detail / edit modal.
 *
 * Props:
 *   - `skillId` — null → dialog closed; string → dialog open for that skill.
 *   - `onClose`  — called on Cancel, successful Save, or Esc (via RAC).
 */

import { useEffect, useState, type ReactElement } from "react";
import { useSkill, useUpdateSkillMutation } from "@entities/skill";
import { Dialog, Button, Input, TextArea } from "@shared/ui";
import { cn } from "@shared/lib";

import { SkillAttachmentsSection } from "./SkillAttachmentsSection";
import { SkillStepsSection } from "./SkillStepsSection";
import { SkillImportButton } from "./SkillImportButton";
import styles from "./SkillEditor.module.css";

export interface SkillEditorProps {
  /** null = closed, string = open for this skill id */
  skillId: string | null;
  /** Called on cancel, successful save, or Esc. */
  onClose: () => void;
}

/**
 * `SkillEditor` — modal for viewing and editing a skill's name and
 * overview. SKILL-V2-B: the formerly-single-blob "description" is
 * relabelled "Overview" and rendered as a multi-line markdown
 * textarea; the structured steps live in the dedicated
 * `<SkillStepsSection>`.
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
  const [localOverview, setLocalOverview] = useState("");
  const [saveError, setSaveError] = useState<string | null>(null);

  // Sync local state when skill data loads or skillId changes.
  useEffect(() => {
    if (query.data) {
      setLocalName(query.data.name);
      setLocalOverview(query.data.description ?? "");
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
          <Button variant="ghost" size="md" isDisabled data-testid="skill-editor-cancel">
            Cancel
          </Button>
          <Button variant="primary" size="md" isDisabled data-testid="skill-editor-save">
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
          <p className={styles.notFoundBannerMessage}>Skill not found.</p>
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
    const resolvedOverview =
      localOverview.trim() === "" ? null : localOverview;

    type MutationArgs = Parameters<typeof updateMutation.mutate>[0];
    const mutationArgs: MutationArgs = { id: skill.id };
    if (trimmedName !== skill.name) mutationArgs.name = trimmedName;
    if (resolvedOverview !== skill.description) {
      mutationArgs.description = resolvedOverview;
    }

    updateMutation.mutate(mutationArgs, {
      onSuccess: () => onClose(),
      onError: (err) => setSaveError(`Failed to save: ${err.message}`),
    });
  };

  const handleCancel = (): void => {
    setLocalName(skill.name);
    setLocalOverview(skill.description ?? "");
    setSaveError(null);
    onClose();
  };

  return (
    <>
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

      <div className={styles.section}>
        <TextArea
          label="Overview"
          value={localOverview}
          onChange={setLocalOverview}
          rows={4}
          placeholder="What is this skill for? When should the agent reach for it?"
          className={styles.fullWidthInput}
          data-testid="skill-editor-overview-input"
        />
      </div>

      <SkillStepsSection skillId={skill.id} />

      <div className={styles.section}>
        <SkillImportButton skillId={skill.id} />
      </div>

      <SkillAttachmentsSection skillId={skill.id} />

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
