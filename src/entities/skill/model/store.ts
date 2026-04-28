/**
 * Skills query-cache layer.
 *
 * Built on `@tanstack/react-query`. Convention mirrors `entities/role/model/store.ts`:
 * query keys are tuples starting with "skills", mutations invalidate the
 * list key on success so any mounted `useSkills()` re-fetches automatically.
 *
 * The `["skills"]` root key is also used by `EventsProvider` which
 * invalidates it on `skill.created`, `skill.updated`, and `skill.deleted`
 * realtime events — do not rename without updating that provider.
 */

import {
  useMutation,
  useQuery,
  useQueryClient,
  type UseMutationResult,
  type UseQueryResult,
} from "@tanstack/react-query";

import {
  createSkill,
  deleteSkill,
  getSkill,
  listSkills,
  updateSkill,
  type CreateSkillArgs,
  type UpdateSkillArgs,
} from "../api";
import type { Skill } from "./types";

/** Query-key factory. Centralised so invalidation stays consistent. */
export const skillsKeys = {
  all: ["skills"] as const,
  list: () => [...skillsKeys.all] as const,
  detail: (id: string) => [...skillsKeys.all, id] as const,
};

/**
 * `useSkills` — list every skill.
 *
 * Returns the standard react-query result. Consumers should branch on
 * `result.status` (`'pending' | 'error' | 'success'`).
 */
export function useSkills(): UseQueryResult<Skill[], Error> {
  return useQuery({
    queryKey: skillsKeys.list(),
    queryFn: listSkills,
  });
}

/**
 * `useSkill` — fetch a single skill. Disabled when `id` is empty so
 * mounting the hook with no selection doesn't fire an IPC call.
 */
export function useSkill(id: string): UseQueryResult<Skill, Error> {
  return useQuery({
    queryKey: skillsKeys.detail(id),
    queryFn: () => getSkill(id),
    enabled: id.length > 0,
  });
}

/**
 * `useCreateSkillMutation` — create a skill, then invalidate the list
 * cache so any mounted `useSkills()` re-fetches.
 */
export function useCreateSkillMutation(): UseMutationResult<
  Skill,
  Error,
  CreateSkillArgs
> {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: createSkill,
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: skillsKeys.list() });
    },
  });
}

/**
 * `useUpdateSkillMutation` — partial-update a skill, then invalidate list
 * and the specific detail entry.
 */
export function useUpdateSkillMutation(): UseMutationResult<
  Skill,
  Error,
  UpdateSkillArgs
> {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: updateSkill,
    onSuccess: (updated) => {
      void queryClient.invalidateQueries({ queryKey: skillsKeys.list() });
      void queryClient.invalidateQueries({
        queryKey: skillsKeys.detail(updated.id),
      });
    },
  });
}

/**
 * `useDeleteSkillMutation` — delete a skill, invalidate the list, and
 * remove the stale detail entry from the cache.
 */
export function useDeleteSkillMutation(): UseMutationResult<void, Error, string> {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: deleteSkill,
    onSuccess: (_data, id) => {
      void queryClient.invalidateQueries({ queryKey: skillsKeys.list() });
      queryClient.removeQueries({ queryKey: skillsKeys.detail(id) });
    },
  });
}
