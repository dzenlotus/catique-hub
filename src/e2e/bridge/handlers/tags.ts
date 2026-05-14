/**
 * Tags command dispatcher (CRUD + the prompt_tags join helpers).
 */

import type { Tag } from "@bindings/Tag";

import { emitEvent } from "../events";
import { nextId } from "../ids";
import { store } from "../store";
import { nowBig } from "../time";

interface CreateTagArgs {
  name: string;
  color?: string | null;
}

interface UpdateTagArgs {
  id: string;
  name?: string;
  color?: string | null;
}

export function handleTags(
  command: string,
  args: Record<string, unknown>,
): unknown {
  switch (command) {
    case "list_tags":
      return Array.from(store.tags.values()).sort((a, b) =>
        a.name.localeCompare(b.name),
      );
    case "get_tag": {
      const id = String(args["id"]);
      const t = store.tags.get(id);
      if (!t) {
        throw {
          kind: "notFound",
          data: { entity: "tag", id },
        };
      }
      return t;
    }
    case "create_tag": {
      const a = args as unknown as CreateTagArgs;
      const id = nextId("tag");
      const ts = nowBig();
      const tag: Tag = {
        id,
        name: a.name,
        color: a.color ?? null,
        createdAt: ts,
        updatedAt: ts,
      };
      store.tags.set(id, tag);
      emitEvent("tag:created", { id });
      return tag;
    }
    case "update_tag": {
      const a = args as unknown as UpdateTagArgs;
      const prev = store.tags.get(a.id);
      if (!prev) {
        throw {
          kind: "notFound",
          data: { entity: "tag", id: a.id },
        };
      }
      const next: Tag = {
        ...prev,
        ...(a.name !== undefined ? { name: a.name } : {}),
        ...(a.color !== undefined ? { color: a.color } : {}),
        updatedAt: nowBig(),
      };
      store.tags.set(a.id, next);
      emitEvent("tag:updated", { id: a.id });
      return next;
    }
    case "delete_tag": {
      const id = String(args["id"]);
      store.tags.delete(id);
      // Detach from every prompt to keep snapshot consistent.
      for (const [pid, tagIds] of store.promptTags) {
        store.promptTags.set(
          pid,
          tagIds.filter((x) => x !== id),
        );
      }
      emitEvent("tag:deleted", { id });
      return null;
    }
    case "add_prompt_tag": {
      const promptId = String(args["promptId"]);
      const tagId = String(args["tagId"]);
      const list = store.promptTags.get(promptId) ?? [];
      if (!list.includes(tagId)) list.push(tagId);
      store.promptTags.set(promptId, list);
      return null;
    }
    case "remove_prompt_tag": {
      const promptId = String(args["promptId"]);
      const tagId = String(args["tagId"]);
      store.promptTags.set(
        promptId,
        (store.promptTags.get(promptId) ?? []).filter((x) => x !== tagId),
      );
      return null;
    }
    case "set_tag_prompts":
      return null;
    default:
      return undefined;
  }
}
