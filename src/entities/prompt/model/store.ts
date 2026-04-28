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
  updatePrompt,
  recomputePromptTokenCount,
  type CreatePromptArgs,
  type UpdatePromptArgs,
} from "../api";
import type { Prompt } from "./types";

/** Query-key factory. Centralised so invalidation stays consistent. */
export const promptsKeys = {
  all: ["prompts"] as const,
  list: () => [...promptsKeys.all] as const,
  detail: (id: string) => [...promptsKeys.all, id] as const,
};

/** `usePrompts` — list every prompt. */
export function usePrompts(): UseQueryResult<Prompt[], Error> {
  return useQuery({
    queryKey: promptsKeys.list(),
    queryFn: listPrompts,
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

/** `useCreatePromptMutation` — create a prompt, then invalidate the list cache. */
export function useCreatePromptMutation(): UseMutationResult<
  Prompt,
  Error,
  CreatePromptArgs
> {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: createPrompt,
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: promptsKeys.list() });
    },
  });
}

/** `useUpdatePromptMutation` — partial update, invalidates list + detail on success. */
export function useUpdatePromptMutation(): UseMutationResult<
  Prompt,
  Error,
  UpdatePromptArgs
> {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: updatePrompt,
    onSuccess: (updated) => {
      void queryClient.invalidateQueries({ queryKey: promptsKeys.list() });
      void queryClient.invalidateQueries({
        queryKey: promptsKeys.detail(updated.id),
      });
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
