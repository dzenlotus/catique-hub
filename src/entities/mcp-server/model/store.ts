/**
 * MCP Servers query-cache layer.
 *
 * Built on `@tanstack/react-query`. Convention mirrors
 * `entities/mcp-tool/model/store.ts`: query keys are tuples starting
 * with "mcp_servers", mutations invalidate the relevant key on success
 * so any mounted hook re-fetches automatically.
 *
 * The `["mcp_servers"]` root key is also used by `EventsProvider`,
 * which invalidates it on `mcp_server:*` realtime events — do not
 * rename without updating that provider.
 *
 * `useMcpToolsByServer` lives in the *server* slice (not the
 * tool slice) because the IPC command is server-scoped and the
 * invalidation chain is driven by `mcp_server:*` events. The shape it
 * returns is `McpTool[]` so callers can still treat the rows as plain
 * tool records.
 */

import {
  useMutation,
  useQuery,
  useQueryClient,
  type UseMutationResult,
  type UseQueryResult,
} from "@tanstack/react-query";

import type { McpTool } from "@bindings/McpTool";

import {
  createMcpServer,
  deleteMcpServer,
  getMcpServer,
  getMcpServerStatus,
  listMcpServers,
  listMcpToolsByServer,
  refreshMcpServer,
  updateMcpServer,
  listRoleMcpServers,
  setRoleMcpServers,
  listBoardMcpServers,
  setBoardMcpServers,
  listTaskMcpServers,
  setTaskMcpServers,
  type CreateMcpServerArgs,
  type UpdateMcpServerArgs,
} from "../api";
import type {
  McpServer,
  McpServerStatus,
  RefreshReport,
} from "./types";

/** Query-key factory. Centralised so invalidation stays consistent. */
export const mcpServersKeys = {
  all: ["mcp_servers"] as const,
  list: () => [...mcpServersKeys.all] as const,
  detail: (id: string) => [...mcpServersKeys.all, id] as const,
  status: (id: string) => [...mcpServersKeys.all, id, "status"] as const,
  tools: (id: string) => [...mcpServersKeys.all, id, "tools"] as const,
  /** Servers attached as live units at a scope (Phase C). */
  roleAttached: (roleId: string) =>
    [...mcpServersKeys.all, "attached", "role", roleId] as const,
  boardAttached: (boardId: string) =>
    [...mcpServersKeys.all, "attached", "board", boardId] as const,
  taskAttached: (taskId: string) =>
    [...mcpServersKeys.all, "attached", "task", taskId] as const,
};

/** `useMcpServers` — list every registered MCP server. */
export function useMcpServers(): UseQueryResult<McpServer[], Error> {
  return useQuery({
    queryKey: mcpServersKeys.list(),
    queryFn: listMcpServers,
  });
}

/**
 * `useMcpServer` — fetch a single server. Disabled while `id` is empty
 * so mounting the hook without a selection does not fire an IPC call.
 */
export function useMcpServer(id: string): UseQueryResult<McpServer, Error> {
  return useQuery({
    queryKey: mcpServersKeys.detail(id),
    queryFn: () => getMcpServer(id),
    enabled: id.length > 0,
  });
}

/**
 * `useMcpServerStatus` — live status for one server (health dot data).
 *
 * Disabled while `id` is empty. Status refetches are driven by the
 * `mcp_server:updated` event invalidation in `EventsProvider`, plus an
 * explicit one-shot refetch the create-dialog triggers after a ~1 s
 * delay so the introspect-on-create result lights up the dot.
 */
export function useMcpServerStatus(
  id: string,
): UseQueryResult<McpServerStatus, Error> {
  return useQuery({
    queryKey: mcpServersKeys.status(id),
    queryFn: () => getMcpServerStatus(id),
    enabled: id.length > 0,
  });
}

/** `useMcpToolsByServer` — tools belonging to one server. */
export function useMcpToolsByServer(
  serverId: string,
): UseQueryResult<McpTool[], Error> {
  return useQuery({
    queryKey: mcpServersKeys.tools(serverId),
    queryFn: () => listMcpToolsByServer(serverId),
    enabled: serverId.length > 0,
  });
}

/**
 * `useCreateMcpServerMutation` — create a server. Invalidates the
 * list cache so any mounted `useMcpServers()` re-fetches.
 */
export function useCreateMcpServerMutation(): UseMutationResult<
  McpServer,
  Error,
  CreateMcpServerArgs
> {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: createMcpServer,
    onSuccess: (created) => {
      void queryClient.invalidateQueries({ queryKey: mcpServersKeys.list() });
      // Seed the detail cache so the page can read the new row
      // immediately without a round-trip.
      queryClient.setQueryData(mcpServersKeys.detail(created.id), created);
    },
  });
}

/**
 * `useUpdateMcpServerMutation` — partial update. Invalidates the list
 * and the affected detail entry.
 */
export function useUpdateMcpServerMutation(): UseMutationResult<
  McpServer,
  Error,
  UpdateMcpServerArgs
> {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: updateMcpServer,
    onSuccess: (updated) => {
      void queryClient.invalidateQueries({ queryKey: mcpServersKeys.list() });
      void queryClient.invalidateQueries({
        queryKey: mcpServersKeys.detail(updated.id),
      });
    },
  });
}

/**
 * `useRefreshMcpServerMutation` — manual upstream refresh. Invalidates
 * the per-server tool list and status so the UI mirrors the new
 * inventory + lastSyncedAt timestamp. Returns the count summary so
 * callers can surface it in a toast.
 */
export function useRefreshMcpServerMutation(): UseMutationResult<
  RefreshReport,
  Error,
  string
> {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: refreshMcpServer,
    onSuccess: (_report, id) => {
      void queryClient.invalidateQueries({
        queryKey: mcpServersKeys.tools(id),
      });
      void queryClient.invalidateQueries({
        queryKey: mcpServersKeys.status(id),
      });
    },
  });
}

/**
 * `useDeleteMcpServerMutation` — delete a server. Invalidates the list
 * and drops the stale detail/status/tools entries from the cache.
 */
export function useDeleteMcpServerMutation(): UseMutationResult<
  void,
  Error,
  string
> {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: deleteMcpServer,
    onSuccess: (_data, id) => {
      void queryClient.invalidateQueries({ queryKey: mcpServersKeys.list() });
      queryClient.removeQueries({ queryKey: mcpServersKeys.detail(id) });
      queryClient.removeQueries({ queryKey: mcpServersKeys.status(id) });
      queryClient.removeQueries({ queryKey: mcpServersKeys.tools(id) });
    },
  });
}

// ── server-as-live-unit attachment (Phase C) ────────────────────────

/** `useRoleMcpServers` — server ids attached to a role. */
export function useRoleMcpServers(
  roleId: string,
): UseQueryResult<string[], Error> {
  return useQuery({
    queryKey: mcpServersKeys.roleAttached(roleId),
    queryFn: () => listRoleMcpServers(roleId),
    enabled: roleId.length > 0,
  });
}

/** `useBoardMcpServers` — server ids attached to a board. */
export function useBoardMcpServers(
  boardId: string,
): UseQueryResult<string[], Error> {
  return useQuery({
    queryKey: mcpServersKeys.boardAttached(boardId),
    queryFn: () => listBoardMcpServers(boardId),
    enabled: boardId.length > 0,
  });
}

/** `useTaskMcpServers` — server ids attached to a task. */
export function useTaskMcpServers(
  taskId: string,
): UseQueryResult<string[], Error> {
  return useQuery({
    queryKey: mcpServersKeys.taskAttached(taskId),
    queryFn: () => listTaskMcpServers(taskId),
    enabled: taskId.length > 0,
  });
}

interface SetScopeServersArgs {
  id: string;
  serverIds: string[];
}

function invalidateServerAttach(
  queryClient: ReturnType<typeof useQueryClient>,
  attachedKey: readonly unknown[],
): void {
  void queryClient.invalidateQueries({ queryKey: attachedKey });
  void queryClient.invalidateQueries({ queryKey: ["tasks"] });
}

/** `useSetRoleMcpServersMutation` — replace a role's attached servers. */
export function useSetRoleMcpServersMutation(): UseMutationResult<
  void,
  Error,
  SetScopeServersArgs
> {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, serverIds }) => setRoleMcpServers(id, serverIds),
    onSettled: (_v, _e, args) => {
      invalidateServerAttach(queryClient, mcpServersKeys.roleAttached(args.id));
    },
  });
}

/** `useSetBoardMcpServersMutation` — replace a board's attached servers. */
export function useSetBoardMcpServersMutation(): UseMutationResult<
  void,
  Error,
  SetScopeServersArgs
> {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, serverIds }) => setBoardMcpServers(id, serverIds),
    onSettled: (_v, _e, args) => {
      invalidateServerAttach(queryClient, mcpServersKeys.boardAttached(args.id));
    },
  });
}

/** `useSetTaskMcpServersMutation` — replace a task's attached servers. */
export function useSetTaskMcpServersMutation(): UseMutationResult<
  void,
  Error,
  SetScopeServersArgs
> {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, serverIds }) => setTaskMcpServers(id, serverIds),
    onSettled: (_v, _e, args) => {
      invalidateServerAttach(queryClient, mcpServersKeys.taskAttached(args.id));
    },
  });
}
