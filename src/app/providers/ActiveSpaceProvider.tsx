/**
 * ActiveSpaceProvider — global context for the currently selected space.
 *
 * Persists selection to `localStorage` under `"catique:activeSpaceId"`.
 * On mount, restores from localStorage; if nothing is stored (or the stored
 * id is no longer present in the list), falls back to the default space or
 * the first space in the list.
 *
 * Consumers read/write via `useActiveSpace()`.
 */

import {
  createContext,
  useContext,
  useEffect,
  useState,
  type PropsWithChildren,
  type ReactElement,
} from "react";

import { useSpaces } from "@entities/space";
import type { Space } from "@entities/space";

// ─────────────────────────────────────────────────────────────────────────────

const LS_KEY = "catique:activeSpaceId";

function readFromStorage(): string | null {
  try {
    return localStorage.getItem(LS_KEY);
  } catch {
    return null;
  }
}

function writeToStorage(id: string | null): void {
  try {
    if (id === null) {
      localStorage.removeItem(LS_KEY);
    } else {
      localStorage.setItem(LS_KEY, id);
    }
  } catch {
    // Private mode or restricted environment — silently ignore.
  }
}

/**
 * Resolves the best default space id from a list.
 *
 * Priority order:
 *   1. `storedId` when present in the list.
 *   2. The space flagged `isDefault === true`.
 *   3. The first space in the list.
 *   4. `null` for an empty list.
 */
function resolveActiveId(spaces: Space[], storedId: string | null): string | null {
  if (spaces.length === 0) return null;
  if (storedId !== null && spaces.some((s) => s.id === storedId)) return storedId;
  return (spaces.find((s) => s.isDefault) ?? spaces[0]).id;
}

// ─────────────────────────────────────────────────────────────────────────────

export interface ActiveSpaceContextValue {
  activeSpaceId: string | null;
  setActiveSpaceId: (id: string | null) => void;
}

const ActiveSpaceContext = createContext<ActiveSpaceContextValue | null>(null);

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

// ─────────────────────────────────────────────────────────────────────────────

/**
 * `ActiveSpaceProvider` — mounts the active-space context.
 *
 * Wrap around the app (inside `QueryProvider` + `EventsProvider`) so both
 * the Sidebar and entity-list widgets can read/write the selection.
 */
export function ActiveSpaceProvider({ children }: PropsWithChildren): ReactElement {
  const [activeSpaceId, setActiveSpaceIdState] = useState<string | null>(
    () => readFromStorage(),
  );

  const spacesQuery = useSpaces();

  // Auto-select from list when spaces first arrive and activeSpaceId has
  // not yet been pinned to a valid space.
  useEffect(() => {
    if (spacesQuery.status !== "success") return;
    const resolved = resolveActiveId(spacesQuery.data, activeSpaceId);
    if (resolved !== activeSpaceId) {
      setActiveSpaceIdState(resolved);
      writeToStorage(resolved);
    }
    // Only run when the spaces list itself changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [spacesQuery.status, spacesQuery.data]);

  const setActiveSpaceId = (id: string | null): void => {
    setActiveSpaceIdState(id);
    writeToStorage(id);
  };

  return (
    <ActiveSpaceContext.Provider value={{ activeSpaceId, setActiveSpaceId }}>
      {children}
    </ActiveSpaceContext.Provider>
  );
}
