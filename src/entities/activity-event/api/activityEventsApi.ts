/**
 * Activity-events IPC client.
 *
 * Wraps the `list_recent_events` / `list_recent_events_by_scope` IPCs
 * introduced in refactor-v3 Wave 5 (global feed) and refactor-v3 D-D
 * (per-scope feed for the SpaceDetailPage activity log).
 */
import { invokeWithAppError } from "@shared/api";
import type { ActivityEvent } from "@bindings/ActivityEvent";

/** Default ceiling matching the Rust handler's `MAX_LIMIT`. */
const DEFAULT_LIMIT = 20;

/** Scope discriminator — keep in sync with the Rust `scope_kind` enum. */
export type ActivityScopeKind =
  | "global"
  | "space"
  | "board"
  | "column"
  | "task"
  | "role"
  | "prompt"
  | "skill"
  | "mcp_server"
  | "tag"
  | "prompt_group";

export async function listRecentEvents(
  limit?: number,
): Promise<ActivityEvent[]> {
  return invokeWithAppError<ActivityEvent[]>("list_recent_events", {
    limit: limit ?? DEFAULT_LIMIT,
  });
}

/**
 * Fetch the most recent `limit` activity events restricted to
 * `(scopeKind, scopeId)`. Pass `scopeId = null` for `scopeKind="global"`
 * — the Rust side filters NULL scope_id only when the argument is
 * literal NULL (SQL tri-valued logic).
 */
export async function listRecentEventsByScope(
  scopeKind: ActivityScopeKind,
  scopeId: string | null,
  limit?: number,
): Promise<ActivityEvent[]> {
  return invokeWithAppError<ActivityEvent[]>("list_recent_events_by_scope", {
    scopeKind,
    scopeId,
    limit: limit ?? DEFAULT_LIMIT,
  });
}
