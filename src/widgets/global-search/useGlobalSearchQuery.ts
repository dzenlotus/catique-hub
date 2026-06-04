/**
 * `useGlobalSearchQuery` — owns the search state machine for the Cmd+K
 * palette: debounced query → `search_all` IPC → grouped, flat result
 * list, with client-side prompt matching merged in from the TanStack
 * Query cache.
 *
 * `search_all` returns only task / agentReport rows (see Round 4 Stream S
 * spec). Prompts are matched here by substring on `prompt.name`, capped
 * to keep the list scannable, and slotted ahead of the IPC results so
 * they read first in the palette.
 *
 * Command mode (`>` prefix) is handled by the palette itself — this hook
 * short-circuits to idle while the query is in command mode so no IPC
 * fires.
 */
import { useEffect, useMemo, useState } from "react";

import type { SearchResult } from "@bindings/SearchResult";
import type { Prompt } from "@bindings/Prompt";
import { invoke } from "@shared/api";

/** Max number of prompts injected into search-mode results. */
export const PROMPT_RESULT_CAP = 10;

export type SearchState =
  | { status: "idle" }
  | { status: "loading" }
  | { status: "ok"; results: SearchResult[] }
  | { status: "error"; message: string };

/**
 * Local result union for keyboard nav + rendering. Prompts are merged in
 * client-side; tasks / agentReports come straight from `search_all`.
 */
export type LocalResult =
  | { localKind: "task"; data: Extract<SearchResult, { type: "task" }> }
  | {
      localKind: "agentReport";
      data: Extract<SearchResult, { type: "agentReport" }>;
    }
  | { localKind: "prompt"; id: string; name: string; content: string };

export type PromptResult = Extract<LocalResult, { localKind: "prompt" }>;
export type TaskResult = Extract<LocalResult, { localKind: "task" }>;
export type AgentReportResult = Extract<LocalResult, { localKind: "agentReport" }>;

export interface GroupedResults {
  prompts: PromptResult[];
  tasks: TaskResult[];
  agentReports: AgentReportResult[];
}

/** Group LocalResults by `localKind`, preserving insertion order. */
export function groupResults(results: ReadonlyArray<LocalResult>): GroupedResults {
  const prompts: PromptResult[] = [];
  const tasks: TaskResult[] = [];
  const agentReports: AgentReportResult[] = [];
  for (const r of results) {
    if (r.localKind === "prompt") prompts.push(r);
    else if (r.localKind === "task") tasks.push(r);
    else agentReports.push(r);
  }
  return { prompts, tasks, agentReports };
}

/** Minimal inline debounce — avoids adding a dependency. */
function useDebounce<T>(value: T, delayMs: number): T {
  const [debounced, setDebounced] = useState<T>(value);
  useEffect(() => {
    const id = window.setTimeout(() => setDebounced(value), delayMs);
    return () => window.clearTimeout(id);
  }, [value, delayMs]);
  return debounced;
}

export interface UseGlobalSearchQueryArgs {
  /** Raw input value. */
  query: string;
  /** Whether the palette is mounted/open — gates the IPC effect. */
  isOpen: boolean;
  /** Whether the palette is in command (`>`) mode — short-circuits search. */
  isCommandMode: boolean;
  /** All prompts from the cache for client-side name matching. */
  prompts: ReadonlyArray<Prompt>;
}

export interface UseGlobalSearchQueryResult {
  state: SearchState;
  debouncedQuery: string;
  matchingPrompts: PromptResult[];
  /** Flat ordered list — prompts → tasks → agent reports. */
  flatResults: LocalResult[];
}

export function useGlobalSearchQuery({
  query,
  isOpen,
  isCommandMode,
  prompts,
}: UseGlobalSearchQueryArgs): UseGlobalSearchQueryResult {
  const [state, setState] = useState<SearchState>({ status: "idle" });
  const debouncedQuery = useDebounce(query.trim(), 200);

  // Reset to idle whenever the palette closes so a re-open starts clean.
  useEffect(() => {
    if (!isOpen) setState({ status: "idle" });
  }, [isOpen]);

  // Fire IPC when the debounced query changes. Skip in command mode and
  // for the empty query.
  useEffect(() => {
    if (!isOpen) return;
    if (isCommandMode || debouncedQuery === "") {
      setState({ status: "idle" });
      return;
    }

    let cancelled = false;
    setState({ status: "loading" });

    invoke<SearchResult[]>("search_all", {
      query: debouncedQuery,
      limitPerKind: 50,
    })
      .then((results) => {
        if (!cancelled) setState({ status: "ok", results });
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        const message =
          err instanceof Error
            ? err.message
            : typeof err === "object" && err !== null && "message" in err
              ? String((err as { message: unknown }).message)
              : "Unknown error";
        setState({ status: "error", message });
      });

    return () => {
      cancelled = true;
    };
  }, [debouncedQuery, isOpen, isCommandMode]);

  // Client-side prompt search — substring match on name, capped.
  const matchingPrompts = useMemo<PromptResult[]>(() => {
    if (isCommandMode || debouncedQuery.length === 0) return [];
    const q = debouncedQuery.toLowerCase();
    return prompts
      .filter((p) => p.name.toLowerCase().includes(q))
      .slice(0, PROMPT_RESULT_CAP)
      .map((p) => ({
        localKind: "prompt" as const,
        id: p.id,
        name: p.name,
        content: p.content,
      }));
  }, [debouncedQuery, prompts, isCommandMode]);

  // Flat ordered list — prompts → tasks → agent reports — shared between
  // rendering and keyboard nav so indices line up.
  const flatResults = useMemo<LocalResult[]>(() => {
    const tagged: LocalResult[] =
      state.status === "ok"
        ? state.results.map((r) =>
            r.type === "task"
              ? { localKind: "task" as const, data: r }
              : { localKind: "agentReport" as const, data: r },
          )
        : [];
    const { tasks, agentReports } = groupResults(tagged);
    return [...matchingPrompts, ...tasks, ...agentReports];
  }, [state, matchingPrompts]);

  return { state, debouncedQuery, matchingPrompts, flatResults };
}
