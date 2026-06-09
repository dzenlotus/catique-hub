/**
 * Task-templates command dispatcher (catique-1).
 *
 * Backs the mock IPC surface for task templates so the TaskCreateDialog
 * template picker is drivable in Playwright. The store is seeded with
 * the three built-ins (see `store.seedTaskTemplates`).
 */

import type { TaskTemplate } from "@bindings/TaskTemplate";

import { emitEvent } from "../events";
import { nextId } from "../ids";
import { store } from "../store";
import { nowBig } from "../time";

export function handleTaskTemplates(
  command: string,
  args: Record<string, unknown>,
): unknown {
  switch (command) {
    case "list_task_templates": {
      return Array.from(store.taskTemplates.values()).sort(
        (a, b) => a.position - b.position,
      );
    }
    case "get_task_template": {
      const id = String(args["id"]);
      return store.taskTemplates.get(id) ?? null;
    }
    case "create_task_template": {
      const id = nextId("tmpl");
      const now = nowBig();
      const tmpl: TaskTemplate = {
        id,
        name: String(args["name"]),
        kind: (args["kind"] as TaskTemplate["kind"]) ?? "custom",
        description:
          typeof args["description"] === "string" ? args["description"] : "",
        body: typeof args["body"] === "string" ? args["body"] : "",
        icon: typeof args["icon"] === "string" ? args["icon"] : null,
        color: typeof args["color"] === "string" ? args["color"] : null,
        position: store.taskTemplates.size,
        createdAt: now,
        updatedAt: now,
      };
      store.taskTemplates.set(id, tmpl);
      emitEvent("task_template:created", { id });
      return tmpl;
    }
    case "update_task_template": {
      const id = String(args["id"]);
      const prev = store.taskTemplates.get(id);
      if (!prev) return null;
      const next: TaskTemplate = {
        ...prev,
        ...(typeof args["name"] === "string" ? { name: args["name"] } : {}),
        ...(typeof args["kind"] === "string"
          ? { kind: args["kind"] as TaskTemplate["kind"] }
          : {}),
        ...(typeof args["description"] === "string"
          ? { description: args["description"] }
          : {}),
        ...(typeof args["body"] === "string" ? { body: args["body"] } : {}),
        updatedAt: nowBig(),
      };
      store.taskTemplates.set(id, next);
      emitEvent("task_template:updated", { id });
      return next;
    }
    case "delete_task_template": {
      const id = String(args["id"]);
      store.taskTemplates.delete(id);
      emitEvent("task_template:deleted", { id });
      return null;
    }
    default:
      return undefined;
  }
}
