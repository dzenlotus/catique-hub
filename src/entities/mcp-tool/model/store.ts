/**
 * MCP Tools query-cache layer.
 *
 * Built on `@tanstack/react-query`. Convention mirrors `entities/role/model/store.ts`:
 * query keys are tuples starting with "mcp_tools", mutations invalidate the
 * list key on success so any mounted `useMcpTools()` re-fetches automatically.
 *
 * The `["mcp_tools"]` root key is also used by `EventsProvider` which
 * invalidates it on `mcp_tool.*` realtime events — do not rename without
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
  createMcpTool,
  deleteMcpTool,
  getMcpTool,
  listMcpTools,
  updateMcpTool,
  type CreateMcpToolArgs,
  type UpdateMcpToolArgs,
} from "../api";
import type { McpTool } from "./types";

/** Query-key factory. Centralised so invalidation stays consistent. */
export const mcpToolsKeys = {
  all: ["mcp_tools"] as const,
  list: () => [...mcpToolsKeys.all] as const,
  detail: (id: string) => [...mcpToolsKeys.all, id] as const,
};

/**
 * `useMcpTools` — list every MCP tool.
 *
 * Returns the standard react-query result. Consumers should branch on
 * `result.status` (`'pending' | 'error' | 'success'`).
 */
export function useMcpTools(): UseQueryResult<McpTool[], Error> {
  return useQuery({
    queryKey: mcpToolsKeys.list(),
    queryFn: listMcpTools,
  });
}

/**
 * `useMcpTool` — fetch a single MCP tool. Disabled when `id` is empty so
 * mounting the hook with no selection doesn't fire an IPC call.
 */
export function useMcpTool(id: string): UseQueryResult<McpTool, Error> {
  return useQuery({
    queryKey: mcpToolsKeys.detail(id),
    queryFn: () => getMcpTool(id),
    enabled: id.length > 0,
  });
}

/**
 * `useCreateMcpToolMutation` — create a MCP tool, then invalidate the list
 * cache so any mounted `useMcpTools()` re-fetches.
 */
export function useCreateMcpToolMutation(): UseMutationResult<
  McpTool,
  Error,
  CreateMcpToolArgs
> {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: createMcpTool,
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: mcpToolsKeys.list() });
    },
  });
}

/**
 * `useUpdateMcpToolMutation` — partial-update a MCP tool, then invalidate list
 * and the specific detail entry.
 */
export function useUpdateMcpToolMutation(): UseMutationResult<
  McpTool,
  Error,
  UpdateMcpToolArgs
> {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: updateMcpTool,
    onSuccess: (updated) => {
      void queryClient.invalidateQueries({ queryKey: mcpToolsKeys.list() });
      void queryClient.invalidateQueries({
        queryKey: mcpToolsKeys.detail(updated.id),
      });
    },
  });
}

/**
 * `useDeleteMcpToolMutation` — delete a MCP tool, invalidate the list, and
 * remove the stale detail entry from the cache.
 */
export function useDeleteMcpToolMutation(): UseMutationResult<void, Error, string> {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: deleteMcpTool,
    onSuccess: (_data, id) => {
      void queryClient.invalidateQueries({ queryKey: mcpToolsKeys.list() });
      queryClient.removeQueries({ queryKey: mcpToolsKeys.detail(id) });
    },
  });
}
