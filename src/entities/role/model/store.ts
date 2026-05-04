/**
 * Roles query-cache layer.
 *
 * Built on `@tanstack/react-query`. Convention mirrors `entities/board/model/store.ts`:
 * query keys are tuples starting with "roles", mutations invalidate the
 * list key on success so any mounted `useRoles()` re-fetches automatically.
 *
 * The `["roles"]` root key is also used by `EventsProvider` which
 * invalidates it on `role.created`, `role.updated`, and `role.deleted`
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
  createRole,
  deleteRole,
  getRole,
  listRoles,
  updateRole,
  addRolePrompt,
  type CreateRoleArgs,
  type UpdateRoleArgs,
  type AddRolePromptArgs,
} from "../api";
import { syncRolesToAllSupportingClients } from "@entities/connected-client";
import type { Role } from "./types";

/** Query-key factory. Centralised so invalidation stays consistent. */
export const rolesKeys = {
  all: ["roles"] as const,
  list: () => [...rolesKeys.all] as const,
  detail: (id: string) => [...rolesKeys.all, id] as const,
};

/**
 * `useRoles` — list every role.
 *
 * Returns the standard react-query result. Consumers should branch on
 * `result.status` (`'pending' | 'error' | 'success'`).
 */
export function useRoles(): UseQueryResult<Role[], Error> {
  return useQuery({
    queryKey: rolesKeys.list(),
    queryFn: listRoles,
  });
}

/**
 * `useRole` — fetch a single role. Disabled when `id` is empty so
 * mounting the hook with no selection doesn't fire an IPC call.
 */
export function useRole(id: string): UseQueryResult<Role, Error> {
  return useQuery({
    queryKey: rolesKeys.detail(id),
    queryFn: () => getRole(id),
    enabled: id.length > 0,
  });
}

/**
 * `useCreateRoleMutation` — create a role, then invalidate the list
 * cache so any mounted `useRoles()` re-fetches. Fans out a fire-and-
 * forget sync to every connected client supporting role-sync so the
 * new role lands in agent-managed files immediately.
 */
export function useCreateRoleMutation(): UseMutationResult<
  Role,
  Error,
  CreateRoleArgs
> {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: createRole,
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: rolesKeys.list() });
      void syncRolesToAllSupportingClients(queryClient);
    },
  });
}

/**
 * `useUpdateRoleMutation` — partial-update a role, then invalidate list
 * and the specific detail entry. Auto-fans-out a sync to every connected
 * client supporting role-sync so the rewritten role lands in agent-
 * managed files without a separate manual step.
 */
export function useUpdateRoleMutation(): UseMutationResult<
  Role,
  Error,
  UpdateRoleArgs
> {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: updateRole,
    onSuccess: (updated) => {
      void queryClient.invalidateQueries({ queryKey: rolesKeys.list() });
      void queryClient.invalidateQueries({
        queryKey: rolesKeys.detail(updated.id),
      });
      void syncRolesToAllSupportingClients(queryClient);
    },
  });
}

/**
 * `useDeleteRoleMutation` — delete a role, invalidate the list, and
 * remove the stale detail entry from the cache. Auto-fans-out a sync
 * so each connected client's stale-cleanup routine removes the role's
 * agent-managed files (`catique-<id>.md` / `.mdc`).
 */
export function useDeleteRoleMutation(): UseMutationResult<void, Error, string> {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: deleteRole,
    onSuccess: (_data, id) => {
      void queryClient.invalidateQueries({ queryKey: rolesKeys.list() });
      queryClient.removeQueries({ queryKey: rolesKeys.detail(id) });
      void syncRolesToAllSupportingClients(queryClient);
    },
  });
}

/**
 * `useAddRolePromptMutation` — attach a prompt to a role.
 * No cache invalidation needed: the join-table is write-only at this layer.
 */
export function useAddRolePromptMutation(): UseMutationResult<
  void,
  Error,
  AddRolePromptArgs
> {
  return useMutation({
    mutationFn: addRolePrompt,
  });
}
