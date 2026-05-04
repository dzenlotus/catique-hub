/**
 * Prompts query-cache layer.
 *
 * Built on `@tanstack/react-query`. Query keys under `["prompts"]` are
 * already targeted by `EventsProvider` for cache-invalidation on
 * `prompt.created`, `prompt.updated`, and `prompt.deleted` events.
 */

import {
  useMutation,
  useQuery,
  useQueryClient,
  type UseMutationResult,
  type UseQueryResult,
} from "@tanstack/react-query";

import {
  createPrompt,
  deletePrompt,
  getPrompt,
  listPrompts,
  listPromptTagsMap,
  updatePrompt,
  recomputePromptTokenCount,
  type CreatePromptArgs,
  type UpdatePromptArgs,
} from "../api";
import type { Prompt } from "./types";
import type { PromptTagMapEntry } from "@bindings/PromptTagMapEntry";

/** Query-key factory. Centralised so invalidation stays consistent. */
export const promptsKeys = {
  all: ["prompts"] as const,
  list: () => [...promptsKeys.all] as const,
  detail: (id: string) => [...promptsKeys.all, id] as const,
  tagMap: () => [...promptsKeys.all, "tagMap"] as const,
};

/** `usePrompts` — list every prompt. */
export function usePrompts(): UseQueryResult<Prompt[], Error> {
  return useQuery({
    queryKey: promptsKeys.list(),
    queryFn: listPrompts,
  });
}

/**
 * `usePromptTagsMap` — bulk fetch of every `(promptId, tagIds[])` entry.
 *
 * Stale-time is generous (30 s) because tag attachments change infrequently;
 * `add_prompt_tag` / `remove_prompt_tag` handlers should invalidate
 * `["prompts","tagMap"]` when wired to mutations (future work).
 */
export function usePromptTagsMap(): UseQueryResult<PromptTagMapEntry[], Error> {
  return useQuery({
    queryKey: promptsKeys.tagMap(),
    queryFn: listPromptTagsMap,
    staleTime: 30_000,
  });
}

/** `usePrompt` — fetch a single prompt. Disabled when `id` is empty. */
export function usePrompt(id: string): UseQueryResult<Prompt, Error> {
  return useQuery({
    queryKey: promptsKeys.detail(id),
    queryFn: () => getPrompt(id),
    enabled: id.length > 0,
  });
}

/**
 * `useCreatePromptMutation` — create a prompt, invalidate the list,
 * then fire a fire-and-forget `recompute_prompt_token_count` so the new
 * prompt's count is filled in without the user having to press
 * "Recount" (round-19d).
 */
export function useCreatePromptMutation(): UseMutationResult<
  Prompt,
  Error,
  CreatePromptArgs
> {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: createPrompt,
    onSuccess: (created) => {
      void queryClient.invalidateQueries({ queryKey: promptsKeys.list() });
      void recomputePromptTokenCount(created.id)
        .then(() => {
          void queryClient.invalidateQueries({
            queryKey: promptsKeys.detail(created.id),
          });
          void queryClient.invalidateQueries({
            queryKey: promptsKeys.list(),
          });
        })
        .catch(() => {
          // Silent: count stays absent until the user clicks Recount.
        });
    },
  });
}

/**
 * `useUpdatePromptMutation` — partial update, invalidates list + detail
 * on success.
 *
 * Round-19d: when the update touches `content`, fire a follow-up
 * `recompute_prompt_token_count` so the displayed token count reflects
 * the new body without the user having to press "Recount". The recount
 * IPC is fire-and-forget — failures don't roll back the save, they just
 * leave the count stale until the next manual recount.
 */
export function useUpdatePromptMutation(): UseMutationResult<
  Prompt,
  Error,
  UpdatePromptArgs
> {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: updatePrompt,
    onSuccess: (updated, vars) => {
      void queryClient.invalidateQueries({ queryKey: promptsKeys.list() });
      void queryClient.invalidateQueries({
        queryKey: promptsKeys.detail(updated.id),
      });
      if (vars.content !== undefined) {
        void recomputePromptTokenCount(updated.id)
          .then(() => {
            void queryClient.invalidateQueries({
              queryKey: promptsKeys.detail(updated.id),
            });
            void queryClient.invalidateQueries({
              queryKey: promptsKeys.list(),
            });
          })
          .catch(() => {
            // Silent: count stays stale, next manual recount fixes it.
          });
      }
    },
  });
}

/**
 * `useDeletePromptMutation` — delete a prompt, then invalidates the list and
 * removes the detail cache entry.
 */
export function useDeletePromptMutation(): UseMutationResult<
  void,
  Error,
  string
> {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => deletePrompt(id),
    onSuccess: (_data, id) => {
      void queryClient.invalidateQueries({ queryKey: promptsKeys.list() });
      queryClient.removeQueries({ queryKey: promptsKeys.detail(id) });
    },
  });
}

/**
 * `useRecomputePromptTokenCountMutation` — trigger a backend recount of the
 * token count for a prompt. On success, invalidates both the detail and list
 * caches so every visible PromptCard picks up the fresh count.
 */
export function useRecomputePromptTokenCountMutation(): UseMutationResult<
  Prompt,
  Error,
  string
> {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => recomputePromptTokenCount(id),
    onSuccess: (updated) => {
      void queryClient.invalidateQueries({
        queryKey: promptsKeys.detail(updated.id),
      });
      void queryClient.invalidateQueries({ queryKey: promptsKeys.list() });
    },
  });
}
