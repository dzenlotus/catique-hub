/**
 * Active-space React context — the shared, dependency-free half of the
 * active-space feature.
 *
 * Only the Context object and the `useActiveSpace` consumer hook live
 * here: both rely on nothing but `React.useContext`, so they carry zero
 * entity/feature/widget imports and can sit in `@shared`. Consumers across
 * every FSD layer import `useActiveSpace` from the shared barrel.
 *
 * The PROVIDER component (`ActiveSpaceProvider`) lives in `app/providers`
 * because it resolves the default space from `useSpaces()` (an entity
 * dependency), which `app` is allowed to import but `shared` is not.
 */

import { createContext, useContext } from "react";

export interface ActiveSpaceContextValue {
  activeSpaceId: string | null;
  setActiveSpaceId: (id: string | null) => void;
}

export const ActiveSpaceContext = createContext<ActiveSpaceContextValue | null>(
  null,
);

/**
 * `useActiveSpace` — consume the global active-space context.
 *
 * Must be called inside `<ActiveSpaceProvider>`.
 */
export function useActiveSpace(): ActiveSpaceContextValue {
  const ctx = useContext(ActiveSpaceContext);
  if (!ctx) throw new Error("useActiveSpace must be used within <ActiveSpaceProvider>");
  return ctx;
}
