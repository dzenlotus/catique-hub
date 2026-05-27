/**
 * Root layout shell for the TanStack Router tree.
 *
 * Three-column grid identical to the previous `App.tsx`:
 * `<MainSidebar>` | `<SpacesSidebar>` | `<main>` (route Outlet).
 *
 * Navigation history is driven by TanStack Router; `viewForPath` /
 * `pathForView` are still consulted to map the current URL to the
 * `NavView` highlight in `MainSidebar`. The mapping helpers stay in
 * `src/app/routes.ts` so legacy callers (`@pages/...`, helpers like
 * `boardPath()`) keep working unchanged.
 */
import { useMemo, type ReactElement } from "react";
import { Outlet, useNavigate, useRouterState } from "@tanstack/react-router";

import { MainSidebar } from "@widgets/main-sidebar";
import type { NavView } from "@widgets/main-sidebar";
import { SpacesSidebar } from "@widgets/spaces-sidebar";
import { TopBar } from "@widgets/top-bar";
import { Toaster } from "@widgets/toaster";

import { BoardOwnershipReviewMount } from "./providers/BoardOwnershipReviewMount";
import { pathForView, viewForPath } from "./routes";
import styles from "./App.module.css";

export function RootLayout(): ReactElement {
  const navigate = useNavigate();
  const location = useRouterState({
    select: (state) => state.location.pathname,
  });

  const activeView = useMemo<NavView>(() => viewForPath(location), [location]);

  function handleSelectView(view: NavView): void {
    void navigate({ to: pathForView(view) });
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
        <Outlet />
      </main>

      <Toaster />
      <BoardOwnershipReviewMount />
    </div>
  );
}
