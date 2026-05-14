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
import { mcpServersKeys } from "@entities/mcp-server";
import { roleNotesKeys, roleNoteTagsKeys } from "@entities/role-note";
import {
  skillAttachmentsKeys,
  skillStepsKeys,
  skillsKeys,
} from "@entities/skill";
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
        void qc.invalidateQueries({ queryKey: tasksKeys.prompts(id) });
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
        // Any task could potentially now display a new prompt — broad
        // invalidation is simple and correct for v1 (N is small on desktop).
        void qc.invalidateQueries({ queryKey: tasksKeys.all });
      }),
    );
    sub(
      on("prompt:updated", () => {
        void qc.invalidateQueries({ queryKey: ["prompts"] });
        void qc.invalidateQueries({ queryKey: tasksKeys.all });
      }),
    );
    sub(
      on("prompt:deleted", () => {
        void qc.invalidateQueries({ queryKey: ["prompts"] });
        void qc.invalidateQueries({ queryKey: tasksKeys.all });
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

    // ---------------- role notes (ctq-137 / MEM-S1) ----------------
    sub(
      on("role_note:created", ({ roleId, noteId }) => {
        void qc.invalidateQueries({
          queryKey: roleNotesKeys.byRole(roleId),
        });
        void qc.invalidateQueries({
          queryKey: roleNoteTagsKeys.byRole(roleId),
        });
        void qc.invalidateQueries({ queryKey: roleNotesKeys.detail(noteId) });
      }),
    );
    sub(
      on("role_note:updated", ({ roleId, noteId }) => {
        void qc.invalidateQueries({
          queryKey: roleNotesKeys.byRole(roleId),
        });
        void qc.invalidateQueries({
          queryKey: roleNoteTagsKeys.byRole(roleId),
        });
        void qc.invalidateQueries({ queryKey: roleNotesKeys.detail(noteId) });
      }),
    );
    sub(
      on("role_note:deleted", ({ roleId, noteId }) => {
        void qc.invalidateQueries({
          queryKey: roleNotesKeys.byRole(roleId),
        });
        void qc.invalidateQueries({
          queryKey: roleNoteTagsKeys.byRole(roleId),
        });
        qc.removeQueries({ queryKey: roleNotesKeys.detail(noteId) });
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
    // ---------------- skill attachments (SKILL-S10 / S12) ----------------
    // Backend emits these when a file/git attachment row is inserted or
    // dropped. Both events carry `skillId` so we can invalidate only the
    // single per-skill list — broader invalidation would be wasteful on
    // pages that list many skills' editor panels.
    sub(
      on("skill:attachment_added", ({ skillId }) => {
        void qc.invalidateQueries({
          queryKey: skillAttachmentsKeys.byList(skillId),
        });
      }),
    );
    sub(
      on("skill:attachment_removed", ({ skillId }) => {
        void qc.invalidateQueries({
          queryKey: skillAttachmentsKeys.byList(skillId),
        });
      }),
    );
    // ---------------- skill steps (SKILL-V2-A / B) ----------------
    // Step events carry both the owning `skillId` and the `stepId`.
    // We only need `skillId` here — the steps cache is keyed by the
    // per-skill list, not by individual step ids.
    sub(
      on("skill_step:created", ({ skillId }) => {
        void qc.invalidateQueries({
          queryKey: skillStepsKeys.byList(skillId),
        });
      }),
    );
    sub(
      on("skill_step:updated", ({ skillId }) => {
        void qc.invalidateQueries({
          queryKey: skillStepsKeys.byList(skillId),
        });
      }),
    );
    sub(
      on("skill_step:deleted", ({ skillId }) => {
        void qc.invalidateQueries({
          queryKey: skillStepsKeys.byList(skillId),
        });
      }),
    );
    // Skill import touches overview (skills.detail), steps, and may
    // attach the source file — fan out invalidation across the trio.
    sub(
      on("skill:imported", ({ skillId }) => {
        void qc.invalidateQueries({ queryKey: skillsKeys.list() });
        void qc.invalidateQueries({ queryKey: skillsKeys.detail(skillId) });
        void qc.invalidateQueries({
          queryKey: skillStepsKeys.byList(skillId),
        });
        void qc.invalidateQueries({
          queryKey: skillAttachmentsKeys.byList(skillId),
        });
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

    // ---------------- mcp servers (PROXY-S6 / ADR-0008) ----------------
    // Per-server status and per-server tool lists hang off the same
    // root key (`["mcp_servers"]`) — invalidating the root cascades.
    // The Rust side emits `mcp_server:updated` whenever the row OR its
    // status changes (refresh + introspect-on-create both bump status),
    // so the dot and the tools list stay live without polling.
    sub(
      on("mcp_server:created", () => {
        void qc.invalidateQueries({ queryKey: mcpServersKeys.all });
      }),
    );
    sub(
      on("mcp_server:updated", ({ id }) => {
        void qc.invalidateQueries({ queryKey: mcpServersKeys.list() });
        void qc.invalidateQueries({ queryKey: mcpServersKeys.detail(id) });
        void qc.invalidateQueries({ queryKey: mcpServersKeys.status(id) });
        void qc.invalidateQueries({ queryKey: mcpServersKeys.tools(id) });
      }),
    );
    sub(
      on("mcp_server:deleted", ({ id }) => {
        void qc.invalidateQueries({ queryKey: mcpServersKeys.list() });
        qc.removeQueries({ queryKey: mcpServersKeys.detail(id) });
        qc.removeQueries({ queryKey: mcpServersKeys.status(id) });
        qc.removeQueries({ queryKey: mcpServersKeys.tools(id) });
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

    // ---------------- connected providers (round-21) ----------------
    // Provider lifecycle events still mirror the connected list query
    // key. The `client:` namespace is preserved on the wire; only the
    // semantics changed (no more discovery / instructions / per-card
    // sync).
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
    // Round-21: server-side sync fanout pushes its current state via
    // `sync:status_changed`. The topbar `useSyncStatus` query refetches
    // on this event so "Syncing…" → "Synced"/"Error" is reflected
    // without polling.
    sub(
      on("sync:status_changed", () => {
        void qc.invalidateQueries({
          queryKey: connectedClientsKeys.syncStatus(),
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
