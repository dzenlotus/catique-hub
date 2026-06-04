/**
 * `useOptionalPrompts` — same shape as `useOptionalSpaces` but for the
 * prompt entity. Returns `[]` when no `QueryClientProvider` is present
 * (e.g. Storybook / test harnesses).
 */
import { useContext } from "react";
import { QueryClientContext } from "@tanstack/react-query";

import type { Prompt } from "@bindings/Prompt";
import { usePrompts } from "@entities/prompt";

export function useOptionalPrompts(): Prompt[] {
  const client = useContext(QueryClientContext);
  if (client === undefined) return [];
  // Hooks order is stable across renders within a tree — see the file
  // comment on useOptionalSpaces.
  // eslint-disable-next-line react-hooks/rules-of-hooks
  const query = usePrompts();
  return query.data ?? [];
}
