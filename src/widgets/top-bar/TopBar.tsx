/**
 * TopBar — top panel of the main pane.
 *
 * Layout (Image #30):
 *   ┌────────────────────────────────────────────────────────┐
 *   │  [Search ⌘K]                          [sync indicator] │
 *   └────────────────────────────────────────────────────────┘
 *
 * Round-21 added a global sync indicator on the right side of the
 * search row (`<SyncIndicator />`). It's hidden when the global sync
 * state is `idle`, so the bar stays clean during normal use.
 *
 * Single row only — no divider below, no icons after the indicator.
 * The breadcrumb is rendered separately in the page content (board
 * header), not duplicated here.
 */

import { useState, useCallback, type ReactElement } from "react";
import { PixelInterfaceEssentialSearch1 } from "@shared/ui/Icon";

import { GlobalSearch, useGlobalSearchKeybind } from "@widgets/global-search";
import { TaskCreateDialog } from "@widgets/task-create-dialog";

import { useNewTaskKeybind } from "./useNewTaskKeybind";
import { SyncIndicator } from "./SyncIndicator";
import styles from "./TopBar.module.css";

export function TopBar(): ReactElement {
  const [isSearchOpen, setIsSearchOpen] = useState(false);
  const [isCreateOpen, setIsCreateOpen] = useState(false);

  const openSearch = useCallback(() => setIsSearchOpen(true), []);
  const closeSearch = useCallback(() => setIsSearchOpen(false), []);

  useGlobalSearchKeybind(openSearch);
  useNewTaskKeybind(useCallback(() => setIsCreateOpen(true), []));

  return (
    <>
      <header
        className={styles.topBar}
        data-testid="top-bar"
        data-tauri-drag-region="true"
      >
        <div className={styles.searchRow} data-tauri-drag-region="true">
          <button
            type="button"
            className={styles.searchTrigger}
            onClick={openSearch}
            aria-label="Open global search"
            data-testid="top-bar-search-trigger"
          >
            <PixelInterfaceEssentialSearch1
              width={15}
              height={15}
              className={styles.searchIcon}
              aria-hidden="true"
            />
            <span className={styles.searchPlaceholder}>
              Search tasks, boards, agents...
            </span>
            <kbd className={styles.kbdHint} aria-label="Keyboard shortcut Cmd+K">
              ⌘K
            </kbd>
          </button>

          {/*
           * Global sync indicator (round-21). Pinned to the right of the
           * search row so it's visible from every page. Renders nothing
           * while the backend reports `idle` — the bar stays clean.
           */}
          <SyncIndicator />
        </div>

        <div
          className={styles.divider}
          role="presentation"
          data-tauri-drag-region="true"
        />
      </header>

      <GlobalSearch isOpen={isSearchOpen} onClose={closeSearch} />

      <TaskCreateDialog
        isOpen={isCreateOpen}
        onClose={() => setIsCreateOpen(false)}
      />
    </>
  );
}
