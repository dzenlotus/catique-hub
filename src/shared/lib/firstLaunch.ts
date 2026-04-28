/**
 * First-launch detection hooks (Wave-D, E4.1).
 *
 * Catique HUB boots into one of three states:
 *
 *   1. **Has data** — at least one space exists in the local DB. The
 *      user has already onboarded (or finished an import) and the
 *      normal `BoardsList ↔ KanbanBoard` flow renders.
 *   2. **Empty DB + Promptery present** — zero spaces locally but a
 *      Promptery DB is reachable at `~/.promptery/db.sqlite`. We show
 *      the import wizard.
 *   3. **Empty DB + no Promptery** — zero spaces locally and no source
 *      DB to import from. We show the welcome screen.
 *
 * The Catique DB itself may not yet exist on disk: Olga's bootstrap
 * runs the migration runner on first boot, so by the time we query it
 * an empty (but well-formed) DB is in place. That means "first launch"
 * is reliably encoded as "list_spaces returns []", not "DB file
 * missing".
 *
 * The two queries are connected by `enabled` — we only ask Olga to
 * scan for a Promptery DB when we already know the local DB is empty,
 * which keeps the happy path (returning user) free of any disk probe.
 */

import { useQuery } from "@tanstack/react-query";

import { invoke } from "@shared/api";
import type { PrompteryDbInfo } from "@bindings/PrompteryDbInfo";
import { spacesKeys } from "@entities/space";

interface SpaceLike {
  id: string;
  name: string;
}

/** Stable react-query key for the Promptery DB detection probe. */
export const prompteryDetectKeys = {
  all: ["promptery"] as const,
  detect: ["promptery", "detect"] as const,
} as const;

/**
 * Light wrapper around `list_spaces` — copies the same defensive
 * pattern from `BoardsList`'s `useSpacesPeek`: an IPC error during
 * dev (or a not-yet-bootstrapped DB) is treated as "no spaces" so the
 * gate falls through to first-launch UX rather than an error screen.
 */
async function listSpacesPeek(): Promise<SpaceLike[]> {
  try {
    return await invoke<SpaceLike[]>("list_spaces");
  } catch {
    return [];
  }
}

/**
 * IPC: scan for a Promptery DB at `~/.promptery/db.sqlite`. Returns
 * `null` when the file is absent; the Rust handler raises only on
 * disk-read errors.
 */
async function detectPrompteryDb(): Promise<PrompteryDbInfo | null> {
  return invoke<PrompteryDbInfo | null>("detect_promptery_db");
}

export interface FirstLaunchCheck {
  /** True while either query is in flight and we can't yet decide. */
  isLoading: boolean;
  /** True iff the local DB has zero spaces. */
  isFirstLaunch: boolean;
  /**
   * The detected Promptery DB info, or `null` when none exists. Only
   * meaningful when `isFirstLaunch === true`; will be `undefined` when
   * the detect probe hasn't been issued (returning user).
   */
  prompteryDb: PrompteryDbInfo | null | undefined;
  /** Aggregated error from either query (if any). */
  error: Error | null;
  /** Manually trigger a re-check (used by Welcome flow's mutations). */
  refetch: () => Promise<void>;
}

/**
 * Branching app-state hook. See module-level doc for the three states.
 *
 * Splits the work in two queries so the detect probe never fires for
 * a returning user. `enabled: spaces.isSuccess && spaces.data.length === 0`
 * keeps the second query gated behind the first.
 */
export function useFirstLaunchCheck(): FirstLaunchCheck {
  const spaces = useQuery({
    queryKey: spacesKeys.list(),
    queryFn: listSpacesPeek,
    retry: false,
  });

  const isFirstLaunch = spaces.data?.length === 0;

  const promptery = useQuery({
    queryKey: prompteryDetectKeys.detect,
    queryFn: detectPrompteryDb,
    retry: false,
    enabled: spaces.isSuccess && isFirstLaunch,
  });

  const isLoading =
    spaces.isLoading || (isFirstLaunch && promptery.isLoading && promptery.fetchStatus !== "idle");

  return {
    isLoading,
    isFirstLaunch: spaces.isSuccess ? isFirstLaunch : false,
    prompteryDb: promptery.data,
    error: spaces.error ?? promptery.error ?? null,
    refetch: async () => {
      await spaces.refetch();
      await promptery.refetch();
    },
  };
}
