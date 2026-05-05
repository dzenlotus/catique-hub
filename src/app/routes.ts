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
  /** /tags — no longer a sidebar nav item but route still valid */
  tags: "/tags",
  /** /reports — no longer a sidebar nav item but route still valid */
  reports: "/reports",
  skills: "/skills",
  /** /mcp-tools — maps to "mcp-servers" NavView */
  mcpTools: "/mcp-tools",
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
      return routes.mcpTools;
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
  if (path === "/" || path === "") return "boards";
  if (path === routes.prompts) return "prompts";
  // Round-19c: /prompt-groups was merged into /prompts. The path is
  // kept as a redirect so any deep-link still lands on the new page.
  if (path === "/prompt-groups") return "prompts";
  if (path === routes.roles) return "agent-roles";
  if (path === routes.skills) return "skills";
  if (path === routes.mcpTools) return "mcp-servers";
  // Round-19e: standalone /spaces page was retired — the canonical
  // home shell already shows the sidebar with every space. Keep the
  // path resolvable so any old deep-link redirects to the home page
  // (boards context with the sidebar visible).
  if (path === routes.spaces) return "boards";
  // /spaces/:id/settings — per-space settings is reached from the SpacesSidebar
  // and renders inside the content pane, so it belongs to the "boards"
  // context (keeps SpacesSidebar visible alongside the settings form).
  if (/^\/spaces\/[^/]+\/settings$/.test(path)) return "boards";
  if (/^\/boards\/[^/]+\/settings$/.test(path)) return "boards";
  if (path === routes.settings) return "settings";
  // Board detail: /boards/<id>
  if (path.startsWith("/boards/")) return "boards";
  // Task deep-link: /tasks/<id> — sidebar stays on "boards" (most common origin).
  if (path.startsWith("/tasks/")) return "boards";
  return "boards";
}
