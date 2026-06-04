/**
 * Prompt tag-filter store — shared client-only state for the set of
 * tag ids the user is filtering the prompts surface by.
 *
 * The filter control lives in the global `TopBar` (header) while the
 * list that reacts to it lives in `PromptsSidebar` / `PromptsPage`.
 * Those trees do not share a common React-context ancestor that's cheap
 * to thread the value through, so we keep the selection in a tiny
 * module-level store and expose it via `useSyncExternalStore` — the same
 * subscribe/snapshot shape `appShellPrefs` uses for the sidebar-collapse
 * flag.
 *
 * State is intentionally in-memory (not persisted): a tag filter is a
 * transient view concern, and the active tag set should reset between
 * app launches rather than surprise the user with a pre-filtered list.
 */

const EMPTY: ReadonlyArray<string> = Object.freeze([]);

let selectedTagIds: ReadonlyArray<string> = EMPTY;
const listeners = new Set<() => void>();

function emit(): void {
  for (const listener of listeners) listener();
}

export function readPromptTagFilter(): ReadonlyArray<string> {
  return selectedTagIds;
}

export function setPromptTagFilter(next: ReadonlyArray<string>): void {
  // Normalise to the frozen empty singleton so consumers memoising on
  // the reference don't re-run when the selection clears.
  const value = next.length === 0 ? EMPTY : Object.freeze([...next]);
  if (value === selectedTagIds) return;
  selectedTagIds = value;
  emit();
}

export function clearPromptTagFilter(): void {
  setPromptTagFilter(EMPTY);
}

export function subscribePromptTagFilter(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}
