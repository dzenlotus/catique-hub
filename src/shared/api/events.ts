/**
 * Tauri 2.x realtime event subscription — typed wrapper.
 *
 * The Rust side (`crates/api/src/events.rs`) emits an event after every
 * successful mutation. Each event is a `<entity>:<verb>` string with a
 * compact JSON payload — the wire format is intentionally minimal so
 * the frontend can use it as a *cache-invalidation hint* and refetch
 * the canonical state via the existing query layer. We never trust the
 * event payload as the source of truth for an entity.
 *
 * ## Event-name format
 *
 * Tauri 2.x restricts event names to **alphanumeric, `-`, `/`, `:`,
 * `_`** — `.` is rejected at runtime. We use `<domain>:<verb>` (colon-
 * namespaced). The Rust constants in `crates/api/src/events.rs` are the
 * source of truth; this union mirrors them 1:1.
 *
 * ## Why a discriminated union vs. positional listen<T>
 *
 * `@tauri-apps/api/event`'s `listen<T>(name, handler)` is fully typed
 * once the caller supplies `T`, but it has no way to enforce that
 * `name` and `T` are matched correctly. The {@link AppEvent} union
 * pairs each name with its exact payload, and the {@link on} helper
 * uses `Extract<…>` to derive the right payload type from the name —
 * a single source of truth keeps Rust and TS in sync.
 */

import { listen, type UnlistenFn } from "@tauri-apps/api/event";

/**
 * Discriminated union of every realtime event emitted by the Rust IPC
 * layer. Keep this list 1:1 with `crates/api/src/events.rs` constants.
 */
export type AppEvent =
  // ---------------- boards ----------------
  | { type: "board:created"; payload: { id: string } }
  | { type: "board:updated"; payload: { id: string } }
  | { type: "board:deleted"; payload: { id: string } }
  // ---------------- columns ----------------
  | {
      type: "column:created";
      payload: { id: string; board_id: string };
    }
  | {
      type: "column:updated";
      payload: { id: string; board_id: string };
    }
  | {
      type: "column:deleted";
      payload: { id: string; board_id: string };
    }
  // ---------------- tasks ----------------
  | {
      type: "task:created";
      payload: { id: string; column_id: string; board_id: string };
    }
  | {
      type: "task:updated";
      payload: { id: string; column_id: string; board_id: string };
    }
  | {
      type: "task:moved";
      payload: {
        id: string;
        from_column_id: string;
        to_column_id: string;
        board_id: string;
      };
    }
  | {
      type: "task:deleted";
      payload: { id: string; column_id: string; board_id: string };
    }
  // ---------------- spaces ----------------
  | { type: "space:created"; payload: { id: string } }
  | { type: "space:updated"; payload: { id: string } }
  | { type: "space:deleted"; payload: { id: string } }
  // ---------------- prompts ----------------
  | { type: "prompt:created"; payload: { id: string } }
  | { type: "prompt:updated"; payload: { id: string } }
  | { type: "prompt:deleted"; payload: { id: string } }
  // ---------------- roles ----------------
  | { type: "role:created"; payload: { id: string } }
  | { type: "role:updated"; payload: { id: string } }
  | { type: "role:deleted"; payload: { id: string } }
  // ---------------- tags ----------------
  | { type: "tag:created"; payload: { id: string } }
  | { type: "tag:updated"; payload: { id: string } }
  | { type: "tag:deleted"; payload: { id: string } }
  // ---------------- skills ----------------
  | { type: "skill:created"; payload: { id: string } }
  | { type: "skill:updated"; payload: { id: string } }
  | { type: "skill:deleted"; payload: { id: string } }
  // ---------------- mcp tools ----------------
  | { type: "mcp_tool:created"; payload: { id: string } }
  | { type: "mcp_tool:updated"; payload: { id: string } }
  | { type: "mcp_tool:deleted"; payload: { id: string } }
  // ---------------- agent reports ----------------
  | {
      type: "agent_report:created";
      payload: { id: string; task_id: string };
    }
  | {
      type: "agent_report:updated";
      payload: { id: string; task_id: string };
    }
  | {
      type: "agent_report:deleted";
      payload: { id: string; task_id: string };
    }
  // ---------------- attachments ----------------
  | {
      type: "attachment:created";
      payload: { id: string; task_id: string };
    }
  | {
      type: "attachment:updated";
      payload: { id: string; task_id: string };
    }
  | {
      type: "attachment:deleted";
      payload: { id: string; task_id: string };
    }
  // ---------------- import ----------------
  | { type: "import:started"; payload: { source_path: string } }
  | {
      type: "import:progress";
      payload: {
        phase:
          | "preflight"
          | "copy"
          | "schema"
          | "data"
          | "fts"
          | "attachments"
          | "rename";
        percent: number;
      };
    }
  | {
      type: "import:completed";
      payload: {
        duration_ms: number;
        rows_imported: Record<string, number>;
        commit_path: string | null;
        dry_run: boolean;
      };
    }
  | {
      type: "import:failed";
      payload: { error_kind: string; message: string };
    }
  // ---------------- prompt groups ----------------
  | { type: "prompt_group:created"; payload: { id: string } }
  | { type: "prompt_group:updated"; payload: { id: string } }
  | { type: "prompt_group:deleted"; payload: { id: string } }
  | { type: "prompt_group:members_changed"; payload: { group_id: string } }
  // ---------------- generic ----------------
  | { type: "app:refresh-required"; payload: Record<string, never> };

/** All event names — narrowed via `AppEvent['type']`. */
export type AppEventType = AppEvent["type"];

/** Payload type for a given event name. */
export type AppEventPayload<E extends AppEventType> = Extract<
  AppEvent,
  { type: E }
>["payload"];

/**
 * Subscribe to a single typed event. Wraps `@tauri-apps/api/event`'s
 * `listen` so the handler signature is the inner payload (Tauri's
 * native handler receives `{ event, id, payload }` — for a cache-
 * invalidation hint we only care about `payload`).
 *
 * Returns a `Promise<UnlistenFn>` because Tauri's listener registration
 * is async; callers in `EventsProvider` push these into an array and
 * call them all on cleanup.
 */
export async function on<E extends AppEventType>(
  eventName: E,
  handler: (payload: AppEventPayload<E>) => void,
): Promise<UnlistenFn> {
  return listen<AppEventPayload<E>>(eventName, (e) => {
    handler(e.payload);
  });
}
