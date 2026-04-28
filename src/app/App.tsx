import { useState } from "react";
import type { ReactElement } from "react";

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

import styles from "./App.module.css";

/**
 * Root layout shell.
 *
 * Layout: a full-viewport flex row — `<Sidebar>` on the left
 * (~210 px fixed rail) and `<main>` taking the remaining width.
 * The app heading lives inside the sidebar header area so the rail
 * stays anchored while the main pane scrolls independently.
 *
 * Navigation state is held as `activeView: NavView` (one of five
 * string literals). Switching views resets `selectedBoardId` to null
 * so the kanban detail pane is never orphaned. No router library is
 * introduced — `useState`-based nav suffices for a five-view desktop
 * tool; tracked as a follow-up if deep-linking becomes needed.
 *
 * E3.1 (Anna): introduced `selectedBoardId` for in-memory board detail.
 * E4.1 (Anna): wrapped app in `<FirstLaunchGate>`.
 * E4.x (Anna): sidebar shell replaces top-tab navigation.
 */
export default function App(): ReactElement {
  const [activeView, setActiveView] = useState<NavView>("boards");
  const [selectedBoardId, setSelectedBoardId] = useState<string | null>(null);

  function handleSelectView(view: NavView): void {
    setActiveView(view);
    if (view !== "boards") setSelectedBoardId(null);
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
          {activeView === "boards" && selectedBoardId !== null ? (
            <section className={styles.boardView}>
              <div className={styles.boardViewHeader}>
                <Button
                  variant="ghost"
                  size="sm"
                  onPress={() => setSelectedBoardId(null)}
                >
                  ← Back to boards
                </Button>
              </div>
              <KanbanBoard boardId={selectedBoardId} />
            </section>
          ) : activeView === "boards" ? (
            <BoardsList onSelectBoard={setSelectedBoardId} />
          ) : activeView === "prompts" ? (
            <PromptsList />
          ) : activeView === "prompt-groups" ? (
            <PromptGroupsList />
          ) : activeView === "roles" ? (
            <RolesList />
          ) : activeView === "tags" ? (
            <TagsList />
          ) : activeView === "skills" ? (
            <SkillsList />
          ) : activeView === "mcp-tools" ? (
            <McpToolsList />
          ) : activeView === "settings" ? (
            <SettingsView />
          ) : activeView === "spaces" ? (
            <SpacesList onSelectView={handleSelectView} />
          ) : (
            <AgentReportsList />
          )}
        </FirstLaunchGate>
      </main>
    </div>
  );
}
