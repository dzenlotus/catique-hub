/**
 * `useTaskDraft` — observe a task's LIVE (unsaved) form edits.
 *
 * The task editor (`TaskDialogContent`) holds title / description in local
 * `useState` that is only flushed to the server on Save. The right-hand XML
 * preview (`TaskView` → `TaskXmlPreview`), however, reads the *saved* bundle
 * via `useTaskBundle`, so it would lag behind whatever the user is typing.
 *
 * This module bridges the gap with a lightweight in-memory draft map keyed
 * by task id, observed through `useSyncExternalStore` — the same pattern as
 * `useTaskStatus`. The editor writes the current field values via
 * `setTaskDraft` on every keystroke; the preview reads them via
 * `useTaskDraft` and prefers the draft over the saved bundle. On a
 * successful save (or unmount) the editor calls `clearTaskDraft` so the
 * preview falls back to the now-authoritative bundle.
 *
 * The store is intentionally NOT a TanStack Query cache: these are
 * ephemeral, client-only, never-persisted values that change on every
 * keystroke, and routing them through the query cache would be both
 * semantically wrong (they are not server state) and wasteful.
 */
import { useSyncExternalStore } from "react";

export interface TaskDraft {
  title?: string;
  description?: string;
}

type DraftMap = Map<string, TaskDraft>;
type Listener = () => void;

const EMPTY_DRAFT: TaskDraft = Object.freeze({});

const draftMap: DraftMap = new Map();
const listeners = new Set<Listener>();

function notify(): void {
  for (const l of listeners) {
    l();
  }
}

function subscribe(listener: Listener): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

function snapshotForTask(taskId: string): TaskDraft {
  return draftMap.get(taskId) ?? EMPTY_DRAFT;
}

/**
 * Observe the live draft for `taskId`. Returns a stable frozen-empty object
 * when no draft exists, so consumers can read `draft.description` safely and
 * `useSyncExternalStore` does not tear on identical empty snapshots.
 */
export function useTaskDraft(taskId: string): TaskDraft {
  return useSyncExternalStore(
    subscribe,
    () => snapshotForTask(taskId),
    () => EMPTY_DRAFT,
  );
}

/**
 * Merge `patch` into the task's draft and re-render every consumer of
 * `useTaskDraft(taskId)`. Call from the editor on every field change.
 */
export function setTaskDraft(taskId: string, patch: TaskDraft): void {
  const prev = draftMap.get(taskId) ?? EMPTY_DRAFT;
  const next: TaskDraft = { ...prev, ...patch };
  // Skip the notify when nothing actually changed — avoids redundant
  // re-renders when a controlled input echoes its current value.
  if (
    prev.title === next.title &&
    prev.description === next.description &&
    draftMap.has(taskId)
  ) {
    return;
  }
  draftMap.set(taskId, next);
  notify();
}

/** Drop the task's draft — call on successful save and on editor unmount. */
export function clearTaskDraft(taskId: string): void {
  if (!draftMap.delete(taskId)) return;
  notify();
}

/** Clear all drafts — used by tests + the E2E bridge reset. */
export function resetTaskDrafts(): void {
  if (draftMap.size === 0) return;
  draftMap.clear();
  notify();
}
