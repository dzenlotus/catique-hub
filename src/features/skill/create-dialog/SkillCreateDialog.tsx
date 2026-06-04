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

import { useCallback, type ReactElement } from "react";
import { useForm, Controller } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";

import { useCreateSkillMutation } from "@entities/skill";
import type { Skill } from "@entities/skill";
import { Dialog, Button, Input } from "@shared/ui";

import styles from "./SkillCreateDialog.module.css";

// react-hook-form schema — name required; description optional.
const skillFormSchema = z.object({
  name: z.string().trim().min(1, "Name cannot be empty."),
  description: z.string().optional(),
});

type SkillFormValues = z.infer<typeof skillFormSchema>;

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

  const {
    control,
    handleSubmit,
    setError,
    formState: { errors, isValid, isSubmitting },
  } = useForm<SkillFormValues>({
    resolver: zodResolver(skillFormSchema),
    defaultValues: { name: "", description: "" },
    mode: "onChange",
  });

  const onValid = handleSubmit(async (values) => {
    // `position` is required by the Rust handler (non-optional `f64`).
    // Use `Date.now()` so each new skill lands at the end of the list —
    // monotonically increasing, no list dependency, matches the
    // server-side `(position, name)` ordering.
    type MutationArgs = Parameters<typeof createMutation.mutateAsync>[0];
    const args: MutationArgs = { name: values.name, position: Date.now() };
    const description = values.description ?? "";
    if (description !== "") args.description = description;

    try {
      const skill = await createMutation.mutateAsync(args);
      onCreated?.(skill);
      onClose();
    } catch (err) {
      const message = err instanceof Error ? err.message : "Unknown error";
      setError("root.serverError", { message: `Failed to create: ${message}` });
    }
  });

  const handleSubmitPress = useCallback((): void => {
    void onValid();
  }, [onValid]);

  const handleCancel = useCallback((): void => {
    onClose();
  }, [onClose]);

  const serverError = errors.root?.serverError?.message;

  return (
    <>
      {/* Name */}
      <div className={styles.section}>
        <Controller
          control={control}
          name="name"
          render={({ field }) => (
            <Input
              label="Name"
              value={field.value}
              onChange={field.onChange}
              placeholder="Skill name"
              autoFocus
              className={styles.fullWidthInput}
              data-testid="skill-create-dialog-name-input"
            />
          )}
        />
      </div>

      {/* Description */}
      <div className={styles.section}>
        <Controller
          control={control}
          name="description"
          render={({ field }) => (
            <Input
              label="Description"
              value={field.value ?? ""}
              onChange={field.onChange}
              placeholder="Short description of the skill"
              className={styles.fullWidthInput}
              data-testid="skill-create-dialog-description-input"
            />
          )}
        />
      </div>

      {/*
        SKILL-V2-B: attachments, structured steps, and git imports are
        intentionally NOT collected here. Modal-only-for-creation
        invariant — the create modal stays minimal; everything else is
        managed on the editor page once the skill row exists.
      */}
      <p
        className={styles.attachmentsHint}
        data-testid="skill-create-dialog-attachments-hint"
      >
        Steps, files, and git imports can be added after creation.
      </p>

      {/* Footer */}
      <div className={styles.footer}>
        {serverError ? (
          <p
            className={styles.saveError}
            role="alert"
            data-testid="skill-create-dialog-error"
          >
            {serverError}
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
          isPending={isSubmitting}
          isDisabled={!isValid}
          onPress={handleSubmitPress}
          data-testid="skill-create-dialog-save"
        >
          Create
        </Button>
      </div>
    </>
  );
}
