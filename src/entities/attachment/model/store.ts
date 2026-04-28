/**
 * Attachments query-cache layer.
 *
 * Built on `@tanstack/react-query`. Convention mirrors `entities/role/model/store.ts`:
 * query keys are tuples starting with "attachments", mutations invalidate
 * the relevant keys on success so any mounted hooks re-fetch automatically.
 *
 * The `["attachments"]` root key is also used by `EventsProvider` which
 * invalidates it on `attachment.created`, `attachment.updated`, and
 * `attachment.deleted` realtime events — do not rename without updating
 * that provider.
 */

import {
  useMutation,
  useQuery,
  useQueryClient,
  type UseMutationResult,
  type UseQueryResult,
} from "@tanstack/react-query";

import { listAttachments, getAttachment, deleteAttachment } from "../api";
import type { Attachment } from "./types";

/** Query-key factory. Centralised so invalidation stays consistent. */
export const attachmentsKeys = {
  all: ["attachments"] as const,
  list: () => [...attachmentsKeys.all] as const,
  byTask: (taskId: string) =>
    [...attachmentsKeys.all, "byTask", taskId] as const,
  detail: (id: string) => [...attachmentsKeys.all, "detail", id] as const,
};

/**
 * `useAttachments` — list every attachment.
 *
 * Returns the standard react-query result. Consumers should branch on
 * `result.status` (`'pending' | 'error' | 'success'`).
 */
export function useAttachments(): UseQueryResult<Attachment[], Error> {
  return useQuery({
    queryKey: attachmentsKeys.list(),
    queryFn: listAttachments,
  });
}

/**
 * `useAttachmentsByTask` — fetch attachments filtered by task id.
 *
 * Fetches the full list from the backend and filters client-side.
 * Disabled when `taskId` is empty so mounting without a selection
 * doesn't fire an IPC call.
 */
export function useAttachmentsByTask(
  taskId: string,
): UseQueryResult<Attachment[], Error> {
  return useQuery({
    queryKey: attachmentsKeys.byTask(taskId),
    queryFn: async () => {
      const all = await listAttachments();
      return all.filter((a) => a.taskId === taskId);
    },
    enabled: taskId.length > 0,
  });
}

/**
 * `useAttachment` — fetch a single attachment. Disabled when `id` is
 * empty so mounting the hook with no selection doesn't fire an IPC call.
 */
export function useAttachment(id: string): UseQueryResult<Attachment, Error> {
  return useQuery({
    queryKey: attachmentsKeys.detail(id),
    queryFn: () => getAttachment(id),
    enabled: id.length > 0,
  });
}

/**
 * `useDeleteAttachmentMutation` — delete an attachment, then invalidate
 * the byTask list and the all list so mounted hooks re-fetch, and
 * remove the stale detail entry from the cache.
 */
export function useDeleteAttachmentMutation(): UseMutationResult<
  void,
  Error,
  string
> {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: deleteAttachment,
    onSuccess: (_data, id) => {
      void queryClient.invalidateQueries({ queryKey: attachmentsKeys.list() });
      // Invalidate all byTask sub-keys (we don't know the taskId here).
      void queryClient.invalidateQueries({
        queryKey: [...attachmentsKeys.all, "byTask"],
      });
      queryClient.removeQueries({ queryKey: attachmentsKeys.detail(id) });
    },
  });
}
