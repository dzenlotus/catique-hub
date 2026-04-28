import { useMemo } from "react";
import type { ReactElement } from "react";
import { Switch, Route, useLocation } from "wouter";

import { BoardsList } from "@widgets/boards-list";
import { KanbanBoard } from "@widgets/kanban-board";
import { FirstLaunchGate } from "@widgets/first-launch";
import { PromptsList } from "@widgets/prompts-list";
import { PromptGroupsList } from "@widgets/prompt-groups-list";
import { RolesList } from "@widgets/roles-list";
import { TagsList } from "@widgets/tags-list";
import { AgentReportsList } from "@widgets/agent-reports-list";
import { SkillsList } from "@widgets/skills-list";
import { McpToolsList } from "@widgets/mcp-tools-list";
import { SettingsView } from "@widgets/settings-view";
import { SpacesList } from "@widgets/spaces-list";
import { Sidebar } from "@widgets/sidebar";
import type { NavView } from "@widgets/sidebar";
import { Button } from "@shared/ui";

import { routes, pathForView, viewForPath, boardPath } from "./routes";
import styles from "./App.module.css";

/**
 * Root layout shell.
 *
 * Layout: a full-viewport flex row — `<Sidebar>` on the left
 * (~210 px fixed rail) and `<main>` taking the remaining width.
 * The app heading lives inside the sidebar header area so the rail
 * stays anchored while the main pane scrolls independently.
 *
 * Navigation is driven by `wouter` (hash-less client-side router, ~2 KB).
 * URL paths map to views via `routes.ts`. The Sidebar's `onSelectView` prop
 * API is preserved — internally it calls `setLocation(pathForView(view))`.
 *
 * E3.1 (Anna): introduced `selectedBoardId` for in-memory board detail.
 * E4.1 (Anna): wrapped app in `<FirstLaunchGate>`.
 * E4.x (Anna): sidebar shell replaces top-tab navigation.
 * E4.x (router): replaced `useState`-based nav with `wouter` routes.
 *                `selectedBoardId` local state removed; boardId lives in URL.
 */
export default function App(): ReactElement {
  const [location, setLocation] = useLocation();

  // Derive the active sidebar highlight from the current URL.
  const activeView = useMemo<NavView>(() => viewForPath(location), [location]);

  function handleSelectView(view: NavView): void {
    setLocation(pathForView(view));
  }

  return (
    <div className={styles.shell}>
      <div className={styles.sidebarSlot}>
        <header className={styles.sidebarHeader}>
          <h1 className={styles.heading}>Catique HUB</h1>
          <p className={styles.subhead}>AI agent orchestration.</p>
        </header>
        <Sidebar activeView={activeView} onSelectView={handleSelectView} />
      </div>

      <main className={styles.mainPane}>
        <FirstLaunchGate>
          <Switch>
            {/* Board detail — boardId comes from URL params */}
            <Route path={routes.board}>
              {(params) => (
                <section className={styles.boardView}>
                  <div className={styles.boardViewHeader}>
                    <Button
                      variant="ghost"
                      size="sm"
                      onPress={() => setLocation(routes.boards)}
                    >
                      ← Back to boards
                    </Button>
                  </div>
                  <KanbanBoard boardId={params.boardId} />
                </section>
              )}
            </Route>

            {/* All other top-level views */}
            <Route path={routes.boards}>
              <BoardsList
                onSelectBoard={(id) => setLocation(boardPath(id))}
              />
            </Route>
            <Route path={routes.prompts}>
              <PromptsList />
            </Route>
            <Route path={routes.promptGroups}>
              <PromptGroupsList />
            </Route>
            <Route path={routes.roles}>
              <RolesList />
            </Route>
            <Route path={routes.tags}>
              <TagsList />
            </Route>
            <Route path={routes.reports}>
              <AgentReportsList />
            </Route>
            <Route path={routes.skills}>
              <SkillsList />
            </Route>
            <Route path={routes.mcpTools}>
              <McpToolsList />
            </Route>
            <Route path={routes.spaces}>
              <SpacesList onSelectView={handleSelectView} />
            </Route>
            <Route path={routes.settings}>
              <SettingsView />
            </Route>

            {/* Fallback — unknown paths land on the boards list */}
            <Route>
              <BoardsList
                onSelectBoard={(id) => setLocation(boardPath(id))}
              />
            </Route>
          </Switch>
        </FirstLaunchGate>
      </main>
    </div>
  );
}
