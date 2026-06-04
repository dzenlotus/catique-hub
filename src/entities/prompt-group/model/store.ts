/**
 * PromptGroups query-cache layer.
 *
 * Built on `@tanstack/react-query`. Convention mirrors `entities/role/model/store.ts`:
 * query keys are tuples starting with "prompt_groups", mutations invalidate the
 * list key on success so any mounted `usePromptGroups()` re-fetches automatically.
 *
 * The `["prompt_groups"]` root key is also used by `EventsProvider` which
 * invalidates it on `prompt_group.created`, `prompt_group.updated`, and
 * `prompt_group.deleted` realtime events — do not rename without updating that provider.
 *
 * The `["prompt_groups", "members", groupId]` key is invalidated by
 * `prompt_group.members_changed` events.
 */

import {
  useMutation,
  useQueries,
  useQuery,
  useQueryClient,
  type UseMutationResult,
  type UseQueryResult,
} from "@tanstack/react-query";

import {
  addPromptGroupMember,
  createPromptGroup,
  deletePromptGroup,
  getPromptGroup,
  listBoardPromptGroups,
  listPromptGroupMembers,
  listPromptGroups,
  listRolePromptGroups,
  listTaskPromptGroups,
  removePromptGroupMember,
  setBoardPromptGroups,
  setPromptGroupMembers,
  setRolePromptGroups,
  setTaskPromptGroups,
  updatePromptGroup,
  type AddPromptGroupMemberArgs,
  type CreatePromptGroupArgs,
  type RemovePromptGroupMemberArgs,
  type SetPromptGroupMembersArgs,
  type UpdatePromptGroupArgs,
} from "../api";
import type { PromptGroup } from "./types";

/** Query-key factory. Centralised so invalidation stays consistent. */
export const promptGroupsKeys = {
  all: ["prompt_groups"] as const,
  list: () => [...promptGroupsKeys.all] as const,
  detail: (id: string) => [...promptGroupsKeys.all, id] as const,
  members: (groupId: string) =>
    [...promptGroupsKeys.all, "members", groupId] as const,
  /** Prompt groups attached at a scope (role / board / task). */
  roleAttached: (roleId: string) =>
    [...promptGroupsKeys.all, "attached", "role", roleId] as const,
  boardAttached: (boardId: string) =>
    [...promptGroupsKeys.all, "attached", "board", boardId] as const,
  taskAttached: (taskId: string) =>
    [...promptGroupsKeys.all, "attached", "task", taskId] as const,
};

/**
 * Shared invalidation for prompt-group attach mutations. Refreshes the
 * scope's attached-group list AND the tasks cache (`["tasks"]`) so the
 * effective-context XML preview / kanban counters re-resolve — attaching
 * a group re-materialises `task_prompts` for every task in scope.
 */
function invalidateAttach(
  queryClient: ReturnType<typeof useQueryClient>,
  attachedKey: readonly unknown[],
): void {
  void queryClient.invalidateQueries({ queryKey: attachedKey });
  void queryClient.invalidateQueries({ queryKey: ["tasks"] });
}

/**
 * `usePromptGroups` — list every prompt group.
 *
 * Returns the standard react-query result. Consumers should branch on
 * `result.status` (`'pending' | 'error' | 'success'`).
 */
export function usePromptGroups(): UseQueryResult<PromptGroup[], Error> {
  return useQuery({
    queryKey: promptGroupsKeys.list(),
    queryFn: listPromptGroups,
  });
}

/**
 * `usePromptGroup` — fetch a single prompt group. Disabled when `id` is empty
 * so mounting the hook with no selection doesn't fire an IPC call.
 */
export function usePromptGroup(id: string): UseQueryResult<PromptGroup, Error> {
  return useQuery({
    queryKey: promptGroupsKeys.detail(id),
    queryFn: () => getPromptGroup(id),
    enabled: id.length > 0,
  });
}

/**
 * `usePromptGroupMembers` — fetch the ordered prompt ids for a group.
 * Disabled when `groupId` is empty.
 */
export function usePromptGroupMembers(
  groupId: string,
): UseQueryResult<string[], Error> {
  return useQuery({
    queryKey: promptGroupsKeys.members(groupId),
    queryFn: () => listPromptGroupMembers(groupId),
    enabled: groupId.length > 0,
  });
}

/**
 * `usePromptGroupMembersMap` — fetch members for several groups at once
 * (shares the per-group `members` cache key with `usePromptGroupMembers`).
 * Returns a `{ groupId: promptId[] }` map containing only the groups whose
 * member list has resolved. Used by the combined picker to hide prompts
 * already covered by an attached group.
 */
export function usePromptGroupMembersMap(
  groupIds: readonly string[],
): Record<string, string[]> {
  const results = useQueries({
    queries: groupIds.map((gid) => ({
      queryKey: promptGroupsKeys.members(gid),
      queryFn: () => listPromptGroupMembers(gid),
      enabled: gid.length > 0,
    })),
  });
  const map: Record<string, string[]> = {};
  groupIds.forEach((gid, idx) => {
    const data = results[idx]?.data;
    if (data) map[gid] = data;
  });
  return map;
}

/**
 * `useCreatePromptGroupMutation` — create a prompt group, then invalidate the
 * list cache so any mounted `usePromptGroups()` re-fetches.
 */
export function useCreatePromptGroupMutation(): UseMutationResult<
  PromptGroup,
  Error,
  CreatePromptGroupArgs
> {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: createPromptGroup,
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: promptGroupsKeys.list() });
    },
  });
}

/**
 * `useUpdatePromptGroupMutation` — partial-update a prompt group, then
 * invalidate list and the specific detail entry.
 */
export function useUpdatePromptGroupMutation(): UseMutationResult<
  PromptGroup,
  Error,
  UpdatePromptGroupArgs
> {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: updatePromptGroup,
    onSuccess: (updated) => {
      void queryClient.invalidateQueries({ queryKey: promptGroupsKeys.list() });
      void queryClient.invalidateQueries({
        queryKey: promptGroupsKeys.detail(updated.id),
      });
    },
  });
}

/**
 * `useDeletePromptGroupMutation` — delete a prompt group, invalidate the list,
 * and remove the stale detail entry from the cache.
 */
export function useDeletePromptGroupMutation(): UseMutationResult<
  void,
  Error,
  string
> {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: deletePromptGroup,
    onSuccess: (_data, id) => {
      void queryClient.invalidateQueries({ queryKey: promptGroupsKeys.list() });
      queryClient.removeQueries({ queryKey: promptGroupsKeys.detail(id) });
    },
  });
}

/**
 * `useAddPromptGroupMemberMutation` — add a prompt to a group, then
 * invalidate the members key and the parent list.
 */
export function useAddPromptGroupMemberMutation(): UseMutationResult<
  void,
  Error,
  AddPromptGroupMemberArgs
> {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: addPromptGroupMember,
    onSuccess: (_data, args) => {
      void queryClient.invalidateQueries({
        queryKey: promptGroupsKeys.members(args.groupId),
      });
      void queryClient.invalidateQueries({ queryKey: promptGroupsKeys.list() });
    },
  });
}

/**
 * `useRemovePromptGroupMemberMutation` — remove a prompt from a group, then
 * invalidate the members key and the parent list.
 */
export function useRemovePromptGroupMemberMutation(): UseMutationResult<
  void,
  Error,
  RemovePromptGroupMemberArgs
> {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: removePromptGroupMember,
    onSuccess: (_data, args) => {
      void queryClient.invalidateQueries({
        queryKey: promptGroupsKeys.members(args.groupId),
      });
      void queryClient.invalidateQueries({ queryKey: promptGroupsKeys.list() });
    },
  });
}

/**
 * `useSetPromptGroupMembersMutation` — replace the entire ordered member list,
 * then invalidate the members key and the parent list.
 *
 * Also invalidates the tasks cache: membership changes re-materialise
 * `task_prompts` everywhere the group is attached (live link), so any
 * task bundle / effective-context preview must re-resolve.
 */
export function useSetPromptGroupMembersMutation(): UseMutationResult<
  void,
  Error,
  SetPromptGroupMembersArgs
> {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: setPromptGroupMembers,
    onSuccess: (_data, args) => {
      void queryClient.invalidateQueries({
        queryKey: promptGroupsKeys.members(args.groupId),
      });
      void queryClient.invalidateQueries({ queryKey: promptGroupsKeys.list() });
      void queryClient.invalidateQueries({ queryKey: ["tasks"] });
    },
  });
}

// ---------------------------------------------------------------------------
// Group attachment — attach a prompt group as a live unit to a scope.
// ---------------------------------------------------------------------------

/** `useRolePromptGroups` — prompt-group ids attached to a role. */
export function useRolePromptGroups(
  roleId: string,
): UseQueryResult<string[], Error> {
  return useQuery({
    queryKey: promptGroupsKeys.roleAttached(roleId),
    queryFn: () => listRolePromptGroups(roleId),
    enabled: roleId.length > 0,
  });
}

/** `useBoardPromptGroups` — prompt-group ids attached to a board. */
export function useBoardPromptGroups(
  boardId: string,
): UseQueryResult<string[], Error> {
  return useQuery({
    queryKey: promptGroupsKeys.boardAttached(boardId),
    queryFn: () => listBoardPromptGroups(boardId),
    enabled: boardId.length > 0,
  });
}

/** `useTaskPromptGroups` — prompt-group ids attached directly to a task. */
export function useTaskPromptGroups(
  taskId: string,
): UseQueryResult<string[], Error> {
  return useQuery({
    queryKey: promptGroupsKeys.taskAttached(taskId),
    queryFn: () => listTaskPromptGroups(taskId),
    enabled: taskId.length > 0,
  });
}

interface SetScopeGroupsArgs {
  /** Scope owner id (role / board / task). */
  id: string;
  groupIds: string[];
}

/** `useSetRolePromptGroupsMutation` — replace a role's attached prompt groups. */
export function useSetRolePromptGroupsMutation(): UseMutationResult<
  void,
  Error,
  SetScopeGroupsArgs
> {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, groupIds }) => setRolePromptGroups(id, groupIds),
    onSettled: (_v, _e, args) => {
      invalidateAttach(queryClient, promptGroupsKeys.roleAttached(args.id));
    },
  });
}

/** `useSetBoardPromptGroupsMutation` — replace a board's attached prompt groups. */
export function useSetBoardPromptGroupsMutation(): UseMutationResult<
  void,
  Error,
  SetScopeGroupsArgs
> {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, groupIds }) => setBoardPromptGroups(id, groupIds),
    onSettled: (_v, _e, args) => {
      invalidateAttach(queryClient, promptGroupsKeys.boardAttached(args.id));
    },
  });
}

/** `useSetTaskPromptGroupsMutation` — replace a task's directly-attached prompt groups. */
export function useSetTaskPromptGroupsMutation(): UseMutationResult<
  void,
  Error,
  SetScopeGroupsArgs
> {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, groupIds }) => setTaskPromptGroups(id, groupIds),
    onSettled: (_v, _e, args) => {
      invalidateAttach(queryClient, promptGroupsKeys.taskAttached(args.id));
    },
  });
}
