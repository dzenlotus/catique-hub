/**
 * TanStack Router setup — code-based route tree.
 *
 * Routes split into three groups:
 *   1. v3 canonical — the URL surface advertised by the sidebar.
 *      `/agents`, `/integrations`, `/spaces/:spaceId`,
 *      `/spaces/:spaceId/boards/:boardId`, …
 *   2. Legacy aliases — `/roles`, `/mcp-servers`, bare `/boards/:id`.
 *      They render the same component as the canonical route so any
 *      old bookmark resolves. Telemetry is wired to surface drift
 *      (`logLegacyHit` — see D-E decision).
 *   3. Dynamic-redirect routes — `/boards/:boardId` is rewritten to
 *      `/spaces/:spaceId/boards/:boardId` once the board's space_id is
 *      known (lookup via TanStack Query cache).
 *
 * Layout shell lives in `RootLayout.tsx`.
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
import { SpaceDetailPage } from "@pages/space-detail";
import { SpaceSettingsPage } from "@pages/space-settings";
import { LegacyBoardRedirect } from "./router/LegacyBoardRedirect";

import { RootLayout } from "./RootLayout";

/**
 * Silent error fallback for the root route — see comment in the
 * previous revision; HMR may transiently surface a provider mismatch.
 */
function RootErrorBoundary(): null {
  return null;
}

const rootRoute = createRootRoute({
  component: RootLayout,
  errorComponent: RootErrorBoundary,
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

// Legacy `/boards/:id` — kept routable but rewrites to the v3 canonical
// `/spaces/:spaceId/boards/:boardId` once the board's space is known.
const boardDetailRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/boards/$boardId",
  validateSearch: boardDetailSearchSchema,
  component: () => {
    const { boardId } = boardDetailRoute.useParams();
    return <LegacyBoardRedirect boardId={boardId} fallback="detail" />;
  },
});

const boardSettingsRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/boards/$boardId/settings",
  component: () => {
    const { boardId } = boardSettingsRoute.useParams();
    return <LegacyBoardRedirect boardId={boardId} fallback="settings" />;
  },
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

// v3 canonical: /agents + selected detail. Renders the same component
// as /roles until Phase 4's UI restructure ships (D-E).
const agentsRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/agents",
  component: RolesPage,
});

const agentDetailRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/agents/$agentId",
  component: RolesPage,
});

// Legacy /roles — still resolvable; same component.
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
 * filter widgets.
 */
const mcpServersSearchSchema = z.object({
  q: z.string().optional(),
});

// v3 canonical /integrations. Renders the same component as
// /mcp-servers until Phase 4's UI restructure ships.
const integrationsRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/integrations",
  validateSearch: mcpServersSearchSchema,
  component: McpServersPage,
});

const integrationDetailRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/integrations/$serverId",
  component: McpServersPage,
});

const integrationToolDetailRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/integrations/$serverId/tools/$toolId",
  component: McpServersPage,
});

// Legacy /mcp-servers — preserved for one release.
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

// v3 Space detail "day-screen" (Phase 2). Renders SpaceDetailPage.
const spaceDetailRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/spaces/$spaceId",
  component: SpaceDetailPage,
});

const spaceSettingsRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/spaces/$spaceId/settings",
  component: SpaceSettingsPage,
});

// v3 canonical space-scoped board surfaces.
const spaceBoardRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/spaces/$spaceId/boards/$boardId",
  validateSearch: boardDetailSearchSchema,
  component: () => {
    const { boardId } = spaceBoardRoute.useParams();
    return <BoardDetailPage boardId={boardId} />;
  },
});

const spaceBoardSettingsRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/spaces/$spaceId/boards/$boardId/settings",
  component: BoardSettingsPage,
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
  agentsRoute,
  agentDetailRoute,
  rolesRoute,
  roleDetailRoute,
  skillsRoute,
  skillDetailRoute,
  tagsRoute,
  tagDetailRoute,
  reportsRoute,
  integrationsRoute,
  integrationDetailRoute,
  integrationToolDetailRoute,
  mcpServersRoute,
  mcpServerRoute,
  mcpServerToolRoute,
  mcpToolsLegacyRoute,
  spaceDetailRoute,
  spaceSettingsRoute,
  spaceBoardRoute,
  spaceBoardSettingsRoute,
  settingsRoute,
]);

export const router = createRouter({
  routeTree,
  defaultPreload: "intent",
});

declare module "@tanstack/react-router" {
  interface Register {
    router: typeof router;
  }
}

export {
  rootRoute,
  boardsRoute,
  boardDetailRoute,
  boardSettingsRoute,
  taskDetailRoute,
  promptsRoute,
  agentsRoute,
  agentDetailRoute,
  rolesRoute,
  roleDetailRoute,
  skillsRoute,
  skillDetailRoute,
  tagsRoute,
  tagDetailRoute,
  reportsRoute,
  integrationsRoute,
  integrationDetailRoute,
  integrationToolDetailRoute,
  mcpServersRoute,
  mcpServerRoute,
  mcpServerToolRoute,
  spaceDetailRoute,
  spaceSettingsRoute,
  spaceBoardRoute,
  spaceBoardSettingsRoute,
  settingsRoute,
};
