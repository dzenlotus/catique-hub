import { useMemo } from "react";
import type { ReactElement } from "react";
import { Switch, Route, useLocation } from "wouter";

import { BoardHome } from "@widgets/board-home";
import { KanbanBoard } from "@widgets/kanban-board";
import { PromptsPage } from "@widgets/prompts-page";
import { RolesPage } from "@widgets/roles-page";
import { TagsList } from "@widgets/tags-list";
import { AgentReportsList } from "@widgets/agent-reports-list";
import { SkillsPage } from "@widgets/skills-page";
import { McpToolsPage } from "@widgets/mcp-tools-page";
import { SettingsView } from "@widgets/settings-view";
import { SpaceSettings } from "@widgets/space-settings";
import { BoardSettings } from "@widgets/board-settings";
import { MainSidebar } from "@widgets/main-sidebar";
import type { NavView } from "@widgets/main-sidebar";
import { SpacesSidebar } from "@widgets/spaces-sidebar";
import { TopBar } from "@widgets/top-bar";
import { Toaster } from "@widgets/toaster";
import { TaskView } from "@widgets/task-view";

import { BoardOwnershipReviewMount } from "./providers/BoardOwnershipReviewMount";
import { routes, pathForView, viewForPath } from "./routes";
import styles from "./App.module.css";

/**
 * Root layout shell.
 *
 * Round 20: three-column grid — `<MainSidebar>` (wordmark + workspace
 * nav) | `<SpacesSidebar>` (SPACES tree) | `<main>` (route content).
 * Both sidebars render on every route, sharing the cream surface and a
 * 1 px right border between columns.
 *
 * Navigation is driven by `wouter` (hash-less client-side router, ~2 KB).
 * URL paths map to views via `routes.ts`. The MainSidebar's `onSelectView`
 * prop API is preserved — internally it calls `setLocation(pathForView(view))`.
 *
 * E3.1 (Anna): introduced `selectedBoardId` for in-memory board detail.
 * E4.x (Anna): sidebar shell replaces top-tab navigation.
 * E4.x (router): replaced `useState`-based nav with `wouter` routes.
 *                `selectedBoardId` local state removed; boardId lives in URL.
 * Round 20: split single Sidebar into MainSidebar + SpacesSidebar; the
 *           "WORKSPACE" section header was removed.
 */
export default function App(): ReactElement {
  const [location, setLocation] = useLocation();

  // Derive the active sidebar highlight from the current URL.
  const activeView = useMemo<NavView>(() => viewForPath(location), [location]);

  function handleSelectView(view: NavView): void {
    setLocation(pathForView(view));
  }

  // SpacesSidebar is only relevant for board-centric views (BoardHome,
  // the kanban detail, and the task deep-link). viewForPath() maps `/`,
  // `/boards/:id`, and `/tasks/:id` all to "boards".
  const showSpacesSidebar = activeView === "boards";

  return (
    <div
      className={styles.shell}
      data-spaces-sidebar={showSpacesSidebar ? "true" : "false"}
    >
      {/* Round 20c: TopBar spans the full window width above all sidebars
          and the content column, so the search/CTA bar sits at the very top. */}
      <div className={styles.topBarSlot}>
        <TopBar />
      </div>

      <div className={styles.mainSidebarSlot}>
        <MainSidebar activeView={activeView} onSelectView={handleSelectView} />
      </div>

      {showSpacesSidebar && (
        <div className={styles.spacesSidebarSlot}>
          <SpacesSidebar />
        </div>
      )}

      <main className={styles.mainPane}>
        <Switch>
          {/* Round-19e: task editor as a routed page in mainPane,
              same shell as space/board/prompts settings. Back returns
              to /. */}
          <Route path={routes.task}>
            <TaskView />
          </Route>

          {/* Board detail — boardId comes from URL params. The
              settings sub-route must come BEFORE the parent so wouter
              doesn't short-circuit. */}
          <Route path={routes.boardSettings}>
            <BoardSettings />
          </Route>
          <Route path={routes.board}>
            {(params) => <KanbanBoard boardId={params.boardId} />}
          </Route>

          {/* All other top-level views */}
          <Route path={routes.boards}>
            <BoardHome />
          </Route>
          <Route path={routes.prompts}>
            <PromptsPage />
          </Route>
          {/* Round-19c: legacy /prompt-groups route — redirects to /prompts. */}
          <Route path="/prompt-groups">
            <PromptsPage />
          </Route>
          <Route path={routes.roles}>
            <RolesPage />
          </Route>
          <Route path={routes.tags}>
            <TagsList />
          </Route>
          <Route path={routes.reports}>
            <AgentReportsList />
          </Route>
          <Route path={routes.skills}>
            <SkillsPage />
          </Route>
          <Route path={routes.mcpTools}>
            <McpToolsPage />
          </Route>
          <Route path={routes.spaceSettings}>
            <SpaceSettings />
          </Route>
          <Route path={routes.settings}>
            <SettingsView />
          </Route>

          {/* Fallback — unknown paths land on the home redirect */}
          <Route>
            <BoardHome />
          </Route>
        </Switch>
      </main>

      <Toaster />
      {/* ctq-82 (P1-T4): one-shot post-migration review modal. Renders
          only while `settings.cat_migration_reviewed === 'false'`. */}
      <BoardOwnershipReviewMount />
    </div>
  );
}
