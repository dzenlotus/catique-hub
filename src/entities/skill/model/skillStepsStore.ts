/**
 * Skill steps query-cache layer (SKILL-V2-B).
 *
 * Pattern mirrors `entities/skill/model/skillAttachmentsStore.ts`:
 * - query-key factory keeps invalidation paths in one place.
 * - mutations invalidate the per-skill list key on success so any
 *   mounted `useSkillSteps(skillId)` re-fetches automatically.
 *
 * `skillStepsKeys.byList` is also the key the `EventsProvider`
 * invalidates on `skill_step:created`, `skill_step:updated`,
 * `skill_step:deleted`, and `skill:imported` — do not rename without
 * updating that provider.
 */

import {
  useMutation,
  useQuery,
  useQueryClient,
  type UseMutationResult,
  type UseQueryResult,
} from "@tanstack/react-query";

import {
  addSkillStep,
  deleteSkillStep,
  listSkillSteps,
  reorderSkillSteps,
  updateSkillStep,
  type AddSkillStepArgs,
  type ReorderSkillStepsArgs,
  type UpdateSkillStepArgs,
} from "../api/skillStepsApi";
import type { SkillStep } from "@bindings/SkillStep";

/** Query-key factory. */
export const skillStepsKeys = {
  all: ["skillSteps"] as const,
  byList: (skillId: string) => [...skillStepsKeys.all, skillId] as const,
};

/**
 * `useSkillSteps` — list every step for the given skill. Disabled when
 * `skillId` is empty so mounting without a selection doesn't fire an
 * IPC call.
 */
export function useSkillSteps(
  skillId: string,
): UseQueryResult<SkillStep[], Error> {
  return useQuery({
    queryKey: skillStepsKeys.byList(skillId),
    queryFn: () => listSkillSteps(skillId),
    enabled: skillId.length > 0,
  });
}

/**
 * `useAddSkillStepMutation` — insert a step, then invalidate the per-
 * skill list so consumers re-fetch.
 */
export function useAddSkillStepMutation(): UseMutationResult<
  SkillStep,
  Error,
  AddSkillStepArgs
> {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: addSkillStep,
    onSuccess: (_data, args) => {
      void queryClient.invalidateQueries({
        queryKey: skillStepsKeys.byList(args.skillId),
      });
    },
  });
}

/**
 * `useUpdateSkillStepMutation` — partial-update a step. The mutation
 * variables don't carry `skillId`, so we invalidate the root key (all
 * per-skill lists). The backend also emits `skill_step:updated` with
 * the owning `skillId` for narrower invalidation via EventsProvider.
 */
export function useUpdateSkillStepMutation(): UseMutationResult<
  SkillStep,
  Error,
  UpdateSkillStepArgs
> {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: updateSkillStep,
    onSuccess: (updated) => {
      void queryClient.invalidateQueries({
        queryKey: skillStepsKeys.byList(updated.skillId),
      });
    },
  });
}

/**
 * `useDeleteSkillStepMutation` — drop a step. Variables = id only,
 * so we invalidate the root key. EventsProvider narrows via the
 * `skill_step:deleted` event.
 */
export function useDeleteSkillStepMutation(): UseMutationResult<
  void,
  Error,
  string
> {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: deleteSkillStep,
    onSuccess: () => {
      void queryClient.invalidateQueries({
        queryKey: skillStepsKeys.all,
      });
    },
  });
}

/**
 * `useReorderSkillStepsMutation` — rewrite `position` for every step
 * on a skill. Invalidates the per-skill list on success.
 */
export function useReorderSkillStepsMutation(): UseMutationResult<
  void,
  Error,
  ReorderSkillStepsArgs
> {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: reorderSkillSteps,
    onSuccess: (_data, args) => {
      void queryClient.invalidateQueries({
        queryKey: skillStepsKeys.byList(args.skillId),
      });
    },
  });
}
