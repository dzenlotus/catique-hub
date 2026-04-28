/**
 * Agent Reports query-cache layer.
 *
 * Built on `@tanstack/react-query`. Convention mirrors
 * `entities/board/model/store.ts`: query keys are tuples starting with
 * "agent_reports", mutations invalidate the relevant keys on success.
 *
 * The `["agent_reports"]` root key and the `byTask` / `detail` sub-keys
 * are also used by `EventsProvider` which invalidates them on
 * `agent_report.created`, `agent_report.updated`, and
 * `agent_report.deleted` realtime events — do not rename without
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
  createAgentReport,
  deleteAgentReport,
  getAgentReport,
  listAgentReports,
  updateAgentReport,
  type CreateAgentReportArgs,
  type UpdateAgentReportArgs,
} from "../api";
import type { AgentReport } from "./types";

/** Query-key factory. Centralised so invalidation stays consistent. */
export const agentReportsKeys = {
  all: ["agent_reports"] as const,
  list: () => [...agentReportsKeys.all] as const,
  byTask: (taskId: string) =>
    [...agentReportsKeys.all, "byTask", taskId] as const,
  detail: (id: string) => [...agentReportsKeys.all, "detail", id] as const,
};

/**
 * `useAgentReports` — list every report.
 *
 * Returns the standard react-query result. Consumers should branch on
 * `result.status` (`'pending' | 'error' | 'success'`).
 */
export function useAgentReports(): UseQueryResult<AgentReport[], Error> {
  return useQuery({
    queryKey: agentReportsKeys.list(),
    queryFn: listAgentReports,
  });
}

/**
 * `useAgentReportsByTask` — list reports for a specific task.
 *
 * Disabled when `taskId` is empty so mounting with no selection doesn't
 * fire an IPC call. The query fetches all reports and filters client-side
 * because the Rust `list_agent_reports` command has no task filter param.
 */
export function useAgentReportsByTask(
  taskId: string,
): UseQueryResult<AgentReport[], Error> {
  return useQuery({
    queryKey: agentReportsKeys.byTask(taskId),
    queryFn: async () => {
      const all = await listAgentReports();
      return all.filter((r) => r.taskId === taskId);
    },
    enabled: taskId.length > 0,
  });
}

/**
 * `useAgentReport` — fetch a single report. Disabled when `id` is empty
 * so mounting the hook with no selection doesn't fire an IPC call.
 */
export function useAgentReport(id: string): UseQueryResult<AgentReport, Error> {
  return useQuery({
    queryKey: agentReportsKeys.detail(id),
    queryFn: () => getAgentReport(id),
    enabled: id.length > 0,
  });
}

/**
 * `useCreateAgentReportMutation` — create a report, then invalidate the
 * list cache and the task-specific list so mounted queries re-fetch.
 */
export function useCreateAgentReportMutation(): UseMutationResult<
  AgentReport,
  Error,
  CreateAgentReportArgs
> {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: createAgentReport,
    onSuccess: (_data, input) => {
      void queryClient.invalidateQueries({
        queryKey: agentReportsKeys.byTask(input.taskId),
      });
      void queryClient.invalidateQueries({
        queryKey: agentReportsKeys.list(),
      });
    },
  });
}

/**
 * `useUpdateAgentReportMutation` — partial-update a report, then
 * invalidate the task list (from the response), the detail entry, and
 * the full list.
 */
export function useUpdateAgentReportMutation(): UseMutationResult<
  AgentReport,
  Error,
  UpdateAgentReportArgs
> {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: updateAgentReport,
    onSuccess: (updated) => {
      void queryClient.invalidateQueries({
        queryKey: agentReportsKeys.byTask(updated.taskId),
      });
      void queryClient.invalidateQueries({
        queryKey: agentReportsKeys.detail(updated.id),
      });
      void queryClient.invalidateQueries({
        queryKey: agentReportsKeys.list(),
      });
    },
  });
}

export interface DeleteAgentReportArgs {
  id: string;
  /** Providing `taskId` also invalidates the task-scoped list. */
  taskId?: string;
}

/**
 * `useDeleteAgentReportMutation` — delete a report, invalidate the
 * full list, optionally the task-scoped list, and remove the detail
 * entry from the cache.
 */
export function useDeleteAgentReportMutation(): UseMutationResult<
  void,
  Error,
  DeleteAgentReportArgs
> {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id }) => deleteAgentReport(id),
    onSuccess: (_data, { id, taskId }) => {
      void queryClient.invalidateQueries({
        queryKey: agentReportsKeys.list(),
      });
      if (taskId !== undefined) {
        void queryClient.invalidateQueries({
          queryKey: agentReportsKeys.byTask(taskId),
        });
      }
      queryClient.removeQueries({ queryKey: agentReportsKeys.detail(id) });
    },
  });
}
