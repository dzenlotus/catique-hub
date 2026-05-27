/**
 * Root layout shell for the TanStack Router tree.
 *
 * Two-column grid: `<MainSidebar>` | `<TopBar> + <main>` (route Outlet).
 * Pages that need a secondary rail (boards, spaces, prompts, …) mount
 * their own sidebar inside the content slot — RootLayout has no
 * knowledge of feature-specific rails.
 */
import { useMemo, type ReactElement } from "react";
import { Outlet, useNavigate, useRouterState } from "@tanstack/react-router";

import { MainSidebar } from "@widgets/main-sidebar";
import type { NavView } from "@widgets/main-sidebar";
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

  return (
    <div className={styles.shell}>
      <div className={styles.topBarSlot}>
        <TopBar />
      </div>

      <div className={styles.mainSidebarSlot}>
        <MainSidebar activeView={activeView} onSelectView={handleSelectView} />
      </div>

      <main className={styles.mainPane}>
        <Outlet />
      </main>

      <Toaster />
      <BoardOwnershipReviewMount />
    </div>
  );
}
