/**
 * EventsProvider — bridges Tauri 2.x realtime events to react-query
 * cache invalidation (Wave-E2.5, D-022).
 *
 * On mount, subscribes to every event name emitted by the Rust IPC
 * layer (see `crates/api/src/events.rs`) and maps each to the right
 * `queryClient.invalidateQueries({ queryKey })` call. The query keys
 * mirror the per-entity stores in `entities/{board,column,task}/model`.
 *
 * Event-name format is `<domain>:<verb>` (colon-namespaced) per Tauri
 * 2.x's runtime allow-list (alphanumeric + `-/:_`); see the events
 * module for the source-of-truth constants.
 */

import { useEffect, type PropsWithChildren, type ReactElement } from "react";
import { useQueryClient } from "@tanstack/react-query";
import type { UnlistenFn } from "@tauri-apps/api/event";

import { boardsKeys } from "@entities/board";
import { columnsKeys } from "@entities/column";
import { tasksKeys } from "@entities/task";
import { connectedClientsKeys } from "@entities/connected-client";
import { on } from "@shared/api";

/** Top-level provider — wire listeners and tear them down on unmount. */
export function EventsProvider({
  children,
}: PropsWithChildren): ReactElement {
  const qc = useQueryClient();

  useEffect(() => {
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
      on("board:created", () => {
        void qc.invalidateQueries({ queryKey: boardsKeys.all });
      }),
    );
    sub(
      on("board:updated", ({ id }) => {
        void qc.invalidateQueries({ queryKey: boardsKeys.all });
        void qc.invalidateQueries({ queryKey: boardsKeys.detail(id) });
      }),
    );
    sub(
      on("board:deleted", ({ id }) => {
        void qc.invalidateQueries({ queryKey: boardsKeys.all });
        qc.removeQueries({ queryKey: boardsKeys.detail(id) });
      }),
    );

    // ---------------- columns ----------------
    sub(
      on("column:created", ({ board_id }) => {
        void qc.invalidateQueries({
          queryKey: columnsKeys.list(board_id),
        });
      }),
    );
    sub(
      on("column:updated", ({ id, board_id }) => {
        void qc.invalidateQueries({
          queryKey: columnsKeys.list(board_id),
        });
        void qc.invalidateQueries({ queryKey: columnsKeys.detail(id) });
      }),
    );
    sub(
      on("column:deleted", ({ id, board_id }) => {
        void qc.invalidateQueries({
          queryKey: columnsKeys.list(board_id),
        });
        qc.removeQueries({ queryKey: columnsKeys.detail(id) });
      }),
    );

    // ---------------- tasks ----------------
    sub(
      on("task:created", ({ column_id, board_id }) => {
        void qc.invalidateQueries({
          queryKey: tasksKeys.byBoard(board_id),
        });
        void qc.invalidateQueries({
          queryKey: tasksKeys.byColumn(column_id),
        });
      }),
    );
    sub(
      on("task:updated", ({ id, column_id, board_id }) => {
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
      on("task:moved", ({ id, from_column_id, to_column_id, board_id }) => {
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
      on("task:deleted", ({ id, column_id, board_id }) => {
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
    sub(
      on("space:created", () => {
        void qc.invalidateQueries({ queryKey: ["spaces"] });
      }),
    );
    sub(
      on("space:updated", () => {
        void qc.invalidateQueries({ queryKey: ["spaces"] });
      }),
    );
    sub(
      on("space:deleted", () => {
        void qc.invalidateQueries({ queryKey: ["spaces"] });
      }),
    );
    sub(
      on("prompt:created", () => {
        void qc.invalidateQueries({ queryKey: ["prompts"] });
      }),
    );
    sub(
      on("prompt:updated", () => {
        void qc.invalidateQueries({ queryKey: ["prompts"] });
      }),
    );
    sub(
      on("prompt:deleted", () => {
        void qc.invalidateQueries({ queryKey: ["prompts"] });
      }),
    );
    sub(
      on("role:created", () => {
        void qc.invalidateQueries({ queryKey: ["roles"] });
      }),
    );
    sub(
      on("role:updated", () => {
        void qc.invalidateQueries({ queryKey: ["roles"] });
      }),
    );
    sub(
      on("role:deleted", () => {
        void qc.invalidateQueries({ queryKey: ["roles"] });
      }),
    );
    sub(
      on("tag:created", () => {
        void qc.invalidateQueries({ queryKey: ["tags"] });
      }),
    );
    sub(
      on("tag:updated", () => {
        void qc.invalidateQueries({ queryKey: ["tags"] });
      }),
    );
    sub(
      on("tag:deleted", () => {
        void qc.invalidateQueries({ queryKey: ["tags"] });
      }),
    );

    // ---------------- skills / mcp_tools ----------------
    sub(
      on("skill:created", () => {
        void qc.invalidateQueries({ queryKey: ["skills"] });
      }),
    );
    sub(
      on("skill:updated", () => {
        void qc.invalidateQueries({ queryKey: ["skills"] });
      }),
    );
    sub(
      on("skill:deleted", () => {
        void qc.invalidateQueries({ queryKey: ["skills"] });
      }),
    );
    sub(
      on("mcp_tool:created", () => {
        void qc.invalidateQueries({ queryKey: ["mcp_tools"] });
      }),
    );
    sub(
      on("mcp_tool:updated", () => {
        void qc.invalidateQueries({ queryKey: ["mcp_tools"] });
      }),
    );
    sub(
      on("mcp_tool:deleted", () => {
        void qc.invalidateQueries({ queryKey: ["mcp_tools"] });
      }),
    );

    // ---------------- agent reports / attachments ----------------
    sub(
      on("agent_report:created", ({ task_id }) => {
        void qc.invalidateQueries({
          queryKey: ["agent_reports", "byTask", task_id],
        });
        void qc.invalidateQueries({ queryKey: ["agent_reports"] });
      }),
    );
    sub(
      on("agent_report:updated", ({ id, task_id }) => {
        void qc.invalidateQueries({
          queryKey: ["agent_reports", "byTask", task_id],
        });
        void qc.invalidateQueries({
          queryKey: ["agent_reports", "detail", id],
        });
      }),
    );
    sub(
      on("agent_report:deleted", ({ task_id }) => {
        void qc.invalidateQueries({
          queryKey: ["agent_reports", "byTask", task_id],
        });
      }),
    );
    sub(
      on("attachment:created", ({ task_id }) => {
        void qc.invalidateQueries({
          queryKey: ["attachments", "byTask", task_id],
        });
      }),
    );
    sub(
      on("attachment:updated", ({ task_id }) => {
        void qc.invalidateQueries({
          queryKey: ["attachments", "byTask", task_id],
        });
      }),
    );
    sub(
      on("attachment:deleted", ({ task_id }) => {
        void qc.invalidateQueries({
          queryKey: ["attachments", "byTask", task_id],
        });
      }),
    );

    // ---------------- prompt groups ----------------
    sub(
      on("prompt_group:created", () => {
        void qc.invalidateQueries({ queryKey: ["prompt_groups"] });
      }),
    );
    sub(
      on("prompt_group:updated", () => {
        void qc.invalidateQueries({ queryKey: ["prompt_groups"] });
      }),
    );
    sub(
      on("prompt_group:deleted", () => {
        void qc.invalidateQueries({ queryKey: ["prompt_groups"] });
      }),
    );
    sub(
      on("prompt_group:members_changed", ({ group_id }) => {
        void qc.invalidateQueries({
          queryKey: ["prompt_groups", "members", group_id],
        });
      }),
    );

    // ---------------- import ----------------
    sub(
      on("import:completed", () => {
        void qc.invalidateQueries();
      }),
    );

    // ---------------- connected clients (ctq-67 / ctq-68) ----------------
    sub(
      on("client:discovered", () => {
        void qc.invalidateQueries({
          queryKey: connectedClientsKeys.list(),
        });
      }),
    );
    sub(
      on("client:updated", () => {
        void qc.invalidateQueries({
          queryKey: connectedClientsKeys.list(),
        });
      }),
    );
    sub(
      on("client:removed", () => {
        void qc.invalidateQueries({
          queryKey: connectedClientsKeys.list(),
        });
      }),
    );
    sub(
      on("client:instructions_changed", ({ clientId }) => {
        void qc.invalidateQueries({
          queryKey: connectedClientsKeys.instructions(clientId),
        });
      }),
    );

    // ---------------- generic refresh ----------------
    sub(
      on("app:refresh-required", () => {
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
