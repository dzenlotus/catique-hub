/**
 * SkillStepForm — inline form for adding/editing a single skill step.
 *
 * Used by `SkillStepsSection` (add flow) and `SkillStepCard` (edit
 * flow). Fully controlled by the caller — the form owns its own draft
 * state internally (via react-hook-form) but commits via `onSubmit`.
 *
 * Fields:
 *   - Title (single-line, required)
 *   - Body (multi-line markdown, required)
 *   - Expected outcome (multi-line, optional → `null` when blank)
 */

import { useCallback, type ReactElement } from "react";
import { useForm, Controller } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";

import { Button, Input, TextArea } from "@shared/ui";

import styles from "./SkillStepsSection.module.css";

export interface SkillStepFormValue {
  title: string;
  body: string;
  /** `null` = field cleared, `string` = present, never `undefined`. */
  expectedOutcome: string | null;
}

export interface SkillStepFormProps {
  /** Initial values. Undefined fields default to empty strings. */
  initial?: Partial<SkillStepFormValue>;
  /** Pending state from the parent's mutation. */
  isPending: boolean;
  /** Submit label — "Add step" / "Save". */
  submitLabel: string;
  /** Test-id prefix for the form root + buttons. */
  testIdPrefix: string;
  onCancel: () => void;
  onSubmit: (value: SkillStepFormValue) => void;
}

// Title is required (trimmed); body trim isn't enforced (an empty body
// is still a valid step skeleton — body fills in over time and the user
// may want to commit the title first). Expected outcome is optional.
const skillStepFormSchema = z.object({
  title: z.string().trim().min(1, "Title is required."),
  body: z.string(),
  expectedOutcome: z.string(),
});

type SkillStepFormShape = z.infer<typeof skillStepFormSchema>;

/**
 * `SkillStepForm` — title + body + optional expected-outcome form.
 */
export function SkillStepForm({
  initial,
  isPending,
  submitLabel,
  testIdPrefix,
  onCancel,
  onSubmit,
}: SkillStepFormProps): ReactElement {
  const {
    control,
    handleSubmit,
    formState: { errors },
  } = useForm<SkillStepFormShape>({
    resolver: zodResolver(skillStepFormSchema),
    defaultValues: {
      title: initial?.title ?? "",
      body: initial?.body ?? "",
      expectedOutcome: initial?.expectedOutcome ?? "",
    },
    mode: "onChange",
  });

  const onValid = handleSubmit((values) => {
    const trimmedOutcome = values.expectedOutcome.trim();
    onSubmit({
      title: values.title.trim(),
      body: values.body,
      expectedOutcome: trimmedOutcome === "" ? null : values.expectedOutcome,
    });
  });

  const handleSubmitPress = useCallback((): void => {
    void onValid();
  }, [onValid]);

  return (
    <div
      className={styles.form}
      data-testid={`${testIdPrefix}-form`}
    >
      <Controller
        control={control}
        name="title"
        render={({ field }) => (
          <Input
            label="Title"
            value={field.value}
            onChange={field.onChange}
            placeholder="What does this step do?"
            className={styles.fullWidth}
            data-testid={`${testIdPrefix}-form-title-input`}
          />
        )}
      />
      <Controller
        control={control}
        name="body"
        render={({ field }) => (
          <TextArea
            label="Body (markdown)"
            value={field.value}
            onChange={field.onChange}
            rows={4}
            placeholder="Instructions for the agent — commands, expectations, edge cases."
            className={styles.fullWidth}
            data-testid={`${testIdPrefix}-form-body-input`}
          />
        )}
      />
      <Controller
        control={control}
        name="expectedOutcome"
        render={({ field }) => (
          <TextArea
            label="Expected outcome (optional)"
            value={field.value}
            onChange={field.onChange}
            rows={2}
            placeholder="What does success look like for this step?"
            className={styles.fullWidth}
            data-testid={`${testIdPrefix}-form-outcome-input`}
          />
        )}
      />
      {errors.title?.message !== undefined ? (
        <p
          className={styles.formError}
          role="alert"
          data-testid={`${testIdPrefix}-form-error`}
        >
          {errors.title.message}
        </p>
      ) : null}
      <div className={styles.formActions}>
        <Button
          variant="ghost"
          size="sm"
          onPress={onCancel}
          data-testid={`${testIdPrefix}-form-cancel`}
        >
          Cancel
        </Button>
        <Button
          variant="primary"
          size="sm"
          isPending={isPending}
          onPress={handleSubmitPress}
          data-testid={`${testIdPrefix}-form-submit`}
        >
          {submitLabel}
        </Button>
      </div>
    </div>
  );
}
