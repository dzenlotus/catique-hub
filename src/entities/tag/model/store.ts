/**
 * Tags query-cache layer.
 *
 * Built on `@tanstack/react-query`. Follows the same conventions as
 * `entities/board/model/store.ts`: query keys as a factory object,
 * list + detail queries, and mutation hooks that invalidate on success.
 *
 * EventsProvider (app/providers/EventsProvider.tsx) already invalidates
 * `["tags"]` on `tag.*` events — no extra wiring needed here.
 */

import {
  useMutation,
  useQuery,
  useQueryClient,
  type UseMutationResult,
  type UseQueryResult,
} from "@tanstack/react-query";

import {
  createTag,
  deleteTag,
  getTag,
  listTags,
  updateTag,
  type CreateTagArgs,
  type UpdateTagArgs,
} from "../api";
import type { Tag } from "./types";

/** Query-key factory. Centralised so invalidation stays consistent. */
export const tagsKeys = {
  all: ["tags"] as const,
  list: () => [...tagsKeys.all] as const,
  detail: (id: string) => [...tagsKeys.all, id] as const,
};

/** `useTags` — list every tag. */
export function useTags(): UseQueryResult<Tag[], Error> {
  return useQuery({
    queryKey: tagsKeys.list(),
    queryFn: listTags,
  });
}

/** `useTag` — fetch a single tag. Disabled when `id` is empty. */
export function useTag(id: string): UseQueryResult<Tag, Error> {
  return useQuery({
    queryKey: tagsKeys.detail(id),
    queryFn: () => getTag(id),
    enabled: id.length > 0,
  });
}

/** `useCreateTagMutation` — create a tag, then invalidate the list cache. */
export function useCreateTagMutation(): UseMutationResult<
  Tag,
  Error,
  CreateTagArgs
> {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: createTag,
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: tagsKeys.list() });
    },
  });
}

/** `useUpdateTagMutation` — partial-update a tag, then invalidate list + detail. */
export function useUpdateTagMutation(): UseMutationResult<
  Tag,
  Error,
  UpdateTagArgs
> {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: updateTag,
    onSuccess: (tag) => {
      void queryClient.invalidateQueries({ queryKey: tagsKeys.list() });
      void queryClient.invalidateQueries({
        queryKey: tagsKeys.detail(tag.id),
      });
    },
  });
}

/** `useDeleteTagMutation` — delete a tag, then invalidate the list cache. */
export function useDeleteTagMutation(): UseMutationResult<
  void,
  Error,
  string
> {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: deleteTag,
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: tagsKeys.list() });
    },
  });
}
