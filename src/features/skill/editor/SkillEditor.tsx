/**
 * SkillEditor — skill detail / edit modal.
 *
 * Props:
 *   - `skillId` — null → dialog closed; string → dialog open for that skill.
 *   - `onClose`  — called on Cancel, successful Save, or Esc (via RAC).
 */

import { useEffect, type ReactElement } from "react";
import { useForm, Controller } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";

import { useSkill, useUpdateSkillMutation } from "@entities/skill";
import type { Skill } from "@entities/skill";
import { Dialog, Button, EntityTitle, TextArea } from "@shared/ui";
import { cn } from "@shared/lib";

import { SkillAttachmentsSection } from "./SkillAttachmentsSection";
import { SkillStepsSection } from "./SkillStepsSection";
import { SkillImportButton } from "./SkillImportButton";
import { SkillExportButton } from "./SkillExportButton";
import styles from "./SkillEditor.module.css";

// Name is required (trimmed); overview is optional markdown ("" → null
// on update). Validation that used to live in `handleSave` now lives
// here as the single source of truth.
const skillFormSchema = z.object({
  name: z.string().trim().min(1, "Name cannot be empty."),
  overview: z.string(),
});

type SkillFormValues = z.infer<typeof skillFormSchema>;

/** Map a loaded skill into the editor's form values. */
function skillToFormValues(skill: Skill): SkillFormValues {
  return { name: skill.name, overview: skill.description ?? "" };
}

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

  const {
    control,
    handleSubmit,
    reset,
    setError,
    clearErrors,
    formState: { errors },
  } = useForm<SkillFormValues>({
    resolver: zodResolver(skillFormSchema),
    defaultValues: { name: "", overview: "" },
    mode: "onChange",
  });

  // Repopulate the form when the loaded skill changes (different skillId
  // or a fresh fetch). `reset` re-seeds values + clears dirty state.
  const skill = query.data;
  useEffect(() => {
    if (skill) {
      reset(skillToFormValues(skill));
      clearErrors("root.serverError");
    }
  }, [skill, reset, clearErrors]);

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

  // Narrowed non-null after the !query.data guard above.
  const loadedSkill = query.data;

  const onValid = handleSubmit((values) => {
    const trimmedName = values.name.trim();
    const resolvedOverview =
      values.overview.trim() === "" ? null : values.overview;

    type MutationArgs = Parameters<typeof updateMutation.mutate>[0];
    const mutationArgs: MutationArgs = { id: loadedSkill.id };
    if (trimmedName !== loadedSkill.name) mutationArgs.name = trimmedName;
    if (resolvedOverview !== loadedSkill.description) {
      mutationArgs.description = resolvedOverview;
    }

    updateMutation.mutate(mutationArgs, {
      onSuccess: () => onClose(),
      onError: (err) =>
        setError("root.serverError", {
          message: `Failed to save: ${err.message}`,
        }),
    });
  });

  const handleSavePress = (): void => {
    void onValid();
  };

  const handleCancel = (): void => {
    reset(skillToFormValues(loadedSkill));
    clearErrors("root.serverError");
    onClose();
  };

  const saveError = errors.root?.serverError?.message;

  return (
    <>
      <div className={styles.section}>
        <Controller
          control={control}
          name="name"
          render={({ field }) => (
            <EntityTitle
              size="lg"
              editable
              name={field.value}
              onNameChange={field.onChange}
              editPlaceholder="Skill name"
              editTestId="skill-editor-name-input"
            />
          )}
        />
      </div>

      <div className={styles.section}>
        <Controller
          control={control}
          name="overview"
          render={({ field }) => (
            <TextArea
              label="Overview"
              value={field.value}
              onChange={field.onChange}
              rows={4}
              placeholder="What is this skill for? When should the agent reach for it?"
              className={styles.fullWidthInput}
              data-testid="skill-editor-overview-input"
            />
          )}
        />
      </div>

      <SkillStepsSection skillId={loadedSkill.id} />

      <div className={styles.section} style={{ display: "flex", gap: 8 }}>
        <SkillImportButton skillId={loadedSkill.id} />
        <SkillExportButton skillId={loadedSkill.id} />
      </div>

      <SkillAttachmentsSection skillId={loadedSkill.id} />

      <div className={styles.footer}>
        {saveError !== undefined ? (
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
          onPress={handleSavePress}
          data-testid="skill-editor-save"
        >
          Save
        </Button>
      </div>
    </>
  );
}
