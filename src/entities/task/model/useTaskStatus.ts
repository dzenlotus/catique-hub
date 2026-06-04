/**
 * `useTaskStatus` — observe the live agent-run lifecycle for a task.
 *
 * v3 Wave 4: returns `"idle"` by default. The hook is wired to a
 * lightweight ref-counted in-memory map that future event listeners
 * (run-started / run-finished / run-failed emitted from the Rust
 * event-bus once the agent run pipeline lands) update via the
 * exported `setTaskStatus` mutator.
 *
 * This shape lets the UI mount the badge + RunningTaskIndicator now
 * and have them go live the moment the backend events arrive — no
 * additional UI work required.
 */
import { useSyncExternalStore } from "react";

import type { TaskStatus } from "@shared/ui";

type StatusMap = Map<string, TaskStatus>;
type Listener = () => void;

const statusMap: StatusMap = new Map();
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

function snapshotForTask(taskId: string): TaskStatus {
  return statusMap.get(taskId) ?? "idle";
}

export function useTaskStatus(taskId: string): TaskStatus {
  return useSyncExternalStore(
    subscribe,
    () => snapshotForTask(taskId),
    () => "idle" as const,
  );
}

/**
 * Mutator — call from the event-bus subscriber when a run lifecycle
 * event arrives. Re-renders every consumer of `useTaskStatus(taskId)`.
 *
 * Once `crates/api/src/events.rs` emits `task.run.*` events, the
 * `EventsProvider` should subscribe and call this for the affected
 * task id.
 */
export function setTaskStatus(taskId: string, status: TaskStatus): void {
  if (status === "idle") {
    statusMap.delete(taskId);
  } else {
    statusMap.set(taskId, status);
  }
  notify();
}

/** Clear all known statuses — used by tests + the E2E bridge reset. */
export function resetTaskStatuses(): void {
  statusMap.clear();
  notify();
}
