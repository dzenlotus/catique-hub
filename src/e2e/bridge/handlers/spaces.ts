/**
 * Spaces command dispatcher.
 *
 * Implements every Rust command registered under
 * `handlers::spaces::*` that the frontend exercises:
 *   - create_space / update_space / delete_space / get_space / list_spaces
 *
 * Set-shape mutators (set_space_prompts, set_space_skills, etc.) and
 * `workflow_graph_json` getters are stubbed with sensible defaults so
 * the UI never sees a serde rejection from the bridge.
 */

import type { Column } from "@bindings/Column";
import type { Space } from "@bindings/Space";

import { emitEvent } from "../events";
import { nextId } from "../ids";
import { store } from "../store";
import { nowBig } from "../time";

const DEFAULT_COLUMN_NAMES = ["To do", "In progress", "Done"] as const;

/**
 * Seed the three canonical columns for a board. Duplicated from the
 * boards handler so cross-file imports don't pull on each other; the
 * function is small enough that the duplication isn't a maintenance
 * burden, and the bridge handlers all stay self-contained.
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
    };
    store.columns.set(id, column);
  });
}

interface CreateSpaceArgs {
  name: string;
  prefix: string;
  description?: string | null;
  color?: string | null;
  icon?: string | null;
  isDefault?: boolean;
  projectFolderPath?: string | null;
}

interface UpdateSpaceArgs {
  id: string;
  name?: string;
  description?: string | null;
  color?: string | null;
  icon?: string | null;
  isDefault?: boolean;
  position?: number;
  projectFolderPath?: string | null;
}

export function handleSpaces(
  command: string,
  args: Record<string, unknown>,
): unknown {
  switch (command) {
    case "list_spaces": {
      return Array.from(store.spaces.values()).sort(
        (a, b) =>
          a.position - b.position || a.name.localeCompare(b.name),
      );
    }
    case "get_space": {
      const id = String(args["id"]);
      const space = store.spaces.get(id);
      if (!space) {
        throw {
          kind: "notFound",
          data: { entity: "space", id },
        };
      }
      return space;
    }
    case "create_space": {
      const a = args as unknown as CreateSpaceArgs;
      const id = nextId("space");
      const ts = nowBig();
      const space: Space = {
        id,
        name: a.name,
        prefix: a.prefix,
        description: a.description ?? null,
        color: a.color ?? null,
        icon: a.icon ?? null,
        isDefault: a.isDefault ?? false,
        position: store.spaces.size,
        createdAt: ts,
        updatedAt: ts,
        workflowGraphJson: null,
        projectFolderPath: a.projectFolderPath ?? null,
      };
      store.spaces.set(id, space);

      // Bootstrap default board so creating a space behaves like the
      // Rust handler does — the user always sees at least one board.
      const boardId = nextId("board");
      store.boards.set(boardId, {
        id: boardId,
        name: "Default",
        spaceId: id,
        roleId: null,
        position: 0,
        description: null,
        color: null,
        icon: null,
        isDefault: true,
        createdAt: ts,
        updatedAt: ts,
        ownerRoleId: "maintainer-system",
      });
      // Seed the canonical kanban columns alongside the default board
      // so navigating into it doesn't drop the user on the empty
      // "Create column" state.
      seedDefaultColumns(boardId);
      emitEvent("space:created", { id });
      emitEvent("board:created", { id: boardId });
      return space;
    }
    case "update_space": {
      const a = args as unknown as UpdateSpaceArgs;
      const prev = store.spaces.get(a.id);
      if (!prev) {
        throw {
          kind: "notFound",
          data: { entity: "space", id: a.id },
        };
      }
      const next: Space = {
        ...prev,
        ...(a.name !== undefined ? { name: a.name } : {}),
        ...(a.description !== undefined ? { description: a.description } : {}),
        ...(a.color !== undefined ? { color: a.color } : {}),
        ...(a.icon !== undefined ? { icon: a.icon } : {}),
        ...(a.isDefault !== undefined ? { isDefault: a.isDefault } : {}),
        ...(a.position !== undefined ? { position: a.position } : {}),
        ...(a.projectFolderPath !== undefined
          ? { projectFolderPath: a.projectFolderPath }
          : {}),
        updatedAt: nowBig(),
      };
      store.spaces.set(a.id, next);
      emitEvent("space:updated", { id: a.id });
      return next;
    }
    case "delete_space": {
      const id = String(args["id"]);
      store.spaces.delete(id);
      // Cascade boards owned by this space.
      for (const [bid, b] of store.boards) {
        if (b.spaceId === id) store.boards.delete(bid);
      }
      emitEvent("space:deleted", { id });
      return null;
    }
    case "list_space_prompts":
    case "list_space_skills":
    case "list_space_mcp_tools":
      return [];
    case "add_space_prompt":
    case "remove_space_prompt":
    case "set_space_prompts":
    case "set_space_skills":
    case "set_space_mcp_tools":
      return null;
    case "get_workflow_graph":
      return null;
    case "set_workflow_graph":
      return null;
    default:
      return undefined;
  }
}
