/**
 * SkillStepCard — one step row BODY inside `SkillStepsSection`.
 *
 * Two render modes:
 *   - **read** (default): index, title, expand chevron, edit and delete
 *     buttons. Body + expected-outcome render below when expanded.
 *   - **edit**: swaps the entire card body for an inline
 *     `<SkillStepForm>` keyed to the current step.
 *
 * Drag is owned by `<EntityTree/>`'s `Row` (built-in handle + sortable
 * registration via `rowConfig.draggable`); this component renders only
 * the row body through EntityTree's `renderRow` slot. Drop semantics
 * (canceled / reorder settle) stay with `<SkillStepsSection>`'s shared
 * `<DragDropProvider>`.
 */

import { useState, type ReactElement } from "react";

import { Button } from "@shared/ui";
import { cn } from "@shared/lib";
import type { SkillStep } from "@bindings/SkillStep";

import { SkillStepForm, type SkillStepFormValue } from "./SkillStepForm";
import styles from "./SkillStepsSection.module.css";

export interface SkillStepCardProps {
  step: SkillStep;
  /** Zero-based position — drives the visible "N." ordinal. */
  index: number;
  /** True while the parent's update mutation targets this step. */
  isUpdating: boolean;
  /** True while the parent's delete mutation targets this step. */
  isDeleting: boolean;
  onSave: (value: SkillStepFormValue) => void;
  onDelete: () => void;
}

export function SkillStepCard({
  step,
  index,
  isUpdating,
  isDeleting,
  onSave,
  onDelete,
}: SkillStepCardProps): ReactElement {
  const [isExpanded, setIsExpanded] = useState(false);
  const [isEditing, setIsEditing] = useState(false);

  const handleSubmit = (value: SkillStepFormValue): void => {
    onSave(value);
    setIsEditing(false);
  };

  if (isEditing) {
    return (
      <div
        className={styles.card}
        data-testid={`skill-step-card-${step.id}`}
      >
        <SkillStepForm
          initial={{
            title: step.title,
            body: step.body,
            expectedOutcome: step.expectedOutcome,
          }}
          isPending={isUpdating}
          submitLabel="Save"
          testIdPrefix={`skill-step-${step.id}`}
          onCancel={() => setIsEditing(false)}
          onSubmit={handleSubmit}
        />
      </div>
    );
  }

  return (
    <div
      className={styles.card}
      data-testid={`skill-step-card-${step.id}`}
    >
      <div className={styles.cardHeader}>
        <span className={styles.stepIndex} aria-hidden="true">
          {index + 1}.
        </span>
        <span
          className={styles.stepTitle}
          data-testid={`skill-step-title-${step.id}`}
        >
          {step.title}
        </span>
        <Button
          variant="ghost"
          size="sm"
          onPress={() => setIsExpanded((v) => !v)}
          aria-label={isExpanded ? "Collapse step" : "Expand step"}
          aria-expanded={isExpanded}
          className={styles.chevronButton}
          data-testid={`skill-step-toggle-${step.id}`}
        >
          <span aria-hidden="true">{isExpanded ? "⌃" : "⌄"}</span>
        </Button>
        <Button
          variant="ghost"
          size="sm"
          onPress={() => setIsEditing(true)}
          aria-label={`Edit step ${step.title}`}
          className={styles.editButton}
          data-testid={`skill-step-edit-${step.id}`}
        >
          ✎
        </Button>
        <Button
          variant="ghost"
          size="sm"
          isPending={isDeleting}
          isDisabled={isDeleting}
          onPress={onDelete}
          aria-label={`Delete step ${step.title}`}
          className={cn(styles.deleteButton)}
          data-testid={`skill-step-delete-${step.id}`}
        >
          ×
        </Button>
      </div>
      {isExpanded ? (
        <div
          className={styles.cardBody}
          data-testid={`skill-step-body-${step.id}`}
        >
          <p className={styles.bodyText}>
            {step.body === "" ? "(empty body)" : step.body}
          </p>
          {step.expectedOutcome !== null && step.expectedOutcome !== "" ? (
            <div
              className={styles.outcomeBlock}
              data-testid={`skill-step-outcome-${step.id}`}
            >
              <span className={styles.outcomeLabel}>Expected outcome</span>
              <p className={styles.outcomeText}>{step.expectedOutcome}</p>
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
