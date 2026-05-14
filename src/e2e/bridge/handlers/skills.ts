/**
 * Skills command dispatcher (CRUD only — SKILL-V2 attachment + step
 * surfaces stay no-op since iteration-1 scenarios don't touch them).
 */

import type { Skill } from "@bindings/Skill";

import { emitEvent } from "../events";
import { nextId } from "../ids";
import { store } from "../store";
import { nowBig } from "../time";

interface CreateSkillArgs {
  name: string;
  description?: string | null;
  color?: string | null;
  position: number;
}

interface UpdateSkillArgs {
  id: string;
  name?: string;
  description?: string | null;
  color?: string | null;
  position?: number;
}

export function handleSkills(
  command: string,
  args: Record<string, unknown>,
): unknown {
  switch (command) {
    case "list_skills":
      return Array.from(store.skills.values()).sort(
        (a, b) =>
          a.position - b.position || a.name.localeCompare(b.name),
      );
    case "get_skill": {
      const id = String(args["id"]);
      const s = store.skills.get(id);
      if (!s) {
        throw {
          kind: "notFound",
          data: { entity: "skill", id },
        };
      }
      return s;
    }
    case "create_skill": {
      const a = args as unknown as CreateSkillArgs;
      const id = nextId("skill");
      const ts = nowBig();
      const skill: Skill = {
        id,
        name: a.name,
        description: a.description ?? null,
        color: a.color ?? null,
        position: a.position ?? store.skills.size,
        createdAt: ts,
        updatedAt: ts,
      };
      store.skills.set(id, skill);
      emitEvent("skill:created", { id });
      return skill;
    }
    case "update_skill": {
      const a = args as unknown as UpdateSkillArgs;
      const prev = store.skills.get(a.id);
      if (!prev) {
        throw {
          kind: "notFound",
          data: { entity: "skill", id: a.id },
        };
      }
      const next: Skill = {
        ...prev,
        ...(a.name !== undefined ? { name: a.name } : {}),
        ...(a.description !== undefined ? { description: a.description } : {}),
        ...(a.color !== undefined ? { color: a.color } : {}),
        ...(a.position !== undefined ? { position: a.position } : {}),
        updatedAt: nowBig(),
      };
      store.skills.set(a.id, next);
      emitEvent("skill:updated", { id: a.id });
      return next;
    }
    case "delete_skill": {
      const id = String(args["id"]);
      store.skills.delete(id);
      emitEvent("skill:deleted", { id });
      return null;
    }
    // SKILL-V2-A / B step + attachment surfaces — empty list / no-op
    // outputs are enough for iteration-1.
    case "list_skill_steps":
    case "list_skill_attachments":
    case "list_role_skills":
    case "list_task_skills":
      return [];
    case "add_skill_step":
    case "update_skill_step":
    case "delete_skill_step":
    case "reorder_skill_steps":
    case "add_skill_file_attachment":
    case "add_skill_git_attachment":
    case "remove_skill_attachment":
    case "add_task_skill":
    case "remove_task_skill":
    case "import_skill_from_url":
      return null;
    default:
      return undefined;
  }
}
