/**
 * EventsProvider — bridges Tauri 2.x realtime events to react-query
 * cache invalidation (Wave-E2.5, D-022).
 *
 * On mount, subscribes to every event name emitted by the Rust IPC
 * layer (see `crates/api/src/events.rs`) and maps each to the right
 * `queryClient.invalidateQueries({ queryKey })` call. The query keys
 * mirror the per-entity stores in `entities/{board,column,task}/model`.
 *
 * ## Why a single provider, not per-entity hooks
 *
 * Each entity slice owns its mutation hooks already, but realtime sync
 * is *cross-cutting* — when an MCP-agent in another process creates a
 * task, the task slice has no mutation hook to attach an `onSuccess`
 * to. A single provider mounted at the app root is the natural seam.
 *
 * ## Refetch storms
 *
 * The naive "invalidate every list on every event" can cause refetch
 * storms during rapid mutation streams (e.g. drag-drop, import). For
 * E2.5 we accept the storm — react-query already de-duplicates inflight
 * requests, and the alternative (debounce / coalesce) introduces its
 * own complexity (event batching window, key-set merging) that we
 * should design separately under E5 polish.
 *
 * ## Source-window filtering
 *
 * Tauri 2.x emits to every webview attached to the app. When a single
 * window initiates a mutation, its optimistic cache update completes
 * before the round-trip; the subsequent invalidation will refetch and
 * (on a stable result) collapse to the same data. That race causes
 * a brief flicker only in pathological cases (slow IPC, conflicting
 * server state). Source-window filtering is a defensible polish — we
 * skip it here per the wave brief and revisit in E5.
 */

import { useEffect, type PropsWithChildren, type ReactElement } from "react";
import { useQueryClient } from "@tanstack/react-query";
import type { UnlistenFn } from "@tauri-apps/api/event";

import { boardsKeys } from "@entities/board";
import { columnsKeys } from "@entities/column";
import { tasksKeys } from "@entities/task";
import { on } from "@shared/api";

/** Top-level provider — wire listeners and tear them down on unmount. */
export function EventsProvider({
  children,
}: PropsWithChildren): ReactElement {
  const qc = useQueryClient();

  useEffect(() => {
    // We collect unlisten functions in two stages:
    //   1. `pending` holds the *promises* returned by `on(...)` — one
    //      per listener. Cleanup must await all of them so a
    //      fast-mount/unmount sequence (StrictMode in dev, route
    //      transitions) doesn't leak handlers.
    //   2. After each promise resolves we push its UnlistenFn into
    //      `resolved`; the cleanup callback below also calls every fn
    //      already in `resolved` synchronously to release listeners
    //      whose `on()` resolved before the unmount fires.
    const resolved: UnlistenFn[] = [];
    const pending: Promise<UnlistenFn>[] = [];

    const sub = <P,>(
      promise: Promise<UnlistenFn>,
      _example?: (p: P) => void, // type anchor — unused at runtime
    ): void => {
      pending.push(promise);
      promise.then((fn) => {
        resolved.push(fn);
      });
    };

    // ---------------- boards ----------------
    sub(
      on("board.created", () => {
        void qc.invalidateQueries({ queryKey: boardsKeys.all });
      }),
    );
    sub(
      on("board.updated", ({ id }) => {
        void qc.invalidateQueries({ queryKey: boardsKeys.all });
        void qc.invalidateQueries({ queryKey: boardsKeys.detail(id) });
      }),
    );
    sub(
      on("board.deleted", ({ id }) => {
        void qc.invalidateQueries({ queryKey: boardsKeys.all });
        // Drop the detail cache outright — the board no longer exists,
        // a refetch would just produce a `notFound`.
        qc.removeQueries({ queryKey: boardsKeys.detail(id) });
      }),
    );

    // ---------------- columns ----------------
    sub(
      on("column.created", ({ board_id }) => {
        void qc.invalidateQueries({
          queryKey: columnsKeys.list(board_id),
        });
      }),
    );
    sub(
      on("column.updated", ({ id, board_id }) => {
        void qc.invalidateQueries({
          queryKey: columnsKeys.list(board_id),
        });
        void qc.invalidateQueries({ queryKey: columnsKeys.detail(id) });
      }),
    );
    sub(
      on("column.deleted", ({ id, board_id }) => {
        void qc.invalidateQueries({
          queryKey: columnsKeys.list(board_id),
        });
        qc.removeQueries({ queryKey: columnsKeys.detail(id) });
      }),
    );

    // ---------------- tasks ----------------
    sub(
      on("task.created", ({ column_id, board_id }) => {
        void qc.invalidateQueries({
          queryKey: tasksKeys.byBoard(board_id),
        });
        void qc.invalidateQueries({
          queryKey: tasksKeys.byColumn(column_id),
        });
      }),
    );
    sub(
      on("task.updated", ({ id, column_id, board_id }) => {
        void qc.invalidateQueries({
          queryKey: tasksKeys.byBoard(board_id),
        });
        void qc.invalidateQueries({
          queryKey: tasksKeys.byColumn(column_id),
        });
        void qc.invalidateQueries({ queryKey: tasksKeys.detail(id) });
      }),
    );
    sub(
      on("task.moved", ({ id, from_column_id, to_column_id, board_id }) => {
        // Both columns need to refetch; the board view picks up either
        // way. Detail key is invalidated so single-task views show the
        // new column.
        void qc.invalidateQueries({
          queryKey: tasksKeys.byBoard(board_id),
        });
        void qc.invalidateQueries({
          queryKey: tasksKeys.byColumn(from_column_id),
        });
        void qc.invalidateQueries({
          queryKey: tasksKeys.byColumn(to_column_id),
        });
        void qc.invalidateQueries({ queryKey: tasksKeys.detail(id) });
      }),
    );
    sub(
      on("task.deleted", ({ id, column_id, board_id }) => {
        void qc.invalidateQueries({
          queryKey: tasksKeys.byBoard(board_id),
        });
        void qc.invalidateQueries({
          queryKey: tasksKeys.byColumn(column_id),
        });
        qc.removeQueries({ queryKey: tasksKeys.detail(id) });
      }),
    );

    // ---------------- spaces / prompts / roles / tags ----------------
    //
    // These slices don't have query stores yet (E3+). We invalidate by
    // a stable top-level key string anyway so the day a slice lands
    // its `useXxx()` hooks, the listener already wakes them up. This
    // costs nothing today (no matching keys → no refetch) and saves
    // a return trip through this provider when the slice ships.
    sub(
      on("space.created", () => {
        void qc.invalidateQueries({ queryKey: ["spaces"] });
      }),
    );
    sub(
      on("space.updated", () => {
        void qc.invalidateQueries({ queryKey: ["spaces"] });
      }),
    );
    sub(
      on("space.deleted", () => {
        void qc.invalidateQueries({ queryKey: ["spaces"] });
      }),
    );
    sub(
      on("prompt.created", () => {
        void qc.invalidateQueries({ queryKey: ["prompts"] });
      }),
    );
    sub(
      on("prompt.updated", () => {
        void qc.invalidateQueries({ queryKey: ["prompts"] });
      }),
    );
    sub(
      on("prompt.deleted", () => {
        void qc.invalidateQueries({ queryKey: ["prompts"] });
      }),
    );
    sub(
      on("role.created", () => {
        void qc.invalidateQueries({ queryKey: ["roles"] });
      }),
    );
    sub(
      on("role.updated", () => {
        void qc.invalidateQueries({ queryKey: ["roles"] });
      }),
    );
    sub(
      on("role.deleted", () => {
        void qc.invalidateQueries({ queryKey: ["roles"] });
      }),
    );
    sub(
      on("tag.created", () => {
        void qc.invalidateQueries({ queryKey: ["tags"] });
      }),
    );
    sub(
      on("tag.updated", () => {
        void qc.invalidateQueries({ queryKey: ["tags"] });
      }),
    );
    sub(
      on("tag.deleted", () => {
        void qc.invalidateQueries({ queryKey: ["tags"] });
      }),
    );

    // ---------------- skills / mcp_tools ----------------
    //
    // These slices are back-filled in Round 6. Invalidate by stable
    // top-level key so existing entity slices (once they land) wake
    // immediately. Costs nothing today if no queries match.
    sub(
      on("skill.created", () => {
        void qc.invalidateQueries({ queryKey: ["skills"] });
      }),
    );
    sub(
      on("skill.updated", () => {
        void qc.invalidateQueries({ queryKey: ["skills"] });
      }),
    );
    sub(
      on("skill.deleted", () => {
        void qc.invalidateQueries({ queryKey: ["skills"] });
      }),
    );
    sub(
      on("mcp_tool.created", () => {
        void qc.invalidateQueries({ queryKey: ["mcp_tools"] });
      }),
    );
    sub(
      on("mcp_tool.updated", () => {
        void qc.invalidateQueries({ queryKey: ["mcp_tools"] });
      }),
    );
    sub(
      on("mcp_tool.deleted", () => {
        void qc.invalidateQueries({ queryKey: ["mcp_tools"] });
      }),
    );

    // ---------------- agent reports / attachments ----------------
    sub(
      on("agent_report.created", ({ task_id }) => {
        void qc.invalidateQueries({
          queryKey: ["agent_reports", "byTask", task_id],
        });
        void qc.invalidateQueries({ queryKey: ["agent_reports"] });
      }),
    );
    sub(
      on("agent_report.updated", ({ id, task_id }) => {
        void qc.invalidateQueries({
          queryKey: ["agent_reports", "byTask", task_id],
        });
        void qc.invalidateQueries({
          queryKey: ["agent_reports", "detail", id],
        });
      }),
    );
    sub(
      on("agent_report.deleted", ({ task_id }) => {
        void qc.invalidateQueries({
          queryKey: ["agent_reports", "byTask", task_id],
        });
      }),
    );
    sub(
      on("attachment.created", ({ task_id }) => {
        void qc.invalidateQueries({
          queryKey: ["attachments", "byTask", task_id],
        });
      }),
    );
    sub(
      on("attachment.updated", ({ task_id }) => {
        void qc.invalidateQueries({
          queryKey: ["attachments", "byTask", task_id],
        });
      }),
    );
    sub(
      on("attachment.deleted", ({ task_id }) => {
        void qc.invalidateQueries({
          queryKey: ["attachments", "byTask", task_id],
        });
      }),
    );

    // ---------------- import ----------------
    //
    // Successful import swaps the entire DB underneath us. Blow the
    // whole cache so every mounted query refetches against the new
    // data. Failed import is a no-op for the cache.
    sub(
      on("import.completed", () => {
        void qc.invalidateQueries();
      }),
    );

    // ---------------- generic refresh ----------------
    sub(
      on("app.refresh-required", () => {
        void qc.invalidateQueries();
      }),
    );

    return () => {
      // Sync release for handlers whose `on()` already resolved.
      for (const fn of resolved) fn();
      // For listeners still pending registration, tear them down once
      // they finish. If the component never re-mounts, this lets the
      // GC collect them; if it does, the new effect installs fresh
      // ones — no crossover state to worry about.
      for (const p of pending) {
        p.then((fn) => {
          fn();
        }).catch(() => {
          // Listener registration failed at startup — nothing to
          // unlisten. Already logged by Tauri's runtime.
        });
      }
    };
  }, [qc]);

  return <>{children}</>;
}
