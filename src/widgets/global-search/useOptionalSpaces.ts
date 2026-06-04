/**
 * `useOptionalSpaces` — return spaces if a QueryClient is mounted,
 * otherwise return an empty array.
 *
 * GlobalSearch is rendered by Storybook stories and unit tests that
 * don't always mount `<QueryClientProvider>`. Calling `useSpaces()`
 * directly would crash those harnesses. This shim peeks at the
 * QueryClientContext via `useContext` and only calls the real
 * `useQuery` hook when a client is present.
 *
 * The hooks order is stable across renders within a single tree:
 * either the QueryClient is mounted for the whole lifetime of the
 * widget, or it isn't. Conditional hook calls would normally be
 * unsafe, but here the branch is keyed off a value that's effectively
 * constant per mount-tree.
 */
import { useContext } from "react";
import { QueryClientContext } from "@tanstack/react-query";

import type { Space } from "@entities/space";
import { useSpaces } from "@entities/space";

export function useOptionalSpaces(): Space[] {
  const client = useContext(QueryClientContext);
  if (client === undefined) return [];
  // Safe inline call — see file comment.
  // eslint-disable-next-line react-hooks/rules-of-hooks
  const query = useSpaces();
  return query.data ?? [];
}
