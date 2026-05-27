/**
 * ExpandedSpacesProvider — global expand-state for spaces in the
 * left rail. Lives at the App level so the expanded set survives
 * navigation between pages that each mount their own `<SpacesSidebar/>`
 * (BoardHome, BoardDetailPage, BoardSettingsPage, SpaceSettingsPage,
 * TaskDetailPage). Without this lift, a sidebar re-mount would
 * collapse every space the user explicitly opened — they'd have to
 * re-expand it after every navigation click.
 *
 * Each space id is independent: toggling A never touches B. The
 * `<SpacesSidebar/>` reads its own per-row state via `isExpanded(id)`
 * and writes via `toggleExpanded(id)`.
 *
 * The provider persists the map to `localStorage` so reloads restore
 * the same set of open spaces.
 */

import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  type PropsWithChildren,
  type ReactElement,
} from "react";

import { useLocalStorage } from "@shared/storage";
import type { Codec } from "@shared/storage";

const LS_KEY = "catique:sidebar:expanded-spaces";

// JSON-encoded Record<spaceId, boolean>. Defensive on parse — any
// stored value that does not match the shape is treated as empty so a
// corrupted slot can't crash the app on startup.
const recordCodec: Codec<Record<string, boolean>> = {
  encode: (value) => JSON.stringify(value),
  decode: (raw) => {
    try {
      const parsed: unknown = JSON.parse(raw);
      if (parsed === null || typeof parsed !== "object") return {};
      const out: Record<string, boolean> = {};
      for (const [key, value] of Object.entries(parsed as Record<string, unknown>)) {
        if (typeof value === "boolean") out[key] = value;
      }
      return out;
    } catch {
      return {};
    }
  },
};

export interface ExpandedSpacesContextValue {
  /**
   * `true` when the space is open, `false` when explicitly collapsed,
   * `undefined` when the user has not interacted with the chevron yet
   * (the consumer falls back to its own "default expanded" rule).
   */
  getExpanded: (spaceId: string) => boolean | undefined;
  /** Flip the explicit state for one space. */
  toggleExpanded: (spaceId: string, fallback: boolean) => void;
}

const ExpandedSpacesContext = createContext<ExpandedSpacesContextValue | null>(
  null,
);

/**
 * No-op fallback used when the provider is absent — keeps tests and
 * Storybook decks renderable without forcing every test wrapper to mount
 * the provider. The fallback never persists anything: each consumer
 * still falls back to its own "default expanded" rule via
 * `getExpanded` returning `undefined`, and `toggleExpanded` is a no-op
 * (test code that needs to assert expansion should mount the provider
 * explicitly).
 */
const FALLBACK_VALUE: ExpandedSpacesContextValue = {
  getExpanded: () => undefined,
  toggleExpanded: () => {
    // no-op
  },
};

export function useExpandedSpaces(): ExpandedSpacesContextValue {
  const ctx = useContext(ExpandedSpacesContext);
  return ctx ?? FALLBACK_VALUE;
}

export function ExpandedSpacesProvider({
  children,
}: PropsWithChildren): ReactElement {
  const [map, setMap] = useLocalStorage<Record<string, boolean>>(
    LS_KEY,
    recordCodec,
  );
  const effective = map ?? {};

  const getExpanded = useCallback(
    (spaceId: string): boolean | undefined => effective[spaceId],
    [effective],
  );

  const toggleExpanded = useCallback(
    (spaceId: string, fallback: boolean): void => {
      setMap((prev) => {
        const current = prev?.[spaceId];
        const resolved = current ?? fallback;
        return { ...(prev ?? {}), [spaceId]: !resolved };
      });
    },
    [setMap],
  );

  const value = useMemo<ExpandedSpacesContextValue>(
    () => ({ getExpanded, toggleExpanded }),
    [getExpanded, toggleExpanded],
  );

  return (
    <ExpandedSpacesContext.Provider value={value}>
      {children}
    </ExpandedSpacesContext.Provider>
  );
}
