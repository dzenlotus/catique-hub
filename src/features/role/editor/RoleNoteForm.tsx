/**
 * RoleNoteForm — shared body/tags/priority/pinned form used by the
 * `+ Add note` affordance and the per-row inline edit mode in
 * `RoleMemorySection` (ctq-137 / MEM-S2).
 *
 * Stateful at the form level (it owns the draft inputs via
 * react-hook-form); commit happens via the `onSubmit` callback the
 * parent supplies. The parent is responsible for translating the draft
 * into a mutation call and surfacing errors via `errorMessage`.
 */

import { useCallback, type ReactElement } from "react";
import { useForm, Controller } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";

import { Button, Input } from "@shared/ui";

import styles from "./RoleMemorySection.module.css";

export interface RoleNoteDraft {
  body: string;
  tags: string[];
  priority: number;
  pinned: boolean;
}

export interface RoleNoteFormProps {
  /** Prefilled values for edit mode. Defaults to an empty draft. */
  initial?: RoleNoteDraft;
  /** Used to build deterministic test IDs (`{idPrefix}-body-input`). */
  idPrefix: string;
  submitLabel: string;
  onSubmit: (draft: RoleNoteDraft) => void;
  onCancel: () => void;
  /** Caller-driven inline error (e.g. mutation failure). */
  errorMessage?: string | null;
  /** Disable Submit while a mutation is in flight. */
  isPending?: boolean;
}

const EMPTY_DRAFT: RoleNoteDraft = {
  body: "",
  tags: [],
  priority: 0,
  pinned: false,
};

// Body is required (trimmed); tags are entered as a comma-separated
// string and parsed on submit; priority clamps to 0–10; pinned is a
// boolean. The form value mirrors the inputs (tags as raw string);
// `onSubmit` receives the parsed `RoleNoteDraft`.
const roleNoteFormSchema = z.object({
  body: z.string().trim().min(1, "Body cannot be empty."),
  tagsRaw: z.string(),
  priority: z.number().int().min(0).max(10),
  pinned: z.boolean(),
});

type RoleNoteFormShape = z.infer<typeof roleNoteFormSchema>;

/** Split "a, b, , c" → ["a", "b", "c"]. Whitespace + empties dropped. */
function parseTagInput(raw: string): string[] {
  return raw
    .split(",")
    .map((t) => t.trim())
    .filter((t) => t.length > 0);
}

export function RoleNoteForm({
  initial = EMPTY_DRAFT,
  idPrefix,
  submitLabel,
  onSubmit,
  onCancel,
  errorMessage = null,
  isPending = false,
}: RoleNoteFormProps): ReactElement {
  const {
    control,
    handleSubmit,
    formState: { isValid },
  } = useForm<RoleNoteFormShape>({
    resolver: zodResolver(roleNoteFormSchema),
    defaultValues: {
      body: initial.body,
      tagsRaw: initial.tags.join(", "),
      priority: initial.priority,
      pinned: initial.pinned,
    },
    mode: "onChange",
  });

  const onValid = handleSubmit((values) => {
    onSubmit({
      body: values.body.trim(),
      tags: parseTagInput(values.tagsRaw),
      priority: values.priority,
      pinned: values.pinned,
    });
  });

  const handleSubmitPress = useCallback((): void => {
    void onValid();
  }, [onValid]);

  return (
    <div
      className={styles.addForm}
      data-testid={`${idPrefix}-form`}
    >
      <label className={styles.formLabel} htmlFor={`${idPrefix}-body`}>
        Body
      </label>
      <Controller
        control={control}
        name="body"
        render={({ field }) => (
          <textarea
            id={`${idPrefix}-body`}
            className={styles.bodyTextarea}
            value={field.value}
            onChange={(e) => field.onChange(e.target.value)}
            placeholder="What should the agent remember next time?"
            data-testid={`${idPrefix}-body-input`}
          />
        )}
      />

      <Controller
        control={control}
        name="tagsRaw"
        render={({ field }) => (
          <Input
            type="text"
            label="Tags (comma-separated)"
            className={styles.tagsField}
            value={field.value}
            onChange={field.onChange}
            onBlur={field.onBlur}
            name={field.name}
            placeholder="e.g. style, lint, db"
            data-testid={`${idPrefix}-tags-input`}
          />
        )}
      />

      <div className={styles.formRow}>
        <label
          className={styles.priorityField}
          htmlFor={`${idPrefix}-priority`}
        >
          <span className={styles.formLabel}>Priority</span>
          <Controller
            control={control}
            name="priority"
            render={({ field }) => (
              <input
                id={`${idPrefix}-priority`}
                type="number"
                min={0}
                max={10}
                step={1}
                value={field.value}
                onChange={(e) => {
                  const n = Number(e.target.value);
                  if (Number.isNaN(n)) return;
                  field.onChange(Math.max(0, Math.min(10, Math.round(n))));
                }}
                className={styles.priorityNumberInput}
                data-testid={`${idPrefix}-priority-input`}
              />
            )}
          />
        </label>

        <label className={styles.pinnedField}>
          <Controller
            control={control}
            name="pinned"
            render={({ field }) => (
              <input
                type="checkbox"
                checked={field.value}
                onChange={(e) => field.onChange(e.target.checked)}
                data-testid={`${idPrefix}-pinned-input`}
              />
            )}
          />
          Pinned (always loaded for the agent)
        </label>
      </div>

      {errorMessage !== null && errorMessage.length > 0 ? (
        <p
          className={styles.formError}
          role="alert"
          data-testid={`${idPrefix}-error`}
        >
          {errorMessage}
        </p>
      ) : null}

      <div className={styles.formActions}>
        <Button
          variant="ghost"
          size="sm"
          onPress={onCancel}
          data-testid={`${idPrefix}-cancel`}
        >
          Cancel
        </Button>
        <Button
          variant="primary"
          size="sm"
          isDisabled={!isValid}
          isPending={isPending}
          onPress={handleSubmitPress}
          data-testid={`${idPrefix}-submit`}
        >
          {submitLabel}
        </Button>
      </div>
    </div>
  );
}
