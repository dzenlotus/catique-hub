/**
 * Tauri 2.x realtime event subscription — typed wrapper.
 *
 * The Rust side (`crates/api/src/events.rs`) emits an event after every
 * successful mutation. Each event is a `<entity>.<verb>` string with a
 * compact JSON payload — the wire format is intentionally minimal so
 * the frontend can use it as a *cache-invalidation hint* and refetch
 * the canonical state via the existing query layer. We never trust the
 * event payload as the source of truth for an entity.
 *
 * ## Why a discriminated union vs. positional listen<T>
 *
 * `@tauri-apps/api/event`'s `listen<T>(name, handler)` is fully typed
 * once the caller supplies `T`, but it has no way to enforce that
 * `name` and `T` are matched correctly — `listen<{ id: string }>(
 * 'task.created', ...)` would compile even though the payload also
 * carries `column_id` / `board_id`. The {@link AppEvent} union below
 * pairs each name with its exact payload, and the {@link on} helper
 * uses `Extract<…>` to derive the right payload type from the name —
 * a single source of truth keeps Rust and TS in sync.
 *
 * ## Why don't we autogenerate this from Rust constants?
 *
 * ts-rs only exports `#[derive(TS)]` types. Plain `pub const` strings
 * (which is what we use on the Rust side per the events module docs)
 * are not exported. Building a custom proc-macro for 32 strings would
 * cost more than the manual sync; the {@link AppEventType} compile-time
 * exhaustiveness check below catches any drift.
 */

import { listen, type UnlistenFn } from "@tauri-apps/api/event";

/**
 * Discriminated union of every realtime event emitted by the Rust IPC
 * layer. Keep this list 1:1 with `crates/api/src/events.rs` constants.
 */
export type AppEvent =
  // ---------------- boards ----------------
  | { type: "board.created"; payload: { id: string } }
  | { type: "board.updated"; payload: { id: string } }
  | { type: "board.deleted"; payload: { id: string } }
  // ---------------- columns ----------------
  | {
      type: "column.created";
      payload: { id: string; board_id: string };
    }
  | {
      type: "column.updated";
      payload: { id: string; board_id: string };
    }
  | {
      type: "column.deleted";
      payload: { id: string; board_id: string };
    }
  // ---------------- tasks ----------------
  | {
      type: "task.created";
      payload: { id: string; column_id: string; board_id: string };
    }
  | {
      type: "task.updated";
      payload: { id: string; column_id: string; board_id: string };
    }
  | {
      type: "task.moved";
      payload: {
        id: string;
        from_column_id: string;
        to_column_id: string;
        board_id: string;
      };
    }
  | {
      type: "task.deleted";
      payload: { id: string; column_id: string; board_id: string };
    }
  // ---------------- spaces ----------------
  | { type: "space.created"; payload: { id: string } }
  | { type: "space.updated"; payload: { id: string } }
  | { type: "space.deleted"; payload: { id: string } }
  // ---------------- prompts ----------------
  | { type: "prompt.created"; payload: { id: string } }
  | { type: "prompt.updated"; payload: { id: string } }
  | { type: "prompt.deleted"; payload: { id: string } }
  // ---------------- roles ----------------
  | { type: "role.created"; payload: { id: string } }
  | { type: "role.updated"; payload: { id: string } }
  | { type: "role.deleted"; payload: { id: string } }
  // ---------------- tags ----------------
  | { type: "tag.created"; payload: { id: string } }
  | { type: "tag.updated"; payload: { id: string } }
  | { type: "tag.deleted"; payload: { id: string } }
  // ---------------- agent reports ----------------
  | {
      type: "agent_report.created";
      payload: { id: string; task_id: string };
    }
  | {
      type: "agent_report.updated";
      payload: { id: string; task_id: string };
    }
  | {
      type: "agent_report.deleted";
      payload: { id: string; task_id: string };
    }
  // ---------------- attachments ----------------
  | {
      type: "attachment.created";
      payload: { id: string; task_id: string };
    }
  | {
      type: "attachment.updated";
      payload: { id: string; task_id: string };
    }
  | {
      type: "attachment.deleted";
      payload: { id: string; task_id: string };
    }
  // ---------------- import ----------------
  | { type: "import.started"; payload: { source_path: string } }
  | {
      type: "import.progress";
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
      type: "import.completed";
      payload: {
        duration_ms: number;
        rows_imported: Record<string, number>;
        commit_path: string | null;
        dry_run: boolean;
      };
    }
  | {
      type: "import.failed";
      payload: { error_kind: string; message: string };
    }
  // ---------------- generic ----------------
  | { type: "app.refresh-required"; payload: Record<string, never> };

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
