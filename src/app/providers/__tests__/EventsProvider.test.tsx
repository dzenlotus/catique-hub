/**
 * EventsProvider integration tests.
 *
 * We mock `@tauri-apps/api/event` so each test can drive a synthetic
 * event into the provider and assert that react-query's
 * `invalidateQueries` got called with the right key.
 */

import { describe, expect, it, vi, beforeEach } from "vitest";
import { act, render, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactElement } from "react";

import { boardsKeys } from "@entities/board";
import { columnsKeys } from "@entities/column";
import { tasksKeys } from "@entities/task";

// ---- mocks --------------------------------------------------------
type Listener = (e: { event: string; id: number; payload: unknown }) => void;
const listeners = new Map<string, Set<Listener>>();
const unlistenCount = { n: 0 };

vi.mock("@tauri-apps/api/event", () => ({
  listen: vi.fn(
    async (eventName: string, handler: Listener): Promise<() => void> => {
      const set = listeners.get(eventName) ?? new Set<Listener>();
      set.add(handler);
      listeners.set(eventName, set);
      return () => {
        unlistenCount.n += 1;
        set.delete(handler);
      };
    },
  ),
}));

import { ToastProvider } from "@shared/lib";

import { EventsProvider } from "../EventsProvider";

function dispatch(name: string, payload: unknown): void {
  const set = listeners.get(name);
  if (!set) return;
  for (const h of set) h({ event: name, id: 0, payload });
}

function renderWithProvider(): {
  client: QueryClient;
  invalidateSpy: ReturnType<typeof vi.spyOn>;
  removeSpy: ReturnType<typeof vi.spyOn>;
  unmount: () => void;
} {
  const client = new QueryClient({
    defaultOptions: {
      queries: { retry: false, gcTime: 0 },
      mutations: { retry: false },
    },
  });
  const invalidateSpy = vi.spyOn(client, "invalidateQueries");
  const removeSpy = vi.spyOn(client, "removeQueries");
  // Stream J / v3 Wave 4: EventsProvider now consumes `useToast()` for
  // the `task:run:failed` error-toast bridge, so a ToastProvider must
  // wrap it for the listener registration to mount.
  const tree: ReactElement = (
    <QueryClientProvider client={client}>
      <ToastProvider>
        <EventsProvider>
          <div data-testid="kid">child</div>
        </EventsProvider>
      </ToastProvider>
    </QueryClientProvider>
  );
  const result = render(tree);
  return {
    client,
    invalidateSpy,
    removeSpy,
    unmount: result.unmount,
  };
}

describe("EventsProvider — Tauri events → react-query invalidation", () => {
  beforeEach(() => {
    listeners.clear();
    unlistenCount.n = 0;
  });

  it("renders children", () => {
    const { unmount } = renderWithProvider();
    // No assertion past mount — the smoke test is "no throw and child
    // is mounted". `data-testid` is present in the DOM.
    unmount();
  });

  it("invalidates boards.all on board.created", async () => {
    const { invalidateSpy, unmount } = renderWithProvider();
    // `on()` registers asynchronously — wait for the listener to land
    // before dispatching, or the dispatch is a no-op.
    await waitFor(() => {
      expect(listeners.get("board:created")?.size ?? 0).toBeGreaterThan(0);
    });
    act(() => {
      dispatch("board:created", { id: "b1" });
    });
    expect(invalidateSpy).toHaveBeenCalledWith({
      queryKey: boardsKeys.all,
    });
    unmount();
  });

  it("removes the detail cache on board.deleted", async () => {
    const { invalidateSpy, removeSpy, unmount } = renderWithProvider();
    await waitFor(() => {
      expect(listeners.get("board:deleted")?.size ?? 0).toBeGreaterThan(0);
    });
    act(() => {
      dispatch("board:deleted", { id: "b1" });
    });
    expect(invalidateSpy).toHaveBeenCalledWith({
      queryKey: boardsKeys.all,
    });
    expect(removeSpy).toHaveBeenCalledWith({
      queryKey: boardsKeys.detail("b1"),
    });
    unmount();
  });

  it("invalidates columns.list(boardId) on column.created", async () => {
    const { invalidateSpy, unmount } = renderWithProvider();
    await waitFor(() => {
      expect(listeners.get("column:created")?.size ?? 0).toBeGreaterThan(0);
    });
    act(() => {
      dispatch("column:created", { id: "c1", board_id: "bd1" });
    });
    expect(invalidateSpy).toHaveBeenCalledWith({
      queryKey: columnsKeys.list("bd1"),
    });
    unmount();
  });

  it("invalidates both byColumn caches on task.moved", async () => {
    const { invalidateSpy, unmount } = renderWithProvider();
    await waitFor(() => {
      expect(listeners.get("task:moved")?.size ?? 0).toBeGreaterThan(0);
    });
    act(() => {
      dispatch("task:moved", {
        id: "t1",
        from_column_id: "c1",
        to_column_id: "c2",
        board_id: "bd1",
      });
    });
    // Board view + both column views + task detail.
    expect(invalidateSpy).toHaveBeenCalledWith({
      queryKey: tasksKeys.byBoard("bd1"),
    });
    expect(invalidateSpy).toHaveBeenCalledWith({
      queryKey: tasksKeys.byColumn("c1"),
    });
    expect(invalidateSpy).toHaveBeenCalledWith({
      queryKey: tasksKeys.byColumn("c2"),
    });
    expect(invalidateSpy).toHaveBeenCalledWith({
      queryKey: tasksKeys.detail("t1"),
    });
    unmount();
  });

  // Stream J / v3 Wave 4 — task:run:* lifecycle wiring.
  //
  // We mount a tiny consumer that calls `useTaskStatus(taskId)` and
  // assert that the rendered text flips from `idle` to `running` /
  // `completed` / `failed` after each event lands. This exercises the
  // full bridge: Tauri event → `setTaskStatus` mutator → external
  // store → `useSyncExternalStore` re-render.
  it("forwards task:run:* events into the useTaskStatus store", async () => {
    const { useTaskStatus, resetTaskStatuses } = await import(
      "@entities/task"
    );
    resetTaskStatuses();

    function TaskStatusProbe({ taskId }: { taskId: string }): ReactElement {
      const status = useTaskStatus(taskId);
      return <div data-testid={`probe-${taskId}`}>{status}</div>;
    }

    const client = new QueryClient({
      defaultOptions: { queries: { retry: false, gcTime: 0 } },
    });
    const { findByTestId, unmount } = render(
      <QueryClientProvider client={client}>
        <ToastProvider>
          <EventsProvider>
            <TaskStatusProbe taskId="t-1" />
          </EventsProvider>
        </ToastProvider>
      </QueryClientProvider>,
    );

    expect((await findByTestId("probe-t-1")).textContent).toBe("idle");

    await waitFor(() => {
      expect(listeners.get("task:run:started")?.size ?? 0).toBeGreaterThan(0);
    });

    act(() => {
      dispatch("task:run:started", { taskId: "t-1" });
    });
    expect((await findByTestId("probe-t-1")).textContent).toBe("running");

    act(() => {
      dispatch("task:run:finished", { taskId: "t-1" });
    });
    expect((await findByTestId("probe-t-1")).textContent).toBe("completed");

    act(() => {
      dispatch("task:run:failed", { taskId: "t-1", error: "boom" });
    });
    expect((await findByTestId("probe-t-1")).textContent).toBe("failed");

    resetTaskStatuses();
    unmount();
  });

  it("releases listeners on unmount", async () => {
    const { unmount } = renderWithProvider();
    await waitFor(() => {
      // Wait until at least one listener resolved into the registry.
      expect(listeners.get("board:created")?.size ?? 0).toBeGreaterThan(0);
    });
    const before = unlistenCount.n;
    unmount();
    // The cleanup callback either tears down synchronously (resolved
    // listeners) or via the awaited path (still-pending). Wait for
    // unlisten count to climb.
    await waitFor(() => {
      expect(unlistenCount.n).toBeGreaterThan(before);
    });
  });
});
