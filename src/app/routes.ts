/**
 * Route map for Catique HUB.
 *
 * All top-level nav views have a canonical URL path. The board-detail route
 * embeds the boardId as a path segment so it is directly deep-linkable.
 *
 * E4.x (router): introduced with wouter migration. Previously navigation was
 * purely in-memory via `useState<NavView>` in App.tsx.
 * Round 4: NavView "roles" → "agent-roles", "mcp-tools" → "mcp-servers".
 *          URL paths are unchanged (backward compat). "tags" and "reports"
 *          are no longer sidebar nav items but routes remain for deep-links.
 * PROXY-S6 (ADR-0008): canonical path renamed `/mcp-tools` → `/mcp-servers`
 *          to reflect the per-server group view. `/mcp-tools` is preserved
 *          as a one-release redirect alias (until v1) so any deep links
 *          still resolve.
 */

import type { NavView } from "@widgets/main-sidebar";

// ---------------------------------------------------------------------------
// Route constants
// ---------------------------------------------------------------------------

export const routes = {
  boards: "/",
  board: "/boards/:boardId",
  /** Round-19e: per-board settings page (replaces BoardEditor modal). */
  boardSettings: "/boards/:boardId/settings",
  task: "/tasks/:taskId",
  prompts: "/prompts",
  /** /roles — maps to "agent-roles" NavView */
  roles: "/roles",
  /** /roles/:roleId — selected-role editor in content (audit-#9, wave-3). */
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
  /**
   * Canonical MCP servers list path. PROXY-S6 / ADR-0008 — renamed from
   * the legacy `/mcp-tools` so URLs match the per-server group view.
   */
  mcpServers: "/mcp-servers",
  /** Selected MCP server — server detail in the content pane. */
  mcpServer: "/mcp-servers/:serverId",
  /** Selected MCP tool — tool detail in the content pane. */
  mcpServerTool: "/mcp-servers/:serverId/tools/:toolId",
  /**
   * Legacy MCP path. Kept for one release as a redirect alias so old
   * deep-links resolve; remove with v1.
   */
  mcpServersLegacy: "/mcp-tools",
  spaces: "/spaces",
  /** Per-space settings page — editable name/description form. */
  spaceSettings: "/spaces/:spaceId/settings",
  settings: "/settings",
} as const;

// ---------------------------------------------------------------------------
// Path helpers
// ---------------------------------------------------------------------------

/** Build the concrete URL path for a specific board detail page. */
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

/** Build the concrete URL path for the per-board settings page. */
export function boardSettingsPath(id: string): string {
  return `/boards/${id}/settings`;
}

/** Build the concrete URL path for a specific role editor page. */
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

/** Build the concrete URL path for a selected MCP server. */
export function mcpServerPath(serverId: string): string {
  return `/mcp-servers/${serverId}`;
}

/** Build the concrete URL path for a selected MCP tool. */
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
/** Match `/spaces/:spaceId/settings`. */
export const matchSpaceSettings = compileMatcher(routes.spaceSettings);
/** Match `/boards/:boardId/settings`. */
export const matchBoardSettings = compileMatcher(routes.boardSettings);
/** Match `/roles/:roleId`. */
export const matchRoleSurface = compileMatcher(routes.role);
/** Match `/skills/:skillId`. */
export const matchSkillSurface = compileMatcher(routes.skill);
/** Match `/tags/:tagId`. */
export const matchTagSurface = compileMatcher(routes.tag);
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
      return routes.roles;
    case "skills":
      return routes.skills;
    case "mcp-servers":
      return routes.mcpServers;
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
  if (path === routes.boards || path === "") return "boards";
  // Round-19c: /prompt-groups was merged into /prompts — keep the legacy
  // path resolving so any saved deep-link still lands on the new page.
  if (path === routes.prompts || path === "/prompt-groups") return "prompts";
  if (path === routes.roles || matchRoleSurface(path) !== null)
    return "agent-roles";
  if (path === routes.skills || matchSkillSurface(path) !== null)
    return "skills";
  if (
    path === routes.mcpServers ||
    path === routes.mcpServersLegacy ||
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
    matchBoardSurface(path) !== null ||
    matchTaskSurface(path) !== null ||
    matchSpaceSettings(path) !== null
  ) {
    return "boards";
  }
  return "boards";
}
