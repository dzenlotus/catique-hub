/**
 * Boards command dispatcher.
 *
 * Covers create/update/delete/get/list and the per-board bulk setters
 * the frontend dispatches from BoardSettings. Validation is intentionally
 * permissive — bridge isn't a foreign-key linter.
 */

import type { Board } from "@bindings/Board";

import { emitEvent } from "../events";
import { nextId } from "../ids";
import { store } from "../store";
import { nowBig } from "../time";

interface CreateBoardArgs {
  name: string;
  spaceId: string;
  ownerRoleId?: string;
  description?: string | null;
  color?: string | null;
  icon?: string | null;
}

interface UpdateBoardArgs {
  id: string;
  name?: string;
  spaceId?: string;
  position?: number;
  description?: string | null;
  color?: string | null;
  icon?: string | null;
}

export function handleBoards(
  command: string,
  args: Record<string, unknown>,
): unknown {
  switch (command) {
    case "list_boards": {
      return Array.from(store.boards.values()).sort(
        (a, b) =>
          a.spaceId.localeCompare(b.spaceId) || a.position - b.position,
      );
    }
    case "get_board": {
      const id = String(args["id"]);
      const b = store.boards.get(id);
      if (!b) {
        throw {
          kind: "notFound",
          data: { entity: "board", id },
        };
      }
      return b;
    }
    case "create_board": {
      const a = args as unknown as CreateBoardArgs;
      const id = nextId("board");
      const ts = nowBig();
      const board: Board = {
        id,
        name: a.name,
        spaceId: a.spaceId,
        roleId: null,
        position: Array.from(store.boards.values()).filter(
          (x) => x.spaceId === a.spaceId,
        ).length,
        description: a.description ?? null,
        color: a.color ?? null,
        icon: a.icon ?? null,
        isDefault: false,
        createdAt: ts,
        updatedAt: ts,
        ownerRoleId: a.ownerRoleId ?? "maintainer-system",
      };
      store.boards.set(id, board);
      emitEvent("board:created", { id });
      return board;
    }
    case "update_board": {
      const a = args as unknown as UpdateBoardArgs;
      const prev = store.boards.get(a.id);
      if (!prev) {
        throw {
          kind: "notFound",
          data: { entity: "board", id: a.id },
        };
      }
      const next: Board = {
        ...prev,
        ...(a.name !== undefined ? { name: a.name } : {}),
        ...(a.spaceId !== undefined ? { spaceId: a.spaceId } : {}),
        ...(a.position !== undefined ? { position: a.position } : {}),
        ...(a.description !== undefined ? { description: a.description } : {}),
        ...(a.color !== undefined ? { color: a.color } : {}),
        ...(a.icon !== undefined ? { icon: a.icon } : {}),
        updatedAt: nowBig(),
      };
      store.boards.set(a.id, next);
      emitEvent("board:updated", { id: a.id });
      return next;
    }
    case "delete_board": {
      const id = String(args["id"]);
      store.boards.delete(id);
      emitEvent("board:deleted", { id });
      return null;
    }
    case "set_board_prompts":
    case "set_board_skills":
    case "set_board_mcp_tools":
    case "set_board_owner":
      return null;
    default:
      return undefined;
  }
}
