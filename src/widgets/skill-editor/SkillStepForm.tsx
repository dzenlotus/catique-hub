/**
 * SkillStepForm — inline form for adding/editing a single skill step.
 *
 * Used by `SkillStepsSection` (add flow) and `SkillStepCard` (edit
 * flow). Fully controlled by the caller — the form owns its own draft
 * state internally but commits via `onSubmit`.
 *
 * Fields:
 *   - Title (single-line, required)
 *   - Body (multi-line markdown, required)
 *   - Expected outcome (multi-line, optional → `null` when blank)
 */

import { useState, type ReactElement } from "react";

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

/**
 * `SkillStepForm` — title + body + optional expected-outcome form.
 *
 * Trimmed title triggers a validation error inline; body trim isn't
 * enforced (an empty body is still a valid step skeleton — body fills
 * in over time and the user may want to commit the title first).
 */
export function SkillStepForm({
  initial,
  isPending,
  submitLabel,
  testIdPrefix,
  onCancel,
  onSubmit,
}: SkillStepFormProps): ReactElement {
  const [title, setTitle] = useState(initial?.title ?? "");
  const [body, setBody] = useState(initial?.body ?? "");
  const [expectedOutcome, setExpectedOutcome] = useState(
    initial?.expectedOutcome ?? "",
  );
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = (): void => {
    const trimmedTitle = title.trim();
    if (trimmedTitle === "") {
      setError("Title is required.");
      return;
    }
    setError(null);
    const trimmedOutcome = expectedOutcome.trim();
    onSubmit({
      title: trimmedTitle,
      body,
      expectedOutcome: trimmedOutcome === "" ? null : expectedOutcome,
    });
  };

  return (
    <div
      className={styles.form}
      data-testid={`${testIdPrefix}-form`}
    >
      <Input
        label="Title"
        value={title}
        onChange={setTitle}
        placeholder="What does this step do?"
        className={styles.fullWidth}
        data-testid={`${testIdPrefix}-form-title-input`}
      />
      <TextArea
        label="Body (markdown)"
        value={body}
        onChange={setBody}
        rows={4}
        placeholder="Instructions for the agent — commands, expectations, edge cases."
        className={styles.fullWidth}
        data-testid={`${testIdPrefix}-form-body-input`}
      />
      <TextArea
        label="Expected outcome (optional)"
        value={expectedOutcome}
        onChange={setExpectedOutcome}
        rows={2}
        placeholder="What does success look like for this step?"
        className={styles.fullWidth}
        data-testid={`${testIdPrefix}-form-outcome-input`}
      />
      {error !== null ? (
        <p
          className={styles.formError}
          role="alert"
          data-testid={`${testIdPrefix}-form-error`}
        >
          {error}
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
          onPress={handleSubmit}
          data-testid={`${testIdPrefix}-form-submit`}
        >
          {submitLabel}
        </Button>
      </div>
    </div>
  );
}
