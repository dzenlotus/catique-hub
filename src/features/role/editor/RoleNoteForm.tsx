/**
 * RoleNoteForm — shared body/tags/priority/pinned form used by the
 * `+ Add note` affordance and the per-row inline edit mode in
 * `RoleMemorySection` (ctq-137 / MEM-S2).
 *
 * Stateful at the form level (it owns the draft inputs); commit happens
 * via the `onSubmit` callback the parent supplies. The parent is
 * responsible for translating the draft into a mutation call and
 * surfacing errors via `errorMessage`.
 */

import { useState, type ReactElement } from "react";

import { Button } from "@shared/ui";

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
  const [body, setBody] = useState(initial.body);
  const [tagsRaw, setTagsRaw] = useState(initial.tags.join(", "));
  const [priority, setPriority] = useState(initial.priority);
  const [pinned, setPinned] = useState(initial.pinned);

  const handleSubmit = (): void => {
    const trimmed = body.trim();
    if (trimmed.length === 0) return;
    onSubmit({
      body: trimmed,
      tags: parseTagInput(tagsRaw),
      priority,
      pinned,
    });
  };

  return (
    <div
      className={styles.addForm}
      data-testid={`${idPrefix}-form`}
    >
      <label className={styles.formLabel} htmlFor={`${idPrefix}-body`}>
        Body
      </label>
      <textarea
        id={`${idPrefix}-body`}
        className={styles.bodyTextarea}
        value={body}
        onChange={(e) => setBody(e.target.value)}
        placeholder="What should the agent remember next time?"
        data-testid={`${idPrefix}-body-input`}
      />

      <label className={styles.formLabel} htmlFor={`${idPrefix}-tags`}>
        Tags (comma-separated)
      </label>
      <input
        id={`${idPrefix}-tags`}
        type="text"
        className={styles.tagsInput}
        value={tagsRaw}
        onChange={(e) => setTagsRaw(e.target.value)}
        placeholder="e.g. style, lint, db"
        data-testid={`${idPrefix}-tags-input`}
      />

      <div className={styles.formRow}>
        <label
          className={styles.priorityField}
          htmlFor={`${idPrefix}-priority`}
        >
          <span className={styles.formLabel}>Priority</span>
          <input
            id={`${idPrefix}-priority`}
            type="number"
            min={0}
            max={10}
            step={1}
            value={priority}
            onChange={(e) => {
              const n = Number(e.target.value);
              if (Number.isNaN(n)) return;
              setPriority(Math.max(0, Math.min(10, Math.round(n))));
            }}
            className={styles.priorityNumberInput}
            data-testid={`${idPrefix}-priority-input`}
          />
        </label>

        <label className={styles.pinnedField}>
          <input
            type="checkbox"
            checked={pinned}
            onChange={(e) => setPinned(e.target.checked)}
            data-testid={`${idPrefix}-pinned-input`}
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
          isDisabled={body.trim().length === 0}
          isPending={isPending}
          onPress={handleSubmit}
          data-testid={`${idPrefix}-submit`}
        >
          {submitLabel}
        </Button>
      </div>
    </div>
  );
}
