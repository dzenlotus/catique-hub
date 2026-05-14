/**
 * Columns command dispatcher — minimal, since the iteration-1 specs
 * don't exercise kanban-internal drag-and-drop. `list_columns` is the
 * shape `useColumns(boardId)` consumes (returns every column, the
 * frontend filters).
 */

import type { Column } from "@bindings/Column";

import { emitEvent } from "../events";
import { nextId } from "../ids";
import { store } from "../store";
import { nowBig } from "../time";

interface CreateColumnArgs {
  boardId: string;
  name: string;
  position: number;
}

interface UpdateColumnArgs {
  id: string;
  name?: string;
  position?: number;
  roleId?: string | null;
}

export function handleColumns(
  command: string,
  args: Record<string, unknown>,
): unknown {
  switch (command) {
    case "list_columns":
      return Array.from(store.columns.values());
    case "get_column": {
      const id = String(args["id"]);
      const c = store.columns.get(id);
      if (!c) {
        throw {
          kind: "notFound",
          data: { entity: "column", id },
        };
      }
      return c;
    }
    case "create_column": {
      const a = args as unknown as CreateColumnArgs;
      const id = nextId("column");
      const column: Column = {
        id,
        boardId: a.boardId,
        name: a.name,
        position: BigInt(a.position),
        roleId: null,
        createdAt: nowBig(),
        isDefault: false,
      };
      store.columns.set(id, column);
      emitEvent("column:created", { id, board_id: a.boardId });
      return column;
    }
    case "update_column": {
      const a = args as unknown as UpdateColumnArgs;
      const prev = store.columns.get(a.id);
      if (!prev) return null;
      const next: Column = {
        ...prev,
        ...(a.name !== undefined ? { name: a.name } : {}),
        ...(a.position !== undefined ? { position: BigInt(a.position) } : {}),
        ...(a.roleId !== undefined ? { roleId: a.roleId } : {}),
      };
      store.columns.set(a.id, next);
      emitEvent("column:updated", { id: a.id, board_id: next.boardId });
      return next;
    }
    case "set_column_prompts":
    case "set_column_skills":
    case "set_column_mcp_tools":
      return null;
    case "delete_column": {
      const id = String(args["id"]);
      const prev = store.columns.get(id);
      store.columns.delete(id);
      // Cascade tasks living in this column to keep the store sane.
      for (const [tid, t] of store.tasks) {
        if (t.columnId === id) store.tasks.delete(tid);
      }
      if (prev) {
        emitEvent("column:deleted", { id, board_id: prev.boardId });
      }
      return null;
    }
    default:
      return undefined;
  }
}
