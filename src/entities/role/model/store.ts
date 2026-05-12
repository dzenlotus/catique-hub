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
  removeRolePrompt,
  listRolePrompts,
  setRolePrompts,
  addRoleSkill,
  removeRoleSkill,
  listRoleSkills,
  setRoleSkills,
  addRoleMcpTool,
  removeRoleMcpTool,
  listRoleMcpTools,
  setRoleMcpTools,
  type CreateRoleArgs,
  type UpdateRoleArgs,
  type AddRolePromptArgs,
  type RemoveRolePromptArgs,
  type AddRoleSkillArgs,
  type RemoveRoleSkillArgs,
  type AddRoleMcpToolArgs,
  type RemoveRoleMcpToolArgs,
} from "../api";
// Round-21: provider sync is now driven server-side. The role mutation
// IPCs trigger the fanout in Rust; the topbar indicator (`useSyncStatus`
// in `@entities/connected-client`) reflects the global state via the
// `sync:status_changed` event. The previous frontend
// `syncRolesToAllSupportingClients` helper was removed alongside the
// per-card "Sync roles" button.
import type { Prompt } from "@bindings/Prompt";
import type { Skill } from "@bindings/Skill";
import type { McpTool } from "@bindings/McpTool";
import type { Role } from "./types";

/** Query-key factory. Centralised so invalidation stays consistent. */
export const rolesKeys = {
  all: ["roles"] as const,
  list: () => [...rolesKeys.all] as const,
  detail: (id: string) => [...rolesKeys.all, id] as const,
  prompts: (roleId: string) =>
    [...rolesKeys.all, "prompts", roleId] as const,
  skills: (roleId: string) =>
    [...rolesKeys.all, "skills", roleId] as const,
  mcpTools: (roleId: string) =>
    [...rolesKeys.all, "mcpTools", roleId] as const,
};

/**
 * Optional filter for {@link useRoles}.
 *
 * `excludeSystem: true` drops the seeded coordinator-only role
 * (`dirizher-system`) from the result. The Maintainer system row
 * (`maintainer-system`) and every user-defined role stay visible —
 * Dirizher is the Pattern B coordinator and is rejected by the
 * application-layer guard in `set_board_owner` (ctq-88), so any UI
 * picker that produces a board owner must not surface it.
 */
export interface UseRolesOptions {
  /** Drop `dirizher-system` from the list (kept by default). */
  excludeSystem?: boolean;
}

/**
 * `useRoles` — list every role.
 *
 * Returns the standard react-query result. Consumers should branch on
 * `result.status` (`'pending' | 'error' | 'success'`).
 *
 * Pass `{ excludeSystem: true }` for owner-role pickers (board create /
 * settings) where the Dirizher coordinator must not appear. The
 * underlying query is shared between filtered and unfiltered callers
 * — react-query keys on `["roles"]` and the filter is a pure derived
 * projection of the same cached array.
 */
export function useRoles(
  options?: UseRolesOptions,
): UseQueryResult<Role[], Error> {
  const result = useQuery({
    queryKey: rolesKeys.list(),
    queryFn: listRoles,
  });
  if (options?.excludeSystem !== true) return result;
  if (result.status !== "success") return result;
  // Filter happens after the cache hit so we don't fork the query key
  // and lose deduplication. Allocates a fresh array only when the
  // input list contains the excluded id; otherwise returns the
  // original reference for stable referential equality across
  // re-renders.
  const filtered = result.data.filter((r) => r.id !== "dirizher-system");
  if (filtered.length === result.data.length) return result;
  return { ...result, data: filtered } as UseQueryResult<Role[], Error>;
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
 * cache so any mounted `useRoles()` re-fetches. Round-21: provider sync
 * fanout moved to the Rust handler; the topbar indicator reflects
 * global progress via `sync:status_changed`.
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
    },
  });
}

/**
 * `useUpdateRoleMutation` — partial-update a role, then invalidate list
 * and the specific detail entry. Round-21: provider sync fanout moved
 * to the Rust handler; the topbar indicator reflects global progress
 * via `sync:status_changed`.
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
    },
  });
}

/**
 * `useDeleteRoleMutation` — delete a role, invalidate the list, and
 * remove the stale detail entry from the cache. Round-21: provider sync
 * fanout (including stale-cleanup of agent-managed files) moved to the
 * Rust handler; the topbar indicator reflects global progress via
 * `sync:status_changed`.
 */
export function useDeleteRoleMutation(): UseMutationResult<void, Error, string> {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: deleteRole,
    onSuccess: (_data, id) => {
      void queryClient.invalidateQueries({ queryKey: rolesKeys.list() });
      queryClient.removeQueries({ queryKey: rolesKeys.detail(id) });
    },
  });
}

/**
 * `useRolePrompts` — prompts attached to a role, ordered by position.
 *
 * The query is disabled when `roleId` is empty so mounting with no
 * selection doesn't fire an IPC call. Backend handler ships in
 * companion task ctq-117 — until then `query.error` will surface; the
 * UI degrades to an empty list.
 */
export function useRolePrompts(
  roleId: string,
): UseQueryResult<Prompt[], Error> {
  return useQuery({
    queryKey: rolesKeys.prompts(roleId),
    queryFn: () => listRolePrompts(roleId),
    enabled: roleId.length > 0,
  });
}

/**
 * `useAddRolePromptMutation` — attach a prompt to a role.
 * Invalidates the role-prompts list cache so the editor's section
 * reflects the new attachment without an extra round-trip.
 */
export function useAddRolePromptMutation(): UseMutationResult<
  void,
  Error,
  AddRolePromptArgs
> {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: addRolePrompt,
    onSuccess: (_void, vars) => {
      void queryClient.invalidateQueries({
        queryKey: rolesKeys.prompts(vars.roleId),
      });
    },
  });
}

/** `useRemoveRolePromptMutation` — detach + invalidate. */
export function useRemoveRolePromptMutation(): UseMutationResult<
  void,
  Error,
  RemoveRolePromptArgs
> {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: removeRolePrompt,
    onSuccess: (_void, vars) => {
      void queryClient.invalidateQueries({
        queryKey: rolesKeys.prompts(vars.roleId),
      });
    },
  });
}

export interface SetRolePromptsArgs {
  roleId: string;
  promptIds: string[];
}

/**
 * `useSetRolePromptsMutation` — bulk reorder.
 *
 * The cache layer keeps the optimistic order on success and rolls back
 * to the prior snapshot on error. Callers (drag-reorder) should call
 * `mutate` with the post-drop ordering; the hook does not perform an
 * optimistic swap on its own — keep the optimistic update at the call
 * site so the UI cycles through `pending → success/error` cleanly.
 *
 * TODO(ctq-108): backend handler `set_role_prompts` is not yet
 * implemented. Calls will fail at the IPC boundary until the bulk
 * setter ships; the rollback path makes the failure observable.
 */
export function useSetRolePromptsMutation(): UseMutationResult<
  void,
  Error,
  SetRolePromptsArgs
> {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ roleId, promptIds }) => setRolePrompts(roleId, promptIds),
    onSettled: (_void, _err, vars) => {
      void queryClient.invalidateQueries({
        queryKey: rolesKeys.prompts(vars.roleId),
      });
    },
  });
}

/**
 * `useRoleSkills` — skills attached to a role, ordered by position.
 *
 * TODO(ctq-117): backend handler `list_role_skills` not yet implemented.
 */
export function useRoleSkills(
  roleId: string,
): UseQueryResult<Skill[], Error> {
  return useQuery({
    queryKey: rolesKeys.skills(roleId),
    queryFn: () => listRoleSkills(roleId),
    enabled: roleId.length > 0,
  });
}

/** `useAddRoleSkillMutation` — attach + invalidate. */
export function useAddRoleSkillMutation(): UseMutationResult<
  void,
  Error,
  AddRoleSkillArgs
> {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: addRoleSkill,
    onSuccess: (_void, vars) => {
      void queryClient.invalidateQueries({
        queryKey: rolesKeys.skills(vars.roleId),
      });
    },
  });
}

/** `useRemoveRoleSkillMutation` — detach + invalidate. */
export function useRemoveRoleSkillMutation(): UseMutationResult<
  void,
  Error,
  RemoveRoleSkillArgs
> {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: removeRoleSkill,
    onSuccess: (_void, vars) => {
      void queryClient.invalidateQueries({
        queryKey: rolesKeys.skills(vars.roleId),
      });
    },
  });
}

export interface SetRoleSkillsArgs {
  roleId: string;
  /** Skills currently attached, in render order. */
  previous: ReadonlyArray<string>;
  /** Desired skill list, in render order. */
  next: ReadonlyArray<string>;
}

/**
 * `useSetRoleSkillsMutation` — bulk set the skill list of a role by
 * dispatching add/remove diffs against the existing per-row IPCs.
 * Used by the role-editor MultiSelect (audit-#8).
 */
export function useSetRoleSkillsMutation(): UseMutationResult<
  void,
  Error,
  SetRoleSkillsArgs
> {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ roleId, previous, next }) =>
      setRoleSkills(roleId, previous, next),
    onSettled: (_void, _err, vars) => {
      void queryClient.invalidateQueries({
        queryKey: rolesKeys.skills(vars.roleId),
      });
    },
  });
}

/**
 * `useRoleMcpTools` — MCP tools attached to a role, ordered by position.
 *
 * TODO(ctq-117): backend handler `list_role_mcp_tools` not yet implemented.
 */
export function useRoleMcpTools(
  roleId: string,
): UseQueryResult<McpTool[], Error> {
  return useQuery({
    queryKey: rolesKeys.mcpTools(roleId),
    queryFn: () => listRoleMcpTools(roleId),
    enabled: roleId.length > 0,
  });
}

/** `useAddRoleMcpToolMutation` — attach + invalidate. */
export function useAddRoleMcpToolMutation(): UseMutationResult<
  void,
  Error,
  AddRoleMcpToolArgs
> {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: addRoleMcpTool,
    onSuccess: (_void, vars) => {
      void queryClient.invalidateQueries({
        queryKey: rolesKeys.mcpTools(vars.roleId),
      });
    },
  });
}

/** `useRemoveRoleMcpToolMutation` — detach + invalidate. */
export function useRemoveRoleMcpToolMutation(): UseMutationResult<
  void,
  Error,
  RemoveRoleMcpToolArgs
> {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: removeRoleMcpTool,
    onSuccess: (_void, vars) => {
      void queryClient.invalidateQueries({
        queryKey: rolesKeys.mcpTools(vars.roleId),
      });
    },
  });
}

export interface SetRoleMcpToolsArgs {
  roleId: string;
  /** MCP tools currently attached, in render order. */
  previous: ReadonlyArray<string>;
  /** Desired MCP-tool list, in render order. */
  next: ReadonlyArray<string>;
}

/**
 * `useSetRoleMcpToolsMutation` — bulk set the MCP-tool list of a role
 * via diff-and-dispatch. Mirrors {@link useSetRoleSkillsMutation}.
 */
export function useSetRoleMcpToolsMutation(): UseMutationResult<
  void,
  Error,
  SetRoleMcpToolsArgs
> {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ roleId, previous, next }) =>
      setRoleMcpTools(roleId, previous, next),
    onSettled: (_void, _err, vars) => {
      void queryClient.invalidateQueries({
        queryKey: rolesKeys.mcpTools(vars.roleId),
      });
    },
  });
}
