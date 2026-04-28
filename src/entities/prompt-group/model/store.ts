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
  listPromptGroupMembers,
  listPromptGroups,
  removePromptGroupMember,
  setPromptGroupMembers,
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
};

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
    },
  });
}
