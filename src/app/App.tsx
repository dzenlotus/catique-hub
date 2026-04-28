import { useState } from "react";
import type { ReactElement } from "react";

import { BoardsList } from "@widgets/boards-list";
import { KanbanBoard } from "@widgets/kanban-board";
import { FirstLaunchGate } from "@widgets/first-launch";
import { Button } from "@shared/ui";

import styles from "./App.module.css";

/**
 * Root layout shell.
 *
 * E3.1 (Anna): introduces an in-memory `selectedBoardId` so clicking
 * a board card swaps `<BoardsList />` for `<KanbanBoard />`. Routing
 * library is intentionally deferred — at three views (boards / kanban
 * / settings, the last not yet built) `useState` is simpler than
 * react-router. When the app grows past that, switch to react-router
 * or wouter; tracked as a follow-up task.
 *
 * E4.1 (Anna): wraps the existing app in `<FirstLaunchGate>`. The gate
 * decides between (a) rendering the children unchanged (returning user
 * with data), (b) running the Promptery import wizard (first-launch
 * with a detected source DB), or (c) showing the welcome screen
 * (first-launch with no source). Once data exists locally, the gate is
 * a no-op pass-through.
 */
export default function App(): ReactElement {
  const [selectedBoardId, setSelectedBoardId] = useState<string | null>(null);

  return (
    <main className={styles.main}>
      <header className={styles.appHeader}>
        <h1 className={styles.heading}>Catique HUB</h1>
        <p className={styles.subhead}>Desktop app for AI agent orchestration.</p>
      </header>

      <FirstLaunchGate>
        {selectedBoardId !== null ? (
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
        ) : (
          <BoardsList onSelectBoard={setSelectedBoardId} />
        )}
      </FirstLaunchGate>
    </main>
  );
}
