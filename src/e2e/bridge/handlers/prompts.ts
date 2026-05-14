/**
 * Prompts command dispatcher + `list_prompt_tags_map` (the join read).
 * Tag attach/detach go through the tags handler.
 */

import type { Prompt } from "@bindings/Prompt";
import type { PromptTagMapEntry } from "@bindings/PromptTagMapEntry";

import { emitEvent } from "../events";
import { nextId } from "../ids";
import { store } from "../store";
import { nowBig } from "../time";

interface CreatePromptArgs {
  name: string;
  content: string;
  color?: string | null;
  shortDescription?: string | null;
  icon?: string | null;
  examples?: string[];
}

interface UpdatePromptArgs {
  id: string;
  name?: string;
  content?: string;
  color?: string | null;
  shortDescription?: string | null;
  icon?: string | null;
  examples?: string[];
}

export function handlePrompts(
  command: string,
  args: Record<string, unknown>,
): unknown {
  switch (command) {
    case "list_prompts":
      return Array.from(store.prompts.values()).sort((a, b) =>
        Number(a.createdAt - b.createdAt),
      );
    case "get_prompt": {
      const id = String(args["id"]);
      const p = store.prompts.get(id);
      if (!p) {
        throw {
          kind: "notFound",
          data: { entity: "prompt", id },
        };
      }
      return p;
    }
    case "create_prompt": {
      const a = args as unknown as CreatePromptArgs;
      const id = nextId("prompt");
      const ts = nowBig();
      const prompt: Prompt = {
        id,
        name: a.name,
        content: a.content,
        color: a.color ?? null,
        shortDescription: a.shortDescription ?? null,
        icon: a.icon ?? null,
        examples: a.examples ?? [],
        tokenCount: BigInt(Math.ceil((a.content.length + 3) / 4)),
        createdAt: ts,
        updatedAt: ts,
      };
      store.prompts.set(id, prompt);
      emitEvent("prompt:created", { id });
      return prompt;
    }
    case "update_prompt": {
      const a = args as unknown as UpdatePromptArgs;
      const prev = store.prompts.get(a.id);
      if (!prev) {
        throw {
          kind: "notFound",
          data: { entity: "prompt", id: a.id },
        };
      }
      const next: Prompt = {
        ...prev,
        ...(a.name !== undefined ? { name: a.name } : {}),
        ...(a.content !== undefined ? { content: a.content } : {}),
        ...(a.color !== undefined ? { color: a.color } : {}),
        ...(a.shortDescription !== undefined
          ? { shortDescription: a.shortDescription }
          : {}),
        ...(a.icon !== undefined ? { icon: a.icon } : {}),
        ...(a.examples !== undefined ? { examples: a.examples } : {}),
        updatedAt: nowBig(),
      };
      store.prompts.set(a.id, next);
      emitEvent("prompt:updated", { id: a.id });
      return next;
    }
    case "delete_prompt": {
      const id = String(args["id"]);
      store.prompts.delete(id);
      store.promptTags.delete(id);
      // Detach from groups + roles to keep snapshot consistent.
      for (const [gid, members] of store.promptGroupMembers) {
        store.promptGroupMembers.set(
          gid,
          members.filter((m) => m !== id),
        );
      }
      for (const [rid, members] of store.rolePrompts) {
        store.rolePrompts.set(
          rid,
          members.filter((m) => m !== id),
        );
      }
      emitEvent("prompt:deleted", { id });
      return null;
    }
    case "list_prompt_tags_map": {
      const out: PromptTagMapEntry[] = [];
      for (const [promptId, tagIds] of store.promptTags) {
        out.push({ promptId, tagIds });
      }
      return out;
    }
    case "recompute_prompt_token_count": {
      const id = String(args["id"]);
      const prev = store.prompts.get(id);
      if (!prev) {
        throw {
          kind: "notFound",
          data: { entity: "prompt", id },
        };
      }
      const next: Prompt = {
        ...prev,
        tokenCount: BigInt(Math.ceil((prev.content.length + 3) / 4)),
        updatedAt: nowBig(),
      };
      store.prompts.set(id, next);
      return next;
    }
    case "add_board_prompt":
    case "remove_board_prompt":
    case "add_column_prompt":
    case "remove_column_prompt":
      return null;
    default:
      return undefined;
  }
}
