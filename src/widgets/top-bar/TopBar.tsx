/**
 * TopBar — top panel of the main pane.
 *
 * Layout:
 *   ┌────────────────────────────────────────────────────────┐
 *   │  [Search ⌘K]                          [sync indicator]  │
 *   └────────────────────────────────────────────────────────┘
 *
 *   The prompts tag-filter used to live here; it now lives in the
 *   prompts sidebar's PROMPTS section (`PromptsTagFilterPopover`),
 *   still writing into the shared `usePromptTagFilter` store that
 *   `PromptsSidebar` / `PromptsPage` read to filter the list.
 *
 * The centred pill opens the global `<GlobalSearch>` command palette
 * (click or Cmd/Ctrl-K). Selecting a result navigates to the entity.
 *
 * Single row only — no divider below, no icons after the indicator.
 * The breadcrumb is rendered separately in the page content (board
 * header), not duplicated here.
 */

import { useState, useCallback, type ReactElement } from "react";

import { TaskCreateDialog } from "@features/task/create-dialog";
import { GlobalSearch, useGlobalSearchKeybind } from "@widgets/global-search";
import { useLocationCompat } from "@shared/lib";
import { taskPath } from "@app/routes";
import type { SearchResult } from "@bindings/SearchResult";

import { useNewTaskKeybind } from "./useNewTaskKeybind";
import { SyncIndicator } from "./SyncIndicator";
import styles from "./TopBar.module.css";

export function TopBar(): ReactElement {
  const [isCreateOpen, setIsCreateOpen] = useState(false);
  const [isSearchOpen, setIsSearchOpen] = useState(false);
  const [, setLocation] = useLocationCompat();

  useNewTaskKeybind(useCallback(() => setIsCreateOpen(true), []));

  const openSearch = useCallback(() => setIsSearchOpen(true), []);
  const closeSearch = useCallback(() => setIsSearchOpen(false), []);
  useGlobalSearchKeybind(openSearch);

  // Navigate to the entity a search result points at. Tasks open their
  // detail surface directly; agent reports open the task they belong to.
  const handleSelectResult = useCallback(
    (result: SearchResult) => {
      if (result.type === "task") {
        setLocation(taskPath(result.id));
      } else {
        setLocation(taskPath(result.taskId));
      }
    },
    [setLocation],
  );

  return (
    <>
      <header
        className={styles.topBar}
        data-testid="top-bar"
        data-tauri-drag-region="true"
      >
        <div className={styles.searchRow} data-tauri-drag-region="true">
          {/*
           * Global search trigger — opens the Cmd+K command palette. The
           * pill is centred in the available width; the drag-region keeps
           * the surrounding strip movable.
           */}
          <button
            type="button"
            className={styles.searchTrigger}
            onClick={openSearch}
            aria-label="Search (⌘K)"
            data-testid="top-bar-search-trigger"
          >
            <span className={styles.searchPlaceholder}>Search…</span>
            <kbd className={styles.kbdHint} aria-hidden="true">
              ⌘K
            </kbd>
          </button>

          <div className={styles.searchTrailing} data-tauri-drag-region="true">
            {/*
             * Global sync indicator. Renders nothing while the backend
             * reports `idle` — the bar stays clean. The prompts tag-filter
             * moved out of the header into the prompts sidebar's PROMPTS
             * section (see `PromptsTagFilterPopover`).
             */}
            <SyncIndicator />
          </div>
        </div>

        <div
          className={styles.divider}
          role="presentation"
          data-tauri-drag-region="true"
        />
      </header>

      <GlobalSearch
        isOpen={isSearchOpen}
        onClose={closeSearch}
        onSelectResult={handleSelectResult}
      />

      <TaskCreateDialog
        isOpen={isCreateOpen}
        onClose={() => setIsCreateOpen(false)}
      />
    </>
  );
}
