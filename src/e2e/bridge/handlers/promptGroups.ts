/**
 * Prompt groups command dispatcher (CRUD + membership join).
 */

import type { PromptGroup } from "@bindings/PromptGroup";

import { emitEvent } from "../events";
import { nextId } from "../ids";
import { store } from "../store";
import { nowBig } from "../time";

interface CreatePromptGroupArgs {
  name: string;
  color?: string | null;
  icon?: string | null;
  position?: number;
}

interface UpdatePromptGroupArgs {
  id: string;
  name?: string;
  color?: string | null;
  icon?: string | null;
  position?: number;
}

export function handlePromptGroups(
  command: string,
  args: Record<string, unknown>,
): unknown {
  switch (command) {
    case "list_prompt_groups":
      return Array.from(store.promptGroups.values()).sort((a, b) =>
        Number(a.position - b.position),
      );
    case "get_prompt_group": {
      const id = String(args["id"]);
      const g = store.promptGroups.get(id);
      if (!g) {
        throw {
          kind: "notFound",
          data: { entity: "prompt_group", id },
        };
      }
      return g;
    }
    case "create_prompt_group": {
      const a = args as unknown as CreatePromptGroupArgs;
      const id = nextId("group");
      const ts = nowBig();
      const group: PromptGroup = {
        id,
        name: a.name,
        color: a.color ?? null,
        icon: a.icon ?? null,
        position: BigInt(a.position ?? store.promptGroups.size),
        createdAt: ts,
        updatedAt: ts,
      };
      store.promptGroups.set(id, group);
      store.promptGroupMembers.set(id, []);
      emitEvent("prompt_group:created", { id });
      return group;
    }
    case "update_prompt_group": {
      const a = args as unknown as UpdatePromptGroupArgs;
      const prev = store.promptGroups.get(a.id);
      if (!prev) {
        throw {
          kind: "notFound",
          data: { entity: "prompt_group", id: a.id },
        };
      }
      const next: PromptGroup = {
        ...prev,
        ...(a.name !== undefined ? { name: a.name } : {}),
        ...(a.color !== undefined ? { color: a.color } : {}),
        ...(a.icon !== undefined ? { icon: a.icon } : {}),
        ...(a.position !== undefined ? { position: BigInt(a.position) } : {}),
        updatedAt: nowBig(),
      };
      store.promptGroups.set(a.id, next);
      emitEvent("prompt_group:updated", { id: a.id });
      return next;
    }
    case "delete_prompt_group": {
      const id = String(args["id"]);
      store.promptGroups.delete(id);
      store.promptGroupMembers.delete(id);
      emitEvent("prompt_group:deleted", { id });
      return null;
    }
    case "list_prompt_group_members": {
      const groupId = String(args["groupId"]);
      return store.promptGroupMembers.get(groupId) ?? [];
    }
    case "add_prompt_group_member": {
      const groupId = String(args["groupId"]);
      const promptId = String(args["promptId"]);
      const members = store.promptGroupMembers.get(groupId) ?? [];
      if (!members.includes(promptId)) members.push(promptId);
      store.promptGroupMembers.set(groupId, members);
      emitEvent("prompt_group:members_changed", { group_id: groupId });
      return null;
    }
    case "remove_prompt_group_member": {
      const groupId = String(args["groupId"]);
      const promptId = String(args["promptId"]);
      const members = (store.promptGroupMembers.get(groupId) ?? []).filter(
        (m) => m !== promptId,
      );
      store.promptGroupMembers.set(groupId, members);
      emitEvent("prompt_group:members_changed", { group_id: groupId });
      return null;
    }
    case "set_prompt_group_members": {
      const groupId = String(args["groupId"]);
      const ids = args["orderedPromptIds"] as string[];
      store.promptGroupMembers.set(groupId, [...ids]);
      emitEvent("prompt_group:members_changed", { group_id: groupId });
      return null;
    }
    // ── group attachment (groups as live units) ──────────────────────
    case "list_role_prompt_groups":
      return store.rolePromptGroups.get(String(args["roleId"])) ?? [];
    case "set_role_prompt_groups": {
      const roleId = String(args["roleId"]);
      store.rolePromptGroups.set(roleId, [...(args["groupIds"] as string[])]);
      emitEvent("role:updated", { id: roleId });
      return null;
    }
    case "list_board_prompt_groups":
      return store.boardPromptGroups.get(String(args["boardId"])) ?? [];
    case "set_board_prompt_groups": {
      const boardId = String(args["boardId"]);
      store.boardPromptGroups.set(boardId, [...(args["groupIds"] as string[])]);
      emitEvent("board:updated", { id: boardId });
      return null;
    }
    case "list_task_prompt_groups":
      return store.taskPromptGroups.get(String(args["taskId"])) ?? [];
    case "set_task_prompt_groups": {
      const taskId = String(args["taskId"]);
      store.taskPromptGroups.set(taskId, [...(args["groupIds"] as string[])]);
      emitEvent("task:updated", { id: taskId });
      return null;
    }
    default:
      return undefined;
  }
}
