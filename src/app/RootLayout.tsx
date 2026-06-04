/**
 * Root layout shell for the TanStack Router tree.
 *
 * v3 grid:
 *   [ AppSidebar ] [ TopBar      ]
 *   [ AppSidebar ] [ Outlet      ]
 *   [ AppSidebar ] [ StatusBar   ]
 *
 * The AppSidebar consolidates the legacy `MainSidebar` (top-level nav)
 * and `SpacesSidebar` (per-space tree) into a single rail with Pinned /
 * Recent / Search / collapse — so individual pages no longer mount
 * their own secondary navigation. Pages that previously embedded
 * `<SpacesSidebar/>` lose the embed in their content area.
 */
import { useMemo, type ReactElement } from "react";
import { Outlet, useNavigate, useRouterState } from "@tanstack/react-router";

import { AppSidebar } from "@widgets/app-sidebar";
import type { NavView } from "@widgets/main-sidebar";
import { TopBar } from "@widgets/top-bar";
import { Toaster } from "@widgets/toaster";
import { StatusBar } from "@widgets/status-bar";

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
        <AppSidebar activeView={activeView} onSelectView={handleSelectView} />
      </div>

      <main className={styles.mainPane}>
        <Outlet />
      </main>

      <div className={styles.statusBarSlot}>
        <StatusBar />
      </div>

      <Toaster />
      <BoardOwnershipReviewMount />
    </div>
  );
}
