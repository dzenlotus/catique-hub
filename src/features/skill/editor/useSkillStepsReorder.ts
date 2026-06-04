/**
 * `useSkillStepsReorder` — local drag-state for the steps list.
 *
 * Extracted from `SkillStepsSection` so the orchestrator stays under
 * the 150-LOC component cap. Wraps `@dnd-kit/helpers` `move()` over a
 * single sortable group; persists the final order via
 * `reorder_skill_steps` (passed in by the caller) on drag-end.
 *
 * Returns the current optimistic order (bare step ids — matching the
 * `EntityTree` row `node.id` / `useSortable({ id })` registration) and
 * the three handlers wired to the `<DragDropProvider>`.
 */

import { useCallback, useMemo, useRef, useState } from "react";
import type {
  DragEndEvent,
  DragOverEvent,
  DragStartEvent,
} from "@dnd-kit/react";
import { move } from "@dnd-kit/helpers";

import type { SkillStep } from "@entities/skill";

export interface UseSkillStepsReorderArgs {
  skillId: string;
  steps: SkillStep[];
  onPersist: (stepIds: string[]) => void;
}

export interface UseSkillStepsReorderResult {
  sortableGroupKey: string;
  orderedSteps: SkillStep[];
  handleDragStart: (event: DragStartEvent) => void;
  handleDragOver: (event: DragOverEvent) => void;
  handleDragEnd: (event: DragEndEvent) => void;
}

export function useSkillStepsReorder({
  skillId,
  steps,
  onPersist,
}: UseSkillStepsReorderArgs): UseSkillStepsReorderResult {
  const sortableGroupKey = `skill-steps-${skillId}`;
  // Bare step ids — match the `EntityTree` row `node.id` registration so
  // the @dnd-kit sortable identities line up across the list and the
  // reorder bucket.
  const serverOrder = useMemo(() => steps.map((s) => s.id), [steps]);

  const [optimisticIds, setOptimisticIds] = useState<string[] | null>(null);
  const optimisticIdsRef = useRef<string[] | null>(null);

  const orderedIds = optimisticIds ?? serverOrder;
  const stepsById = useMemo(() => {
    const map = new Map<string, SkillStep>();
    for (const s of steps) map.set(s.id, s);
    return map;
  }, [steps]);
  const orderedSteps = useMemo<SkillStep[]>(() => {
    const out: SkillStep[] = [];
    for (const id of orderedIds) {
      const step = stepsById.get(id);
      if (step) out.push(step);
    }
    return out;
  }, [orderedIds, stepsById]);

  const handleDragStart = useCallback(
    (_event: DragStartEvent): void => {
      optimisticIdsRef.current = serverOrder;
      setOptimisticIds(serverOrder);
    },
    [serverOrder],
  );

  const handleDragOver = useCallback(
    (event: DragOverEvent): void => {
      setOptimisticIds((current) => {
        if (current === null) return current;
        const bucket = { [sortableGroupKey]: current };
        const next = move(bucket, event);
        const nextOrder = next[sortableGroupKey] ?? current;
        optimisticIdsRef.current = nextOrder;
        return nextOrder;
      });
    },
    [sortableGroupKey],
  );

  const handleDragEnd = useCallback(
    (event: DragEndEvent): void => {
      const finalOrder = optimisticIdsRef.current ?? serverOrder;
      optimisticIdsRef.current = null;
      setOptimisticIds(null);
      if (event.canceled) return;
      const sameOrder =
        finalOrder.length === serverOrder.length &&
        finalOrder.every((id, i) => id === serverOrder[i]);
      if (sameOrder) return;
      onPersist([...finalOrder]);
    },
    [serverOrder, onPersist],
  );

  return {
    sortableGroupKey,
    orderedSteps,
    handleDragStart,
    handleDragOver,
    handleDragEnd,
  };
}
