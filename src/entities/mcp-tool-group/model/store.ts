/**
 * McpToolGroups query-cache layer — the MCP mirror of
 * `entities/prompt-group/model/store.ts`. Same keying + invalidation
 * conventions. `EventsProvider` invalidates the `["mcp_tool_groups"]`
 * root on `mcp_tool_group:*` realtime events.
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
  addMcpToolGroupMember,
  createMcpToolGroup,
  deleteMcpToolGroup,
  getMcpToolGroup,
  listBoardMcpToolGroups,
  listMcpToolGroupMembers,
  listMcpToolGroups,
  listRoleMcpToolGroups,
  listTaskMcpToolGroups,
  removeMcpToolGroupMember,
  setBoardMcpToolGroups,
  setMcpToolGroupMembers,
  setRoleMcpToolGroups,
  setTaskMcpToolGroups,
  updateMcpToolGroup,
  type AddMcpToolGroupMemberArgs,
  type CreateMcpToolGroupArgs,
  type RemoveMcpToolGroupMemberArgs,
  type SetMcpToolGroupMembersArgs,
  type UpdateMcpToolGroupArgs,
} from "../api";
import type { McpToolGroup } from "./types";

/** Query-key factory. */
export const mcpToolGroupsKeys = {
  all: ["mcp_tool_groups"] as const,
  list: () => [...mcpToolGroupsKeys.all] as const,
  detail: (id: string) => [...mcpToolGroupsKeys.all, id] as const,
  members: (groupId: string) =>
    [...mcpToolGroupsKeys.all, "members", groupId] as const,
  roleAttached: (roleId: string) =>
    [...mcpToolGroupsKeys.all, "attached", "role", roleId] as const,
  boardAttached: (boardId: string) =>
    [...mcpToolGroupsKeys.all, "attached", "board", boardId] as const,
  taskAttached: (taskId: string) =>
    [...mcpToolGroupsKeys.all, "attached", "task", taskId] as const,
};

function invalidateAttach(
  queryClient: ReturnType<typeof useQueryClient>,
  attachedKey: readonly unknown[],
): void {
  void queryClient.invalidateQueries({ queryKey: attachedKey });
  void queryClient.invalidateQueries({ queryKey: ["tasks"] });
}

/** `useMcpToolGroups` — list every MCP tool group. */
export function useMcpToolGroups(): UseQueryResult<McpToolGroup[], Error> {
  return useQuery({
    queryKey: mcpToolGroupsKeys.list(),
    queryFn: listMcpToolGroups,
  });
}

/** `useMcpToolGroup` — fetch a single group. Disabled when `id` empty. */
export function useMcpToolGroup(
  id: string,
): UseQueryResult<McpToolGroup, Error> {
  return useQuery({
    queryKey: mcpToolGroupsKeys.detail(id),
    queryFn: () => getMcpToolGroup(id),
    enabled: id.length > 0,
  });
}

/** `useMcpToolGroupMembers` — ordered mcp-tool ids for a group. */
export function useMcpToolGroupMembers(
  groupId: string,
): UseQueryResult<string[], Error> {
  return useQuery({
    queryKey: mcpToolGroupsKeys.members(groupId),
    queryFn: () => listMcpToolGroupMembers(groupId),
    enabled: groupId.length > 0,
  });
}

/**
 * `useMcpToolGroupMembersMap` — members for several groups at once
 * (shares the per-group `members` cache). Used by the combined MCP picker
 * to hide tools already covered by an attached group.
 */
export function useMcpToolGroupMembersMap(
  groupIds: readonly string[],
): Record<string, string[]> {
  const results = useQueries({
    queries: groupIds.map((gid) => ({
      queryKey: mcpToolGroupsKeys.members(gid),
      queryFn: () => listMcpToolGroupMembers(gid),
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

export function useCreateMcpToolGroupMutation(): UseMutationResult<
  McpToolGroup,
  Error,
  CreateMcpToolGroupArgs
> {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: createMcpToolGroup,
    onSuccess: () => {
      void queryClient.invalidateQueries({
        queryKey: mcpToolGroupsKeys.list(),
      });
    },
  });
}

export function useUpdateMcpToolGroupMutation(): UseMutationResult<
  McpToolGroup,
  Error,
  UpdateMcpToolGroupArgs
> {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: updateMcpToolGroup,
    onSuccess: (updated) => {
      void queryClient.invalidateQueries({
        queryKey: mcpToolGroupsKeys.list(),
      });
      void queryClient.invalidateQueries({
        queryKey: mcpToolGroupsKeys.detail(updated.id),
      });
    },
  });
}

export function useDeleteMcpToolGroupMutation(): UseMutationResult<
  void,
  Error,
  string
> {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: deleteMcpToolGroup,
    onSuccess: (_data, id) => {
      void queryClient.invalidateQueries({
        queryKey: mcpToolGroupsKeys.list(),
      });
      queryClient.removeQueries({ queryKey: mcpToolGroupsKeys.detail(id) });
      void queryClient.invalidateQueries({ queryKey: ["tasks"] });
    },
  });
}

export function useAddMcpToolGroupMemberMutation(): UseMutationResult<
  void,
  Error,
  AddMcpToolGroupMemberArgs
> {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: addMcpToolGroupMember,
    onSuccess: (_data, args) => {
      void queryClient.invalidateQueries({
        queryKey: mcpToolGroupsKeys.members(args.groupId),
      });
      void queryClient.invalidateQueries({
        queryKey: mcpToolGroupsKeys.list(),
      });
      void queryClient.invalidateQueries({ queryKey: ["tasks"] });
    },
  });
}

export function useRemoveMcpToolGroupMemberMutation(): UseMutationResult<
  void,
  Error,
  RemoveMcpToolGroupMemberArgs
> {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: removeMcpToolGroupMember,
    onSuccess: (_data, args) => {
      void queryClient.invalidateQueries({
        queryKey: mcpToolGroupsKeys.members(args.groupId),
      });
      void queryClient.invalidateQueries({
        queryKey: mcpToolGroupsKeys.list(),
      });
      void queryClient.invalidateQueries({ queryKey: ["tasks"] });
    },
  });
}

export function useSetMcpToolGroupMembersMutation(): UseMutationResult<
  void,
  Error,
  SetMcpToolGroupMembersArgs
> {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: setMcpToolGroupMembers,
    onSuccess: (_data, args) => {
      void queryClient.invalidateQueries({
        queryKey: mcpToolGroupsKeys.members(args.groupId),
      });
      void queryClient.invalidateQueries({
        queryKey: mcpToolGroupsKeys.list(),
      });
      void queryClient.invalidateQueries({ queryKey: ["tasks"] });
    },
  });
}

// ── group attachment ─────────────────────────────────────────────────

export function useRoleMcpToolGroups(
  roleId: string,
): UseQueryResult<string[], Error> {
  return useQuery({
    queryKey: mcpToolGroupsKeys.roleAttached(roleId),
    queryFn: () => listRoleMcpToolGroups(roleId),
    enabled: roleId.length > 0,
  });
}

export function useBoardMcpToolGroups(
  boardId: string,
): UseQueryResult<string[], Error> {
  return useQuery({
    queryKey: mcpToolGroupsKeys.boardAttached(boardId),
    queryFn: () => listBoardMcpToolGroups(boardId),
    enabled: boardId.length > 0,
  });
}

export function useTaskMcpToolGroups(
  taskId: string,
): UseQueryResult<string[], Error> {
  return useQuery({
    queryKey: mcpToolGroupsKeys.taskAttached(taskId),
    queryFn: () => listTaskMcpToolGroups(taskId),
    enabled: taskId.length > 0,
  });
}

interface SetScopeGroupsArgs {
  id: string;
  groupIds: string[];
}

export function useSetRoleMcpToolGroupsMutation(): UseMutationResult<
  void,
  Error,
  SetScopeGroupsArgs
> {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, groupIds }) => setRoleMcpToolGroups(id, groupIds),
    onSettled: (_v, _e, args) => {
      invalidateAttach(queryClient, mcpToolGroupsKeys.roleAttached(args.id));
    },
  });
}

export function useSetBoardMcpToolGroupsMutation(): UseMutationResult<
  void,
  Error,
  SetScopeGroupsArgs
> {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, groupIds }) => setBoardMcpToolGroups(id, groupIds),
    onSettled: (_v, _e, args) => {
      invalidateAttach(queryClient, mcpToolGroupsKeys.boardAttached(args.id));
    },
  });
}

export function useSetTaskMcpToolGroupsMutation(): UseMutationResult<
  void,
  Error,
  SetScopeGroupsArgs
> {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, groupIds }) => setTaskMcpToolGroups(id, groupIds),
    onSettled: (_v, _e, args) => {
      invalidateAttach(queryClient, mcpToolGroupsKeys.taskAttached(args.id));
    },
  });
}
