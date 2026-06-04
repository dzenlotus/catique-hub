/**
 * AppSidebar — single unified left rail per Project Map v3.
 *
 * Sections (top → bottom):
 *   - Wordmark
 *   - Pinned boards (drag-to-reorder; Round 4 Stream O)
 *   - Spaces tree (composes the existing SpacesSidebar widget)
 *   - Nav (one EntityTree): Agents / Prompts / Skills / Integrations / Settings
 *
 * Spaces / boards search lives in the global header palette (Cmd+K), not
 * the sidebar — the redundant inline filter was removed (B2).
 */
import { useMemo, type ReactElement } from "react";

import { useBoards } from "@entities/board";
import { spaceBoardPath } from "@app/routes";
import type { NavView } from "@widgets/main-sidebar";
import { SpacesSidebar } from "@widgets/spaces-sidebar";
import { usePinnedBoards } from "@shared/storage";
import { useLocationCompat } from "@shared/lib";
import { EntityTree, type EntityTreeNode } from "@shared/ui";

import HeartSolid from "./assets/heart-solid.svg?react";
import { PinnedSection } from "./PinnedSection";
import {
  TOP_LEVEL_NAV,
  FOOTER_NAV,
  type AppNavItem,
} from "./workspaceItems";

import styles from "./AppSidebar.module.css";

export interface AppSidebarProps {
  activeView: NavView;
  onSelectView: (view: NavView) => void;
}

export function AppSidebar(props: AppSidebarProps): ReactElement {
  const { activeView, onSelectView } = props;

  const boardsQuery = useBoards();
  const [, setLocation] = useLocationCompat();

  const pinned = usePinnedBoards();

  const boards = boardsQuery.data ?? [];

  const pinnedRows = useMemo(
    () =>
      pinned
        .map((id) => boards.find((b) => b.id === id))
        .filter((b): b is (typeof boards)[number] => b !== undefined),
    [pinned, boards],
  );

  // Top-level nav + Settings ride ONE shared EntityTree so they read as a
  // single family with the Spaces tree (same row chrome + active strip).
  // Settings is just the last row of the same tree — not a separate footer.
  const navTreeData = useMemo<EntityTreeNode<AppNavItem>[]>(
    () =>
      [...TOP_LEVEL_NAV, FOOTER_NAV].map((item) => ({
        id: item.view,
        label: item.label,
        data: item,
      })),
    [],
  );

  function handleOpenBoard(boardId: string): void {
    const board = boards.find((b) => b.id === boardId);
    if (board !== undefined) {
      setLocation(spaceBoardPath(board.spaceId, board.id));
    }
  }

  const renderNavRow = ({
    node,
    isActive,
  }: {
    node: EntityTreeNode<AppNavItem>;
    isActive: boolean;
  }): ReactElement | null => {
    const item = node.data;
    if (!item) return null;
    return (
      <button
        type="button"
        className={styles.navItem}
        onClick={() => onSelectView(item.view)}
        aria-current={isActive ? "page" : undefined}
        aria-label={item.label}
        data-testid={`app-sidebar-nav-${item.view}`}
      >
        {item.icon}
        <span className={styles.navLabel}>{item.label}</span>
      </button>
    );
  };

  return (
    <nav
      className={styles.sidebar}
      aria-label="Main navigation"
      data-testid="app-sidebar-root"
    >
      <div className={styles.wordmark}>
        <span className={styles.wordmarkTitle}>Catique Hub</span>
        <HeartSolid
          width={14}
          height={14}
          className={styles.wordmarkHeart}
          aria-hidden={true}
        />
      </div>

      <div className={styles.scrollArea}>
        {pinnedRows.length > 0 ? (
          <PinnedSection
            boards={pinnedRows.map((b) => ({
              id: b.id,
              name: b.name,
              spaceId: b.spaceId,
            }))}
            onOpenBoard={handleOpenBoard}
          />
        ) : null}

        <div className={styles.spacesSlot} data-testid="app-sidebar-spaces-slot">
          {/* embedded — sheds the outer `<SidebarShell>` chrome so the
           *   SPACES heading sits as a peer of the "Pinned" section title
           *   above. */}
          <SpacesSidebar embedded />
        </div>
      </div>

      <div className={styles.navRail}>
        <EntityTree<AppNavItem>
          testIdPrefix="app-sidebar-nav"
          data={navTreeData}
          rowConfig={(node) => ({ isActive: node.id === activeView })}
          renderRow={renderNavRow}
        />
      </div>
    </nav>
  );
}
