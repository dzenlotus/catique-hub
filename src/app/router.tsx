/**
 * TanStack Router setup — code-based route tree.
 *
 * Replaces the previous `wouter` setup. The route map mirrors the
 * legacy `src/app/routes.ts` 1:1 (same URL paths, same components),
 * but everything is typed via TanStack Router so `useParams()` /
 * `<Link to=... params=...>` are checked at compile time.
 *
 * Layout shell lives in `RootLayout.tsx` (TopBar + MainSidebar +
 * SpacesSidebar + content `<Outlet/>`).
 */
import {
  createRootRoute,
  createRoute,
  createRouter,
} from "@tanstack/react-router";
import { z } from "zod";

import { BoardHome } from "@pages/board-home";
import { BoardDetailPage } from "@pages/board-detail";
import { BoardSettingsPage } from "@pages/board-settings";
import { TaskDetailPage } from "@pages/task-detail";
import { PromptsPage } from "@pages/prompts";
import { RolesPage } from "@pages/roles";
import { SkillsPage } from "@pages/skills";
import { McpServersPage } from "@pages/mcp-servers";
import { TagsPage } from "@pages/tags";
import { ReportsPage } from "@pages/reports";
import { SettingsPage } from "@pages/settings";
import { SpaceSettingsPage } from "@pages/space-settings";

import { RootLayout } from "./RootLayout";

const rootRoute = createRootRoute({
  component: RootLayout,
});

const boardsRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/",
  component: BoardHome,
});

/**
 * Search-params for the kanban board. Reserved for future filter /
 * selection state — wiring zod-validated search now so callers can
 * adopt typed search without changing the route definition.
 */
const boardDetailSearchSchema = z.object({
  /** Optional preselected task id (deep-link from search results). */
  task: z.string().optional(),
});

const boardDetailRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/boards/$boardId",
  validateSearch: boardDetailSearchSchema,
  component: () => {
    const { boardId } = boardDetailRoute.useParams();
    return <BoardDetailPage boardId={boardId} />;
  },
});

const boardSettingsRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/boards/$boardId/settings",
  component: BoardSettingsPage,
});

const taskDetailRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/tasks/$taskId",
  component: TaskDetailPage,
});

const promptsRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/prompts",
  component: PromptsPage,
});

// Round-19c: legacy /prompt-groups route — redirects to /prompts via
// the same component.
const promptGroupsLegacyRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/prompt-groups",
  component: PromptsPage,
});

const rolesRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/roles",
  component: RolesPage,
});

const roleDetailRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/roles/$roleId",
  component: RolesPage,
});

const skillsRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/skills",
  component: SkillsPage,
});

const skillDetailRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/skills/$skillId",
  component: SkillsPage,
});

const tagsRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/tags",
  component: TagsPage,
});

const tagDetailRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/tags/$tagId",
  component: TagsPage,
});

const reportsRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/reports",
  component: ReportsPage,
});

/**
 * Search-params for MCP servers — currently only an optional `q`
 * (free-text filter for the server/tool list). Reserved for future
 * filter widgets; consumers can adopt incrementally via
 * `mcpServersRoute.useSearch()`.
 */
const mcpServersSearchSchema = z.object({
  q: z.string().optional(),
});

// PROXY-S6 / ADR-0008: canonical /mcp-servers + nested selection.
// /mcp-tools is preserved as a one-release redirect alias.
const mcpServersRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/mcp-servers",
  validateSearch: mcpServersSearchSchema,
  component: McpServersPage,
});

const mcpServerRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/mcp-servers/$serverId",
  component: McpServersPage,
});

const mcpServerToolRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/mcp-servers/$serverId/tools/$toolId",
  component: McpServersPage,
});

const mcpToolsLegacyRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/mcp-tools",
  component: McpServersPage,
});

const spaceSettingsRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/spaces/$spaceId/settings",
  component: SpaceSettingsPage,
});

const settingsRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/settings",
  component: SettingsPage,
});

const routeTree = rootRoute.addChildren([
  boardsRoute,
  boardDetailRoute,
  boardSettingsRoute,
  taskDetailRoute,
  promptsRoute,
  promptGroupsLegacyRoute,
  rolesRoute,
  roleDetailRoute,
  skillsRoute,
  skillDetailRoute,
  tagsRoute,
  tagDetailRoute,
  reportsRoute,
  mcpServersRoute,
  mcpServerRoute,
  mcpServerToolRoute,
  mcpToolsLegacyRoute,
  spaceSettingsRoute,
  settingsRoute,
]);

export const router = createRouter({
  routeTree,
  defaultPreload: "intent",
});

// TanStack Router type registration — gives typed `Link`, `useParams`,
// etc. across the app.
declare module "@tanstack/react-router" {
  interface Register {
    router: typeof router;
  }
}

// Per-route handles for callers that need typed `useParams()` —
// `boardDetailRoute.useParams()` returns `{ boardId: string }`.
export {
  rootRoute,
  boardsRoute,
  boardDetailRoute,
  boardSettingsRoute,
  taskDetailRoute,
  promptsRoute,
  rolesRoute,
  roleDetailRoute,
  skillsRoute,
  skillDetailRoute,
  tagsRoute,
  tagDetailRoute,
  reportsRoute,
  mcpServersRoute,
  mcpServerRoute,
  mcpServerToolRoute,
  spaceSettingsRoute,
  settingsRoute,
};
