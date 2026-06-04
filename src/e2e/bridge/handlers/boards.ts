/**
 * Boards command dispatcher.
 *
 * Covers create/update/delete/get/list and the per-board bulk setters
 * the frontend dispatches from BoardSettings. Validation is intentionally
 * permissive — bridge isn't a foreign-key linter.
 */

import type { Board } from "@bindings/Board";
import type { Column } from "@bindings/Column";

import { emitEvent } from "../events";
import { nextId } from "../ids";
import { store } from "../store";
import { nowBig } from "../time";

const DEFAULT_COLUMN_NAMES = ["To do", "In progress", "Done"] as const;

// Refactor-v3 D-F: bridge-only state for the Pinned / Recent IPC. The
// real backend stores `(board_id, position, pinned_at)` and
// `(board_id, visited_at)` respectively; the bridge models just enough
// of that shape to round-trip ordering through the spec suite.
const pinned = new Map<string, { position: number; pinnedAt: number }>();
const recent: Array<{ boardId: string; visitedAt: number }> = [];
const RECENT_LIMIT = 5;
let visitClock = 0;
let pinClock = 0;

function pinnedBoardsOrdered(): Board[] {
  return Array.from(pinned.entries())
    .sort(([, a], [, b]) => a.position - b.position || a.pinnedAt - b.pinnedAt)
    .map(([id]) => store.boards.get(id))
    .filter((b): b is Board => b !== undefined);
}

function recentBoardsOrdered(): Board[] {
  // Recency-sorted, cap to RECENT_LIMIT, drop rows whose board no
  // longer exists (mirrors the Rust CASCADE behaviour).
  return [...recent]
    .sort((a, b) => b.visitedAt - a.visitedAt)
    .slice(0, RECENT_LIMIT)
    .map((r) => store.boards.get(r.boardId))
    .filter((b): b is Board => b !== undefined);
}

function pinBoardLocal(boardId: string): void {
  if (pinned.has(boardId)) return;
  const next = Math.max(0, ...Array.from(pinned.values()).map((p) => p.position)) + 1;
  pinClock += 1;
  pinned.set(boardId, { position: next, pinnedAt: pinClock });
}

function unpinBoardLocal(boardId: string): void {
  pinned.delete(boardId);
}

function reorderPinnedLocal(boardId: string, newPosition: number): void {
  const row = pinned.get(boardId);
  if (row === undefined) return;
  row.position = newPosition;
}

function trackVisitLocal(boardId: string): void {
  visitClock += 1;
  const existing = recent.find((r) => r.boardId === boardId);
  if (existing) {
    existing.visitedAt = visitClock;
  } else {
    recent.push({ boardId, visitedAt: visitClock });
  }
  // Prune to RECENT_LIMIT by recency.
  recent.sort((a, b) => b.visitedAt - a.visitedAt);
  recent.splice(RECENT_LIMIT);
}

function cascadeBoardDelete(boardId: string): void {
  pinned.delete(boardId);
  const idx = recent.findIndex((r) => r.boardId === boardId);
  if (idx >= 0) recent.splice(idx, 1);
}

/**
 * Reset the bridge-local pinned / recent state. Wired into
 * `__E2E_RESET__()` indirectly: the parent reset clears `store.boards`,
 * which has no FK link to these private maps, so we expose this for
 * the bridge harness to call explicitly when needed.
 */
export function resetPinnedRecentBridgeState(): void {
  pinned.clear();
  recent.length = 0;
  visitClock = 0;
  pinClock = 0;
}

/**
 * Seed the three canonical columns ("To do", "In progress", "Done")
 * for a board. Mirrors the Rust `create_board` behaviour so the kanban
 * UI doesn't open into the "No columns yet" empty state during e2e.
 */
function seedDefaultColumns(boardId: string): void {
  DEFAULT_COLUMN_NAMES.forEach((name, idx) => {
    const id = nextId("column");
    const column: Column = {
      id,
      boardId,
      name,
      position: BigInt(idx),
      roleId: null,
      createdAt: nowBig(),
      isDefault: true,
      icon: null,
      color: null,
    };
    store.columns.set(id, column);
  });
}

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
      // Bridge-only convenience: matches Rust's `create_board` which
      // seeds three default columns. Iteration-2 scenarios assert the
      // rendered defaults appear in the kanban, so the bridge has to
      // create them or the UI would show the "no columns" empty state.
      seedDefaultColumns(id);
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
      // Refactor-v3 D-F: mirror the SQL CASCADE so the Pinned /
      // Recent IPC handlers stop reporting the dropped board.
      cascadeBoardDelete(id);
      emitEvent("board:deleted", { id });
      return null;
    }
    case "set_board_prompts":
    case "set_board_skills":
    case "set_board_mcp_tools":
      return null;
    case "set_board_owner": {
      // ctq-101: rewrite the owner role and return the authoritative
      // board, mirroring the real `set_board_owner` handler.
      const id = String(args["boardId"]);
      const prev = store.boards.get(id);
      if (!prev) {
        throw { kind: "notFound", data: { entity: "board", id } };
      }
      const next: Board = {
        ...prev,
        ownerRoleId: String(args["roleId"]),
        updatedAt: nowBig(),
      };
      store.boards.set(id, next);
      emitEvent("board:updated", { id });
      return next;
    }

    // ---------------- pinned / recent (refactor-v3 D-F) ----------------
    case "list_pinned_boards":
      return pinnedBoardsOrdered();
    case "pin_board": {
      pinBoardLocal(String(args["boardId"]));
      return null;
    }
    case "unpin_board": {
      unpinBoardLocal(String(args["boardId"]));
      return null;
    }
    case "reorder_pinned": {
      reorderPinnedLocal(
        String(args["boardId"]),
        Number(args["newPosition"] ?? 0),
      );
      return null;
    }
    case "list_recent_boards":
      return recentBoardsOrdered();
    case "track_board_visit": {
      trackVisitLocal(String(args["boardId"]));
      return null;
    }
    case "clear_recent_boards": {
      recent.length = 0;
      visitClock = 0;
      return null;
    }

    default:
      return undefined;
  }
}
