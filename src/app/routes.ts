/**
 * Route map for Catique HUB.
 *
 * All top-level nav views have a canonical URL path. The board-detail route
 * embeds the boardId as a path segment so it is directly deep-linkable.
 *
 * E4.x (router): introduced with wouter migration. Previously navigation was
 * purely in-memory via `useState<NavView>` in App.tsx.
 */

import type { NavView } from "@widgets/sidebar";

// ---------------------------------------------------------------------------
// Route constants
// ---------------------------------------------------------------------------

export const routes = {
  boards: "/",
  board: "/boards/:boardId",
  prompts: "/prompts",
  promptGroups: "/prompt-groups",
  roles: "/roles",
  tags: "/tags",
  reports: "/reports",
  skills: "/skills",
  mcpTools: "/mcp-tools",
  spaces: "/spaces",
  settings: "/settings",
} as const;

// ---------------------------------------------------------------------------
// Path helpers
// ---------------------------------------------------------------------------

/** Build the concrete URL path for a specific board detail page. */
export function boardPath(id: string): string {
  return `/boards/${id}`;
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
    case "prompt-groups":
      return routes.promptGroups;
    case "roles":
      return routes.roles;
    case "tags":
      return routes.tags;
    case "reports":
      return routes.reports;
    case "skills":
      return routes.skills;
    case "mcp-tools":
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
  if (path === routes.promptGroups) return "prompt-groups";
  if (path === routes.roles) return "roles";
  if (path === routes.tags) return "tags";
  if (path === routes.reports) return "reports";
  if (path === routes.skills) return "skills";
  if (path === routes.mcpTools) return "mcp-tools";
  if (path === routes.spaces) return "spaces";
  if (path === routes.settings) return "settings";
  // Board detail: /boards/<id>
  if (path.startsWith("/boards/")) return "boards";
  return "boards";
}
