/**
 * Spaces query-cache layer.
 *
 * Built on `@tanstack/react-query`. Convention mirrors `entities/board/model/store.ts`:
 * query keys are tuples starting with "spaces", mutations invalidate the
 * list key on success so any mounted `useSpaces()` re-fetches automatically.
 *
 * The `["spaces"]` root key is also used by `EventsProvider` which
 * invalidates it on `space.created`, `space.updated`, and `space.deleted`
 * realtime events — do not rename without updating that provider.
 *
 * `spacesKeys` is the canonical definition. `src/shared/lib/firstLaunch.ts`
 * re-imports it from here (via `@entities/space`) so there is a single
 * source of truth.
 */

import {
  useMutation,
  useQuery,
  useQueryClient,
  type UseMutationResult,
  type UseQueryResult,
} from "@tanstack/react-query";

import {
  createSpace,
  deleteSpace,
  getSpace,
  listSpaces,
  updateSpace,
  type CreateSpaceArgs,
  type UpdateSpaceArgs,
} from "../api";
import type { Space } from "./types";

/** Query-key factory. Centralised so invalidation stays consistent. */
export const spacesKeys = {
  all: ["spaces"] as const,
  list: () => [...spacesKeys.all] as const,
  detail: (id: string) => [...spacesKeys.all, id] as const,
};

/**
 * `useSpaces` — list every space.
 *
 * Returns the standard react-query result. Consumers should branch on
 * `result.status` (`'pending' | 'error' | 'success'`).
 */
export function useSpaces(): UseQueryResult<Space[], Error> {
  return useQuery({
    queryKey: spacesKeys.list(),
    queryFn: listSpaces,
  });
}

/**
 * `useSpace` — fetch a single space. Disabled when `id` is empty so
 * mounting the hook with no selection doesn't fire an IPC call.
 */
export function useSpace(id: string): UseQueryResult<Space, Error> {
  return useQuery({
    queryKey: spacesKeys.detail(id),
    queryFn: () => getSpace(id),
    enabled: id.length > 0,
  });
}

/**
 * `useCreateSpaceMutation` — create a space, then invalidate the list
 * cache so any mounted `useSpaces()` re-fetches.
 */
export function useCreateSpaceMutation(): UseMutationResult<
  Space,
  Error,
  CreateSpaceArgs
> {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: createSpace,
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: spacesKeys.list() });
    },
  });
}

/**
 * `useUpdateSpaceMutation` — partial-update a space, then invalidate list
 * and the specific detail entry.
 */
export function useUpdateSpaceMutation(): UseMutationResult<
  Space,
  Error,
  UpdateSpaceArgs
> {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: updateSpace,
    onSuccess: (updated) => {
      void queryClient.invalidateQueries({ queryKey: spacesKeys.list() });
      void queryClient.invalidateQueries({
        queryKey: spacesKeys.detail(updated.id),
      });
    },
  });
}

/**
 * `useDeleteSpaceMutation` — delete a space, invalidate the list, and
 * remove the stale detail entry from the cache.
 */
export function useDeleteSpaceMutation(): UseMutationResult<void, Error, string> {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: deleteSpace,
    onSuccess: (_data, id) => {
      void queryClient.invalidateQueries({ queryKey: spacesKeys.list() });
      queryClient.removeQueries({ queryKey: spacesKeys.detail(id) });
    },
  });
}
