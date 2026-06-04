/**
 * In-memory state store for the mock Tauri bridge.
 *
 * Each entity gets a Map keyed by id. Tests can fully reset the store
 * via `__E2E_RESET__()` so scenarios stay isolated, or seed specific
 * fixtures via `__E2E_SEED__()`.
 *
 * Snake-case attachment maps (e.g. `rolePrompts`) mirror the Rust join
 * tables; values are ordered arrays of FK ids so attachment-order
 * assertions can read them directly.
 */

import type { Board } from "@bindings/Board";
import type { Column } from "@bindings/Column";
import type { McpServer } from "@bindings/McpServer";
import type { McpTool } from "@bindings/McpTool";
import type { McpToolGroup } from "@bindings/McpToolGroup";
import type { Prompt } from "@bindings/Prompt";
import type { PromptGroup } from "@bindings/PromptGroup";
import type { Role } from "@bindings/Role";
import type { Skill } from "@bindings/Skill";
import type { SkillStep } from "@bindings/SkillStep";
import type { Space } from "@bindings/Space";
import type { Tag } from "@bindings/Tag";
import type { Task } from "@bindings/Task";

import { resetIds } from "./ids";
import { resetClock } from "./time";

export interface MockStore {
  spaces: Map<string, Space>;
  boards: Map<string, Board>;
  columns: Map<string, Column>;
  roles: Map<string, Role>;
  prompts: Map<string, Prompt>;
  promptGroups: Map<string, PromptGroup>;
  skills: Map<string, Skill>;
  /** Per-skill ordered list of structured steps (SKILL-V2-A). */
  skillSteps: Map<string, SkillStep>;
  mcpServers: Map<string, McpServer>;
  mcpTools: Map<string, McpTool>;
  tags: Map<string, Tag>;
  /** Iteration-2: per-board task rows (id → Task). */
  tasks: Map<string, Task>;
  /** Join: promptId -> tagId[] (ordered set semantics). */
  promptTags: Map<string, string[]>;
  /** Join: groupId -> ordered promptId[]. */
  promptGroupMembers: Map<string, string[]>;
  /** Join: roleId -> ordered prompt-group id[] (groups as live units). */
  rolePromptGroups: Map<string, string[]>;
  /** Join: boardId -> ordered prompt-group id[]. */
  boardPromptGroups: Map<string, string[]>;
  /** Join: taskId -> ordered prompt-group id[]. */
  taskPromptGroups: Map<string, string[]>;
  /** MCP tool groups (entity) + members + attach joins. */
  mcpToolGroups: Map<string, McpToolGroup>;
  mcpToolGroupMembers: Map<string, string[]>;
  roleMcpToolGroups: Map<string, string[]>;
  boardMcpToolGroups: Map<string, string[]>;
  taskMcpToolGroups: Map<string, string[]>;
  /** Join: scope -> ordered mcp-server id[] (server as live unit). */
  roleMcpServers: Map<string, string[]>;
  boardMcpServers: Map<string, string[]>;
  taskMcpServers: Map<string, string[]>;
  /** Join: roleId -> ordered promptId[]. */
  rolePrompts: Map<string, string[]>;
  /** Join: roleId -> ordered skillId[]. */
  roleSkills: Map<string, string[]>;
  /** Join: roleId -> ordered mcpToolId[]. */
  roleMcpTools: Map<string, string[]>;
  /** Generic kv (settings + flags). */
  settings: Map<string, string>;
}

function freshStore(): MockStore {
  return {
    spaces: new Map(),
    boards: new Map(),
    columns: new Map(),
    roles: new Map(),
    prompts: new Map(),
    promptGroups: new Map(),
    skills: new Map(),
    skillSteps: new Map(),
    mcpServers: new Map(),
    mcpTools: new Map(),
    tags: new Map(),
    tasks: new Map(),
    promptTags: new Map(),
    promptGroupMembers: new Map(),
    rolePromptGroups: new Map(),
    boardPromptGroups: new Map(),
    taskPromptGroups: new Map(),
    mcpToolGroups: new Map(),
    mcpToolGroupMembers: new Map(),
    roleMcpToolGroups: new Map(),
    boardMcpToolGroups: new Map(),
    taskMcpToolGroups: new Map(),
    roleMcpServers: new Map(),
    boardMcpServers: new Map(),
    taskMcpServers: new Map(),
    rolePrompts: new Map(),
    roleSkills: new Map(),
    roleMcpTools: new Map(),
    settings: new Map(),
  };
}

export const store: MockStore = freshStore();

/** Wipe every map; called by `__E2E_RESET__()`. */
export function resetStore(): void {
  const next = freshStore();
  (Object.keys(next) as Array<keyof MockStore>).forEach((k) => {
    const m = store[k] as Map<unknown, unknown>;
    m.clear();
    (next[k] as Map<unknown, unknown>).forEach((v, key) => m.set(key, v));
  });
  resetIds();
  resetClock();
}

/** Serialised snapshot of every map — used by `__E2E_GET_STATE__()`. */
export function snapshot(): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  (Object.keys(store) as Array<keyof MockStore>).forEach((k) => {
    out[k] = Array.from((store[k] as Map<string, unknown>).entries());
  });
  return out;
}
