/**
 * Roles command dispatcher (CRUD + the three attachment joins).
 *
 * The role-editor surfaces drive bulk replace through `set_role_prompts`
 * (ctq-108) and per-row add/remove for skills + MCP tools.
 */

import type { McpTool } from "@bindings/McpTool";
import type { Prompt } from "@bindings/Prompt";
import type { Role } from "@bindings/Role";
import type { Skill } from "@bindings/Skill";

import { emitEvent } from "../events";
import { nextId } from "../ids";
import { store } from "../store";
import { nowBig } from "../time";

interface CreateRoleArgs {
  name: string;
  content?: string;
  color?: string | null;
  icon?: string | null;
}

interface UpdateRoleArgs {
  id: string;
  name?: string;
  content?: string | null;
  color?: string | null;
  icon?: string | null;
}

export function handleRoles(
  command: string,
  args: Record<string, unknown>,
): unknown {
  switch (command) {
    case "list_roles":
      return Array.from(store.roles.values()).sort((a, b) =>
        a.name.localeCompare(b.name),
      );
    case "get_role": {
      const id = String(args["id"]);
      const r = store.roles.get(id);
      if (!r) {
        throw {
          kind: "notFound",
          data: { entity: "role", id },
        };
      }
      return r;
    }
    case "create_role": {
      const a = args as unknown as CreateRoleArgs;
      const id = nextId("role");
      const ts = nowBig();
      const role: Role = {
        id,
        name: a.name,
        content: a.content ?? "",
        color: a.color ?? null,
        icon: a.icon ?? null,
        createdAt: ts,
        updatedAt: ts,
        isSystem: false,
      };
      store.roles.set(id, role);
      store.rolePrompts.set(id, []);
      store.roleSkills.set(id, []);
      store.roleMcpTools.set(id, []);
      emitEvent("role:created", { id });
      return role;
    }
    case "update_role": {
      const a = args as unknown as UpdateRoleArgs;
      const prev = store.roles.get(a.id);
      if (!prev) {
        throw {
          kind: "notFound",
          data: { entity: "role", id: a.id },
        };
      }
      const next: Role = {
        ...prev,
        ...(a.name !== undefined ? { name: a.name } : {}),
        ...(a.content !== undefined ? { content: a.content ?? "" } : {}),
        ...(a.color !== undefined ? { color: a.color } : {}),
        ...(a.icon !== undefined ? { icon: a.icon } : {}),
        updatedAt: nowBig(),
      };
      store.roles.set(a.id, next);
      emitEvent("role:updated", { id: a.id });
      return next;
    }
    case "delete_role": {
      const id = String(args["id"]);
      store.roles.delete(id);
      store.rolePrompts.delete(id);
      store.roleSkills.delete(id);
      store.roleMcpTools.delete(id);
      emitEvent("role:deleted", { id });
      return null;
    }
    case "list_role_prompts": {
      const roleId = String(args["roleId"]);
      const ids = store.rolePrompts.get(roleId) ?? [];
      const out: Prompt[] = [];
      for (const pid of ids) {
        const p = store.prompts.get(pid);
        if (p) out.push(p);
      }
      return out;
    }
    case "add_role_prompt": {
      const roleId = String(args["roleId"]);
      const promptId = String(args["promptId"]);
      const list = store.rolePrompts.get(roleId) ?? [];
      if (!list.includes(promptId)) list.push(promptId);
      store.rolePrompts.set(roleId, list);
      return null;
    }
    case "remove_role_prompt": {
      const roleId = String(args["roleId"]);
      const promptId = String(args["promptId"]);
      store.rolePrompts.set(
        roleId,
        (store.rolePrompts.get(roleId) ?? []).filter((x) => x !== promptId),
      );
      return null;
    }
    case "set_role_prompts": {
      const roleId = String(args["roleId"]);
      const ids = args["promptIds"] as string[];
      store.rolePrompts.set(roleId, [...ids]);
      return null;
    }
    case "list_role_skills": {
      const roleId = String(args["roleId"]);
      const ids = store.roleSkills.get(roleId) ?? [];
      const out: Skill[] = [];
      for (const sid of ids) {
        const s = store.skills.get(sid);
        if (s) out.push(s);
      }
      return out;
    }
    case "add_role_skill": {
      const roleId = String(args["roleId"]);
      const skillId = String(args["skillId"]);
      const list = store.roleSkills.get(roleId) ?? [];
      if (!list.includes(skillId)) list.push(skillId);
      store.roleSkills.set(roleId, list);
      return null;
    }
    case "remove_role_skill": {
      const roleId = String(args["roleId"]);
      const skillId = String(args["skillId"]);
      store.roleSkills.set(
        roleId,
        (store.roleSkills.get(roleId) ?? []).filter((x) => x !== skillId),
      );
      return null;
    }
    case "list_role_mcp_tools": {
      const roleId = String(args["roleId"]);
      const ids = store.roleMcpTools.get(roleId) ?? [];
      const out: McpTool[] = [];
      for (const tid of ids) {
        const t = store.mcpTools.get(tid);
        if (t) out.push(t);
      }
      return out;
    }
    case "add_role_mcp_tool": {
      const roleId = String(args["roleId"]);
      const mcpToolId = String(args["mcpToolId"]);
      const list = store.roleMcpTools.get(roleId) ?? [];
      if (!list.includes(mcpToolId)) list.push(mcpToolId);
      store.roleMcpTools.set(roleId, list);
      return null;
    }
    case "remove_role_mcp_tool": {
      const roleId = String(args["roleId"]);
      const mcpToolId = String(args["mcpToolId"]);
      store.roleMcpTools.set(
        roleId,
        (store.roleMcpTools.get(roleId) ?? []).filter((x) => x !== mcpToolId),
      );
      return null;
    }
    default:
      return undefined;
  }
}
