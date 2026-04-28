import { BoardsList } from "@widgets/boards-list";

import styles from "./App.module.css";

/**
 * Root layout shell.
 *
 * E2.3 (Anna): replaces the E1.3 primitives showcase with the boards
 * entry-page (`<BoardsList />`). The demo is preserved at
 * `src/app/_demo/Showcase.tsx` for ad-hoc primitive eyeballing while
 * Storybook is deferred (see `src/shared/ui/README.md`).
 */
export default function App() {
  return (
    <main className={styles.main}>
      <header className={styles.appHeader}>
        <h1 className={styles.heading}>Catique HUB</h1>
        <p className={styles.subhead}>Desktop app for AI agent orchestration.</p>
      </header>
      <BoardsList />
    </main>
  );
}
