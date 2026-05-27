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

import { TaskCreateDialog } from "@features/task/create-dialog";

import { useNewTaskKeybind } from "./useNewTaskKeybind";
import { SyncIndicator } from "./SyncIndicator";
import styles from "./TopBar.module.css";

/*
 * Global search is currently disabled — the backend search API + index
 * are not yet implemented, so the trigger button, the Cmd+K keybind,
 * and the `<GlobalSearch/>` palette mount would all promise behaviour
 * the app can't deliver. The widget code stays in `@widgets/global-search`
 * so we can wire it back once the backend lands; this file only owns
 * the mount point.
 */

export function TopBar(): ReactElement {
  const [isCreateOpen, setIsCreateOpen] = useState(false);

  useNewTaskKeybind(useCallback(() => setIsCreateOpen(true), []));

  return (
    <>
      <header
        className={styles.topBar}
        data-testid="top-bar"
        data-tauri-drag-region="true"
      >
        <div className={styles.searchRow} data-tauri-drag-region="true">
          {/*
           * Spacer keeps the SyncIndicator pinned right while the search
           * trigger is offline. The drag-region attribute keeps the
           * Tauri window movable from anywhere in this strip.
           */}
          <span className={styles.searchSpacer} data-tauri-drag-region="true" />

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

      <TaskCreateDialog
        isOpen={isCreateOpen}
        onClose={() => setIsCreateOpen(false)}
      />
    </>
  );
}
