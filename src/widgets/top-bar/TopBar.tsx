/**
 * TopBar — top panel of the main pane.
 *
 * Layout (Image #30):
 *   ┌────────────────────────────────────────────────────────┐
 *   │  [Search ⌘K]                          [+ New task]    │
 *   └────────────────────────────────────────────────────────┘
 *
 * Single row only — no divider below, no icons after the CTA. The
 * breadcrumb is rendered separately in the page content (board header),
 * not duplicated here.
 */

import { useState, useCallback, type ReactElement } from "react";
import { PixelInterfaceEssentialSearch1 } from "@shared/ui/Icon";

import { GlobalSearch, useGlobalSearchKeybind } from "@widgets/global-search";
import { TaskCreateDialog } from "@widgets/task-create-dialog";

import { useNewTaskKeybind } from "./useNewTaskKeybind";
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
           * The "+ New task" button was removed by user request — task
           * creation is reachable via the Cmd+N global keybind below
           * and through column / board surface affordances.
           */}
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
