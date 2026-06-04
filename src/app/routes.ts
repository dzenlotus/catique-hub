/**
 * Route map for Catique HUB.
 *
 * All top-level nav views have a canonical URL path. Board-detail and
 * task-detail routes embed the entity id as a path segment so they are
 * directly deep-linkable.
 *
 * Refactor v3 introduced space-scoped board URLs and renamed `/roles →
 * /agents`, `/mcp-servers → /integrations`. Legacy paths stay routable
 * for one release and rewrite into the canonical form via the
 * `legacy-redirect` resolver (see `docs/refactor-v3/decisions/D-E-*`).
 */

import type { NavView } from "@widgets/main-sidebar";

// ---------------------------------------------------------------------------
// Route constants
// ---------------------------------------------------------------------------

export const routes = {
  /** v3 Home — redirects to `last_active_space` or shows space picker. */
  home: "/",
  /** Legacy boards root — kept as a navigable alias for one release. */
  boards: "/",
  /** Legacy board detail — redirects to `spaceBoard` via lookup. */
  board: "/boards/:boardId",
  /** Legacy per-board settings — redirects to `spaceBoardSettings`. */
  boardSettings: "/boards/:boardId/settings",
  task: "/tasks/:taskId",
  prompts: "/prompts",
  /** v3: agents library (canonical). */
  agents: "/agents",
  /** v3: selected agent detail (canonical). */
  agent: "/agents/:agentId",
  /** Legacy `/roles` — redirects to `/agents`. */
  roles: "/roles",
  /** Legacy `/roles/:roleId` — redirects to `/agents/:agentId`. */
  role: "/roles/:roleId",
  /** /tags — no longer a sidebar nav item but route still valid */
  tags: "/tags",
  /** /tags/:tagId — selected-tag editor in content (audit-#9). */
  tag: "/tags/:tagId",
  /** /reports — no longer a sidebar nav item but route still valid */
  reports: "/reports",
  skills: "/skills",
  /** /skills/:skillId — selected-skill editor in content (audit-#9). */
  skill: "/skills/:skillId",
  /** v3: integrations library (canonical). */
  integrations: "/integrations",
  /** v3: selected integration server detail (canonical). */
  integration: "/integrations/:serverId",
  /** v3: selected integration tool detail (canonical). */
  integrationTool: "/integrations/:serverId/tools/:toolId",
  /** Legacy MCP servers root — redirects to `/integrations`. */
  mcpServers: "/mcp-servers",
  /** Legacy MCP server detail — redirects to `/integrations/:serverId`. */
  mcpServer: "/mcp-servers/:serverId",
  /** Legacy MCP tool detail — redirects to the integrations variant. */
  mcpServerTool: "/mcp-servers/:serverId/tools/:toolId",
  /** Pre-PROXY-S6 MCP path. Same redirect target as `/mcp-servers`. */
  mcpServersLegacy: "/mcp-tools",
  spaces: "/spaces",
  /** v3 Space-detail "day-screen". */
  space: "/spaces/:spaceId",
  /** Per-space settings page — editable name/description form. */
  spaceSettings: "/spaces/:spaceId/settings",
  /** v3: space-scoped board detail (canonical). */
  spaceBoard: "/spaces/:spaceId/boards/:boardId",
  /** v3: space-scoped per-board settings (canonical). */
  spaceBoardSettings: "/spaces/:spaceId/boards/:boardId/settings",
  settings: "/settings",
} as const;

// ---------------------------------------------------------------------------
// Path helpers
// ---------------------------------------------------------------------------

/** Build the canonical (v3, space-scoped) URL path for a board detail page. */
export function spaceBoardPath(spaceId: string, boardId: string): string {
  return `/spaces/${spaceId}/boards/${boardId}`;
}

/** Build the canonical (v3, space-scoped) URL path for board settings. */
export function spaceBoardSettingsPath(
  spaceId: string,
  boardId: string,
): string {
  return `/spaces/${spaceId}/boards/${boardId}/settings`;
}

/** Build the v3 space-detail page URL. */
export function spacePath(id: string): string {
  return `/spaces/${id}`;
}

/**
 * Legacy board-detail URL builder. Kept so existing callers don't break
 * during the rollout; new code should prefer `spaceBoardPath`.
 */
export function boardPath(id: string): string {
  return `/boards/${id}`;
}

/** Build the concrete URL path for a specific task detail dialog. */
export function taskPath(id: string): string {
  return `/tasks/${id}`;
}

/** Build the concrete URL path for the per-space settings page. */
export function spaceSettingsPath(id: string): string {
  return `/spaces/${id}/settings`;
}

/** Legacy board-settings URL builder. Prefer `spaceBoardSettingsPath`. */
export function boardSettingsPath(id: string): string {
  return `/boards/${id}/settings`;
}

/** v3 canonical agent-editor URL. */
export function agentPath(id: string): string {
  return `/agents/${id}`;
}

/** Legacy role-editor URL. Prefer `agentPath`. */
export function rolePath(id: string): string {
  return `/roles/${id}`;
}

/** Build the concrete URL path for a specific skill editor page. */
export function skillPath(id: string): string {
  return `/skills/${id}`;
}

/** Build the concrete URL path for a specific tag editor page. */
export function tagPath(id: string): string {
  return `/tags/${id}`;
}

/** v3 canonical integration-server URL. */
export function integrationPath(serverId: string): string {
  return `/integrations/${serverId}`;
}

/** v3 canonical integration-tool URL. */
export function integrationToolPath(serverId: string, toolId: string): string {
  return `/integrations/${serverId}/tools/${toolId}`;
}

/** Legacy MCP-server URL. Prefer `integrationPath`. */
export function mcpServerPath(serverId: string): string {
  return `/mcp-servers/${serverId}`;
}

/** Legacy MCP-tool URL. Prefer `integrationToolPath`. */
export function mcpServerToolPath(serverId: string, toolId: string): string {
  return `/mcp-servers/${serverId}/tools/${toolId}`;
}

// ---------------------------------------------------------------------------
// Path matchers
// ---------------------------------------------------------------------------
//
// Compile each `routes.<x>` pattern (e.g. `/boards/:boardId`) into a typed
// matcher. Matchers return the params object on a hit and `null` on a miss,
// so callers express intent — `matchBoardSurface(path)?.boardId ?? null` —
// without inlining regex literals. Each matcher also accepts deeper
// sub-paths (`/boards/:id/settings` still resolves to `{ boardId }`), which
// is what the sidebar "active board" highlight needs.

type ParamsOf<P extends string> = string extends P
  ? Record<string, string>
  : P extends `${string}:${infer Param}/${infer Rest}`
    ? { [K in Param | keyof ParamsOf<`/${Rest}`>]: string }
    : P extends `${string}:${infer Param}`
      ? { [K in Param]: string }
      : Record<string, never>;

function compileMatcher<P extends string>(
  pattern: P,
): (path: string) => ParamsOf<P> | null {
  const names: string[] = [];
  const source = pattern
    .replace(/:([A-Za-z_][\w]*)/g, (_, name: string) => {
      names.push(name);
      return "([^/]+)";
    })
    .replace(/\//g, "\\/");
  const re = new RegExp(`^${source}(?:\\/.*)?$`);

  return (path: string): ParamsOf<P> | null => {
    const match = re.exec(path);
    if (match === null) return null;
    const params: Record<string, string> = {};
    for (let i = 0; i < names.length; i += 1) {
      params[names[i]] = match[i + 1];
    }
    return params as ParamsOf<P>;
  };
}

/** Match `/boards/:boardId` (and any deeper surface, e.g. `/settings`). */
export const matchBoardSurface = compileMatcher(routes.board);
/** Match `/tasks/:taskId`. */
export const matchTaskSurface = compileMatcher(routes.task);
/** Match `/spaces/:spaceId` (the v3 day-screen, plus any deeper surface). */
export const matchSpaceSurface = compileMatcher(routes.space);
/** Match `/spaces/:spaceId/settings`. */
export const matchSpaceSettings = compileMatcher(routes.spaceSettings);
/** Match `/spaces/:spaceId/boards/:boardId`. */
export const matchSpaceBoardSurface = compileMatcher(routes.spaceBoard);
/** Match `/spaces/:spaceId/boards/:boardId/settings`. */
export const matchSpaceBoardSettings = compileMatcher(routes.spaceBoardSettings);
/** Match `/boards/:boardId/settings`. */
export const matchBoardSettings = compileMatcher(routes.boardSettings);
/** Match `/agents/:agentId`. */
export const matchAgentSurface = compileMatcher(routes.agent);
/** Match `/roles/:roleId`. */
export const matchRoleSurface = compileMatcher(routes.role);
/** Match `/skills/:skillId`. */
export const matchSkillSurface = compileMatcher(routes.skill);
/** Match `/tags/:tagId`. */
export const matchTagSurface = compileMatcher(routes.tag);
/** Match `/integrations/:serverId` (and the tool sub-surface). */
export const matchIntegrationSurface = compileMatcher(routes.integration);
/** Match `/mcp-servers/:serverId` (and `/mcp-servers/:serverId/tools/:toolId`). */
export const matchMcpServerSurface = compileMatcher(routes.mcpServer);

/**
 * Map a `NavView` literal to its canonical URL path.
 * Used by `Sidebar.onSelectView` to drive `setLocation`.
 */
export function pathForView(view: NavView): string {
  switch (view) {
    case "boards":
      return routes.boards;
    case "prompts":
      return routes.prompts;
    case "agent-roles":
      return routes.agents;
    case "skills":
      return routes.skills;
    case "mcp-servers":
      return routes.integrations;
    case "spaces":
      return routes.spaces;
    case "settings":
      return routes.settings;
  }
}

/**
 * Reverse-lookup: given a URL pathname, return the corresponding `NavView`.
 * Board-detail paths (`/boards/:id`) map to `"boards"` since the sidebar
 * highlights the Boards item while a board is open.
 * Defaults to `"boards"` for unknown paths.
 */
export function viewForPath(path: string): NavView {
  if (path === routes.home || path === "") return "boards";
  // Round-19c: /prompt-groups was merged into /prompts — keep the legacy
  // path resolving so any saved deep-link still lands on the new page.
  if (path === routes.prompts || path === "/prompt-groups") return "prompts";
  if (
    path === routes.agents ||
    path === routes.roles ||
    matchAgentSurface(path) !== null ||
    matchRoleSurface(path) !== null
  ) {
    return "agent-roles";
  }
  if (path === routes.skills || matchSkillSurface(path) !== null)
    return "skills";
  if (
    path === routes.integrations ||
    path === routes.mcpServers ||
    path === routes.mcpServersLegacy ||
    matchIntegrationSurface(path) !== null ||
    matchMcpServerSurface(path) !== null
  ) {
    return "mcp-servers";
  }
  if (path === routes.settings) return "settings";
  // Everything else that has a board / task / space / spaces-listing context
  // keeps the sidebar on the "boards" view so the SpacesSidebar stays visible
  // alongside the settings or detail pane (round-19e).
  if (
    path === routes.spaces ||
    matchSpaceSurface(path) !== null ||
    matchSpaceBoardSurface(path) !== null ||
    matchBoardSurface(path) !== null ||
    matchTaskSurface(path) !== null
  ) {
    return "boards";
  }
  return "boards";
}
