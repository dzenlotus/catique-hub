/**
 * Tests for the typed Tauri-event listener wrapper.
 *
 * We mock `@tauri-apps/api/event` at the module boundary so the test
 * exercises the wrapper logic (name → payload extraction, async unlisten
 * handling) without needing a real Tauri runtime — which would require
 * a window, an event-bus webview, and the full app bootstrap.
 */

import { describe, expect, it, vi, beforeEach } from "vitest";

// Mock must precede the import-under-test. We give back a controlled
// dispatcher so each test can simulate an incoming event with the right
// payload shape.
type Listener = (e: { event: string; id: number; payload: unknown }) => void;
const listeners = new Map<string, Set<Listener>>();
let unlistenCalls = 0;

vi.mock("@tauri-apps/api/event", () => ({
  listen: vi.fn(
    async (eventName: string, handler: Listener): Promise<() => void> => {
      const set = listeners.get(eventName) ?? new Set<Listener>();
      set.add(handler);
      listeners.set(eventName, set);
      return () => {
        unlistenCalls += 1;
        set.delete(handler);
      };
    },
  ),
}));

import { on, type AppEvent, type AppEventType } from "./events";

function dispatch<E extends AppEventType>(
  name: E,
  payload: Extract<AppEvent, { type: E }>["payload"],
): void {
  const set = listeners.get(name);
  if (!set) return;
  for (const h of set) h({ event: name, id: 0, payload });
}

describe("on() — typed Tauri event subscriber", () => {
  beforeEach(() => {
    listeners.clear();
    unlistenCalls = 0;
  });

  it("invokes the handler with the payload only (not the wrapper)", async () => {
    const handler = vi.fn<(p: { id: string }) => void>();
    await on("board:created", handler);
    dispatch("board:created", { id: "b1" });
    expect(handler).toHaveBeenCalledExactlyOnceWith({ id: "b1" });
  });

  it("preserves payload structure for multi-field events", async () => {
    const handler = vi.fn<
      (p: {
        id: string;
        from_column_id: string;
        to_column_id: string;
        board_id: string;
      }) => void
    >();
    await on("task:moved", handler);
    dispatch("task:moved", {
      id: "t1",
      from_column_id: "c1",
      to_column_id: "c2",
      board_id: "bd1",
    });
    expect(handler).toHaveBeenCalledExactlyOnceWith({
      id: "t1",
      from_column_id: "c1",
      to_column_id: "c2",
      board_id: "bd1",
    });
  });

  it("returns an unlisten function that detaches the handler", async () => {
    const handler = vi.fn<(p: { id: string }) => void>();
    const unlisten = await on("space:created", handler);
    dispatch("space:created", { id: "sp1" });
    expect(handler).toHaveBeenCalledTimes(1);
    unlisten();
    expect(unlistenCalls).toBe(1);
    dispatch("space:created", { id: "sp2" });
    // Same `handler` must NOT receive the second event.
    expect(handler).toHaveBeenCalledTimes(1);
  });

  it("supports multiple subscribers to the same event", async () => {
    const a = vi.fn<(p: { id: string }) => void>();
    const b = vi.fn<(p: { id: string }) => void>();
    await on("tag:deleted", a);
    await on("tag:deleted", b);
    dispatch("tag:deleted", { id: "tg1" });
    expect(a).toHaveBeenCalledTimes(1);
    expect(b).toHaveBeenCalledTimes(1);
  });

  it("ignores dispatches whose name doesn't match", async () => {
    const handler = vi.fn<(p: { id: string }) => void>();
    await on("prompt:created", handler);
    dispatch("prompt:updated", { id: "p1" });
    expect(handler).not.toHaveBeenCalled();
  });
});

describe("AppEvent — discriminated union compile-time checks", () => {
  it("type narrowing works on the `type` discriminator", () => {
    const sample: AppEvent = {
      type: "task:moved",
      payload: {
        id: "t1",
        from_column_id: "c1",
        to_column_id: "c2",
        board_id: "bd1",
      },
    };
    if (sample.type === "task:moved") {
      // Compile-time only — the field exists on the narrowed payload.
      expect(sample.payload.from_column_id).toBe("c1");
    }
  });
});
