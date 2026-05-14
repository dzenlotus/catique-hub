/**
 * Skills command dispatcher.
 *
 * Iteration-2 added the step CRUD surface (SKILL-V2-A) so the skill
 * editor's `<SkillStepsSection>` can round-trip per-skill steps. The
 * attachment + import surfaces stay no-op since no spec drives them.
 */

import type { Skill } from "@bindings/Skill";
import type { SkillStep } from "@bindings/SkillStep";

import { emitEvent } from "../events";
import { nextId } from "../ids";
import { store } from "../store";
import { nowBig } from "../time";

interface AddSkillStepArgs {
  skillId: string;
  title: string;
  body: string;
  expectedOutcome?: string | null;
  position?: number;
}

interface UpdateSkillStepArgs {
  id: string;
  title?: string;
  body?: string;
  expectedOutcome?: string | null;
  position?: number;
}

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
    // SKILL-V2-A steps: full CRUD against `store.skillSteps`.
    case "list_skill_steps": {
      const skillId = String(args["skillId"]);
      return Array.from(store.skillSteps.values())
        .filter((s) => s.skillId === skillId)
        .sort((a, b) => a.position - b.position);
    }
    case "add_skill_step": {
      const a = args as unknown as AddSkillStepArgs;
      const id = nextId("skill-step");
      const ts = nowBig();
      const existing = Array.from(store.skillSteps.values()).filter(
        (s) => s.skillId === a.skillId,
      );
      const step: SkillStep = {
        id,
        skillId: a.skillId,
        position: a.position ?? existing.length,
        title: a.title,
        body: a.body,
        expectedOutcome: a.expectedOutcome ?? null,
        createdAt: ts,
        updatedAt: ts,
      };
      store.skillSteps.set(id, step);
      return step;
    }
    case "update_skill_step": {
      const a = args as unknown as UpdateSkillStepArgs;
      const prev = store.skillSteps.get(a.id);
      if (!prev) return null;
      const next: SkillStep = {
        ...prev,
        ...(a.title !== undefined ? { title: a.title } : {}),
        ...(a.body !== undefined ? { body: a.body } : {}),
        ...(a.expectedOutcome !== undefined
          ? { expectedOutcome: a.expectedOutcome }
          : {}),
        ...(a.position !== undefined ? { position: a.position } : {}),
        updatedAt: nowBig(),
      };
      store.skillSteps.set(a.id, next);
      return next;
    }
    case "delete_skill_step": {
      const id = String(args["id"]);
      store.skillSteps.delete(id);
      return null;
    }
    case "reorder_skill_steps": {
      const stepIds = args["stepIds"] as string[];
      stepIds.forEach((id, idx) => {
        const step = store.skillSteps.get(id);
        if (!step) return;
        store.skillSteps.set(id, { ...step, position: idx });
      });
      return null;
    }
    // Other SKILL-V2 surfaces — empty / no-op outputs are enough for
    // iteration-2 since no spec drives them.
    case "list_skill_attachments":
    case "list_role_skills":
    case "list_task_skills":
      return [];
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
