import { useState, type ReactElement } from "react";
import { useLocation } from "wouter";

import {
  SidebarShell,
  SidebarSectionLabel,
  SidebarSectionAddTrigger,
} from "@shared/ui";
import { PixelInterfaceEssentialAlertCircle1 } from "@shared/ui/Icon";
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

  // Derive the currently active board id from the URL. Both
  // `/boards/:id` and `/boards/:id/settings` keep the same row
  // highlighted in the sidebar — when the user opens settings the
  // board still reads as "the active surface".
  const activeBoardId: string | null = (() => {
    const match = location.match(/^\/boards\/([^/]+)(?:\/.*)?$/);
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
    <>
      <SidebarShell
        ariaLabel="Spaces navigation"
        testId="spaces-sidebar-root"
      >
        <SidebarSectionLabel
          ariaLabel="Spaces"
          trailing={
            spacesQuery.status === "success" ? (
              <SidebarSectionAddTrigger
                ariaLabel="Add space"
                onPress={() => setCreateDialogOpen(true)}
                testId="spaces-sidebar-add-space"
              />
            ) : null
          }
        >
          SPACES
        </SidebarSectionLabel>
        {renderBody()}
      </SidebarShell>

      <SpaceCreateDialog
        isOpen={createDialogOpen}
        onClose={() => setCreateDialogOpen(false)}
        onCreated={(space) => setActiveSpaceId(space.id)}
      />
    </>
  );
}
