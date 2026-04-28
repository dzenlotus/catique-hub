import { useState } from "react";
import type { ReactElement } from "react";

import { BoardsList } from "@widgets/boards-list";
import { KanbanBoard } from "@widgets/kanban-board";
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
 */
export default function App(): ReactElement {
  const [selectedBoardId, setSelectedBoardId] = useState<string | null>(null);

  return (
    <main className={styles.main}>
      <header className={styles.appHeader}>
        <h1 className={styles.heading}>Catique HUB</h1>
        <p className={styles.subhead}>Desktop app for AI agent orchestration.</p>
      </header>

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
    </main>
  );
}
