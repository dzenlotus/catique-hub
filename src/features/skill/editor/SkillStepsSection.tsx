/**
 * SkillStepsSection — structured-steps editor block on the Skill page.
 *
 * Mounted between the Overview textarea and the Attachments section in
 * `SkillEditorContent`. The section orchestrates:
 *   - Reading the per-skill step list via `useSkillSteps`.
 *   - Inserting a new step via an inline `<SkillStepForm>` (toggled
 *     from the "+ Add step" header button).
 *   - Inline edit / delete on each step.
 *   - Drag-reorder via `@dnd-kit/react` — optimistic order kept in
 *     `useSkillStepsReorder`, persisted via `useReorderSkillStepsMutation`
 *     on drag end. On error we surface a toast.
 *
 * The drag layer is intentionally scoped to this section (a local
 * `<DragDropProvider>`) so it doesn't fight with the kanban or
 * prompts-page providers when those mount in adjacent routes.
 */

import { useCallback, useMemo, useState, type ReactElement } from "react";
import { DragDropProvider } from "@dnd-kit/react";

import {
  useAddSkillStepMutation,
  useDeleteSkillStepMutation,
  useReorderSkillStepsMutation,
  useSkillSteps,
  useUpdateSkillStepMutation,
} from "@entities/skill";
import type { SkillStep } from "@entities/skill";
import { Button, EntityTree, type EntityTreeNode } from "@shared/ui";
import { useToast } from "@shared/lib";

import { SkillStepCard } from "./SkillStepCard";
import { SkillStepForm, type SkillStepFormValue } from "./SkillStepForm";
import { useSkillStepsReorder } from "./useSkillStepsReorder";
import styles from "./SkillStepsSection.module.css";

export interface SkillStepsSectionProps {
  skillId: string;
}

/** `SkillStepsSection` — orchestrator for the steps block. */
export function SkillStepsSection({
  skillId,
}: SkillStepsSectionProps): ReactElement {
  const query = useSkillSteps(skillId);

  return (
    <div
      className={styles.section}
      data-testid="skill-steps-section"
    >
      {query.status === "pending" ? (
        <div aria-busy="true" data-testid="skill-steps-section-pending">
          <p className={styles.emptyHint}>Loading steps…</p>
        </div>
      ) : query.status === "error" ? (
        <div
          className={styles.emptyHint}
          role="alert"
          data-testid="skill-steps-section-error"
        >
          Failed to load steps: {query.error.message}
        </div>
      ) : (
        <SkillStepsBody skillId={skillId} steps={query.data} />
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────

interface SkillStepsBodyProps {
  skillId: string;
  steps: SkillStep[];
}

function SkillStepsBody({
  skillId,
  steps,
}: SkillStepsBodyProps): ReactElement {
  const addMutation = useAddSkillStepMutation();
  const updateMutation = useUpdateSkillStepMutation();
  const deleteMutation = useDeleteSkillStepMutation();
  const reorderMutation = useReorderSkillStepsMutation();
  const { pushToast } = useToast();
  const [isAddingOpen, setIsAddingOpen] = useState(false);

  const handleReorderPersist = useCallback(
    (stepIds: string[]): void => {
      reorderMutation.mutate(
        { skillId, stepIds },
        {
          onError: (err) =>
            pushToast("error", `Failed to reorder steps: ${err.message}`),
        },
      );
    },
    [reorderMutation, skillId, pushToast],
  );

  const {
    sortableGroupKey,
    orderedSteps,
    handleDragStart,
    handleDragOver,
    handleDragEnd,
  } = useSkillStepsReorder({
    skillId,
    steps,
    onPersist: handleReorderPersist,
  });

  // EntityTree row per step. `node.id` is the bare step id so it matches
  // the reorder hook's sortable identities; the rich card body (index,
  // title, chevron, inline edit / delete, expandable body) is rendered
  // through `renderRow`. The display ordinal is baked into the payload
  // so `renderRow` doesn't have to look the node up by position.
  const treeData = useMemo<
    EntityTreeNode<{ step: SkillStep; ordinal: number }>[]
  >(
    () =>
      orderedSteps.map((step, ordinal) => ({
        id: step.id,
        label: step.title,
        data: { step, ordinal },
      })),
    [orderedSteps],
  );

  const handleAdd = (value: SkillStepFormValue): void => {
    addMutation.mutate(
      {
        skillId,
        title: value.title,
        body: value.body,
        expectedOutcome: value.expectedOutcome,
        position: steps.length,
      },
      {
        onSuccess: () => {
          pushToast("success", "Step added");
          setIsAddingOpen(false);
        },
        onError: (err) =>
          pushToast("error", `Failed to add step: ${err.message}`),
      },
    );
  };

  const handleSave = (stepId: string, value: SkillStepFormValue): void => {
    updateMutation.mutate(
      {
        id: stepId,
        title: value.title,
        body: value.body,
        expectedOutcome: value.expectedOutcome,
      },
      {
        onSuccess: () => pushToast("success", "Step updated"),
        onError: (err) =>
          pushToast("error", `Failed to update step: ${err.message}`),
      },
    );
  };

  const handleDelete = (stepId: string): void => {
    deleteMutation.mutate(stepId, {
      onSuccess: () => pushToast("success", "Step removed"),
      onError: (err) =>
        pushToast("error", `Failed to delete step: ${err.message}`),
    });
  };

  return (
    <>
      <div className={styles.header}>
        <h3 className={styles.title}>Steps</h3>
        <div className={styles.headerActions}>
          <Button
            variant="secondary"
            size="sm"
            onPress={() => setIsAddingOpen((v) => !v)}
            data-testid="skill-steps-add-btn"
          >
            + Add step
          </Button>
        </div>
      </div>

      {isAddingOpen ? (
        <SkillStepForm
          isPending={addMutation.status === "pending"}
          submitLabel="Add step"
          testIdPrefix="skill-step-add"
          onCancel={() => setIsAddingOpen(false)}
          onSubmit={handleAdd}
        />
      ) : null}

      {orderedSteps.length === 0 ? (
        <p className={styles.emptyHint} data-testid="skill-steps-empty">
          No steps yet. Add a step to break this skill into executable
          instructions, or import from a git URL.
        </p>
      ) : (
        <DragDropProvider
          onDragStart={handleDragStart}
          onDragOver={handleDragOver}
          onDragEnd={handleDragEnd}
        >
          <EntityTree<{ step: SkillStep; ordinal: number }>
            testIdPrefix="skill-steps"
            data={treeData}
            rowConfig={(node) => ({
              draggable: {
                type: "skill-step",
                group: sortableGroupKey,
                handleAriaLabel: `Drag step ${node.label}`,
              },
            })}
            renderRow={({ node }) => {
              const payload = node.data;
              if (!payload) return null;
              const { step, ordinal } = payload;
              return (
                <SkillStepCard
                  step={step}
                  index={ordinal}
                  isUpdating={
                    updateMutation.status === "pending" &&
                    updateMutation.variables?.id === step.id
                  }
                  isDeleting={
                    deleteMutation.status === "pending" &&
                    deleteMutation.variables === step.id
                  }
                  onSave={(value) => handleSave(step.id, value)}
                  onDelete={() => handleDelete(step.id)}
                />
              );
            }}
          />
        </DragDropProvider>
      )}
    </>
  );
}
