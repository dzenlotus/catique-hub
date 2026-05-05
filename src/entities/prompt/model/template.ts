/**
 * Prompt-creation template — defaults applied by the create dialog.
 *
 * Persisted via `useLocalStorage` (no IPC, no SQLite row); the user
 * edits this from the PROMPTS sidebar settings popover and the create
 * dialog seeds its name/short-description/content fields from it.
 *
 * Schema is intentionally narrow — the affordances most users repeat
 * across prompts are content stubs and a description boilerplate.
 * Color/icon/tags already have ergonomic per-prompt pickers, so they
 * stay out of the template surface to keep it small.
 */

import { jsonCodec } from "@shared/storage";

export interface PromptTemplate {
  /** Default short description for new prompts. */
  shortDescription: string;
  /** Default Markdown body for new prompts. */
  content: string;
}

/** localStorage key. */
export const PROMPT_TEMPLATE_STORAGE_KEY = "catique:prompts:create-template";

/** Codec used by `useLocalStorage`. */
export const promptTemplateCodec = jsonCodec<PromptTemplate>();
