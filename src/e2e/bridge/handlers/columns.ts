/**
 * Columns command dispatcher — minimal, since the iteration-1 specs
 * don't exercise kanban-internal drag-and-drop. `list_columns` is the
 * shape `useColumns(boardId)` consumes (returns every column, the
 * frontend filters).
 */

import type { Column } from "@bindings/Column";

import { nextId } from "../ids";
import { store } from "../store";
import { nowBig } from "../time";

interface CreateColumnArgs {
  boardId: string;
  name: string;
  position: number;
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
      return column;
    }
    case "update_column":
    case "set_column_prompts":
    case "set_column_skills":
    case "set_column_mcp_tools":
      return null;
    case "delete_column": {
      const id = String(args["id"]);
      store.columns.delete(id);
      return null;
    }
    default:
      return undefined;
  }
}
