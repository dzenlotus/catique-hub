/**
 * Tasks command dispatcher (iteration-2).
 *
 * The iteration-1 stubs in `misc.ts` returned `[]` / `null` for every
 * task command, which was fine when no spec touched kanban tasks.
 * Iteration-2 adds kanban scenarios (create, move, delete) that need a
 * persistent task store. This dispatcher owns the task surface; the
 * `misc.ts` stubs that are not implemented here still apply (rate,
 * step log, etc.).
 *
 * Position semantics: insertion appends to the end of the column
 * (max + 1, integer-monotonic). The frontend's `useMoveTaskMutation`
 * uses fractional positions when reordering inside a column — the
 * bridge accepts the wire payload as-is without renumbering, which is
 * fine because tests assert per-column membership, not exact position.
 */

import type { Task } from "@bindings/Task";

import { emitEvent } from "../events";
import { nextId } from "../ids";
import { store } from "../store";
import { nowBig } from "../time";

interface CreateTaskArgs {
  boardId: string;
  columnId: string;
  title: string;
  position: number;
  description?: string | null;
  roleId?: string | null;
}

interface UpdateTaskArgs {
  id: string;
  title?: string;
  description?: string | null;
  columnId?: string;
  position?: number;
  roleId?: string | null;
}

interface MoveTaskArgs {
  id: string;
  boardId: string;
  columnId: string;
  position: number;
}

export function handleTasks(
  command: string,
  args: Record<string, unknown>,
): unknown {
  switch (command) {
    case "list_tasks": {
      return Array.from(store.tasks.values()).sort(
        (a, b) => a.position - b.position,
      );
    }
    case "get_task": {
      const id = String(args["id"]);
      const t = store.tasks.get(id);
      return t ?? null;
    }
    case "create_task": {
      const a = args as unknown as CreateTaskArgs;
      const id = nextId("task");
      const ts = nowBig();
      const task: Task = {
        id,
        boardId: a.boardId,
        columnId: a.columnId,
        slug: id,
        title: a.title,
        description: a.description ?? null,
        position: a.position,
        roleId: a.roleId ?? null,
        createdAt: ts,
        updatedAt: ts,
        stepLog: "",
        // Refactor-v3 D-B: fresh tasks start with zero attached context.
        effectivePromptCount: 0n,
        effectiveSkillCount: 0n,
        effectiveToolCount: 0n,
      };
      store.tasks.set(id, task);
      emitEvent("task:created", { id });
      return task;
    }
    case "update_task": {
      const a = args as unknown as UpdateTaskArgs;
      const prev = store.tasks.get(a.id);
      if (!prev) return null;
      const next: Task = {
        ...prev,
        ...(a.title !== undefined ? { title: a.title } : {}),
        ...(a.description !== undefined ? { description: a.description } : {}),
        ...(a.columnId !== undefined ? { columnId: a.columnId } : {}),
        ...(a.position !== undefined ? { position: a.position } : {}),
        ...(a.roleId !== undefined ? { roleId: a.roleId } : {}),
        updatedAt: nowBig(),
      };
      store.tasks.set(a.id, next);
      return next;
    }
    case "delete_task": {
      const id = String(args["id"]);
      store.tasks.delete(id);
      emitEvent("task:deleted", { id });
      return null;
    }
    case "move_task": {
      const a = args as unknown as MoveTaskArgs;
      const prev = store.tasks.get(a.id);
      if (!prev) return null;
      const next: Task = {
        ...prev,
        columnId: a.columnId,
        position: a.position,
        updatedAt: nowBig(),
      };
      store.tasks.set(a.id, next);
      emitEvent("task:moved", { id: a.id });
      return next;
    }
    default:
      return undefined;
  }
}
