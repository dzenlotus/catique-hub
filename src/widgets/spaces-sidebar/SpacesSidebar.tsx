import { useState, type ReactElement } from "react";
import { useLocation } from "wouter";

import { Scrollable } from "@shared/ui";
import {
  PixelInterfaceEssentialAlertCircle1,
  PixelInterfaceEssentialPlus,
} from "@shared/ui/Icon";
import { useSpaces } from "@entities/space";
import { useBoards } from "@entities/board";
import { useActiveSpace } from "@app/providers/ActiveSpaceProvider";
import { boardPath } from "@app/routes";
import { SpaceCreateDialog } from "@widgets/space-create-dialog";

import { SpaceRow } from "./SpaceRow";
import styles from "./SpacesSidebar.module.css";

// ---------------------------------------------------------------------------
// SpacesSidebar — middle column of the three-column app shell.
// ---------------------------------------------------------------------------

/**
 * Hosts the SPACES section header and the collapsible space tree (with
 * board children inline). Dwells in its own column so it can render
 * alongside the workspace nav rail on every route.
 *
 * Persistence of per-space expand state lives inside `SpaceRow` via
 * `useLocalStorage` keyed by `catique:sidebar:expanded:<spaceId>`.
 */
export function SpacesSidebar(): ReactElement {
  const spacesQuery = useSpaces();
  const boardsQuery = useBoards();
  const { activeSpaceId, setActiveSpaceId } = useActiveSpace();
  const [location, setLocation] = useLocation();

  const spaces = spacesQuery.data ?? [];
  const boards = boardsQuery.data ?? [];

  const [createDialogOpen, setCreateDialogOpen] = useState(false);

  // Derive the currently active board id from the URL.
  const activeBoardId: string | null = (() => {
    const match = location.match(/^\/boards\/(.+)$/);
    return match ? match[1] : null;
  })();

  function renderBody(): ReactElement {
    if (spacesQuery.status === "pending") {
      return (
        <div className={styles.spaceSwitcher} aria-hidden="true">
          <div className={styles.spaceSwitcherSkeleton} />
        </div>
      );
    }

    if (spacesQuery.status === "error") {
      return (
        <div
          className={styles.spaceSwitcher}
          role="alert"
          title={spacesQuery.error.message}
          aria-label="Failed to load spaces"
        >
          <PixelInterfaceEssentialAlertCircle1
            width={14}
            height={14}
            aria-hidden={true}
            className={styles.spaceErrorIcon}
          />
          <span className={styles.spaceErrorText}>Spaces unavailable</span>
        </div>
      );
    }

    if (spaces.length === 0 || activeSpaceId === null) {
      return (
        <div className={styles.sectionEmpty}>
          <span className={styles.sectionEmptyText}>No spaces yet</span>
        </div>
      );
    }

    return (
      <ul className={styles.spaceList} role="list">
        {spaces.map((space, index) => (
          <SpaceRow
            key={space.id}
            space={space}
            boards={boards}
            isActiveSpace={space.id === activeSpaceId}
            activeBoardId={activeBoardId}
            onSelectSpace={(id) => setActiveSpaceId(id)}
            onSelectBoard={(id) => setLocation(boardPath(id))}
            isDefaultExpanded={index === 0 || space.isDefault}
          />
        ))}
      </ul>
    );
  }

  return (
    <aside
      className={styles.sidebar}
      aria-label="Spaces navigation"
      data-testid="spaces-sidebar-root"
    >
      <Scrollable axis="y" className={styles.sectionsWrap}>
        <div className={styles.sectionLabel} aria-label="Spaces">
          SPACES
        </div>
        {renderBody()}

        {/*
         * Ctq-76 item 1: "+ Add space" trigger replaces the per-space kebab.
         * Sits at the bottom of the spaces tree so creation is always one
         * click away regardless of how many spaces are loaded. Hidden while
         * the spaces query is pending or errored — both branches return
         * earlier in `renderBody()`.
         */}
        {spacesQuery.status === "success" ? (
          <button
            type="button"
            className={styles.addSpaceRow}
            onClick={() => setCreateDialogOpen(true)}
            aria-label="Add space"
            data-testid="spaces-sidebar-add-space"
          >
            <PixelInterfaceEssentialPlus
              width={14}
              height={14}
              aria-hidden={true}
              className={styles.addSpaceIcon}
            />
            <span>Add space</span>
          </button>
        ) : null}
      </Scrollable>

      <SpaceCreateDialog
        isOpen={createDialogOpen}
        onClose={() => setCreateDialogOpen(false)}
        onCreated={(space) => setActiveSpaceId(space.id)}
      />
    </aside>
  );
}
