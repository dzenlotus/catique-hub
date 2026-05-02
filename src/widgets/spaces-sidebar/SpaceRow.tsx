import { type MouseEvent, type ReactElement } from "react";
import { useLocation } from "wouter";

import { cn } from "@shared/lib";
import { Button } from "@shared/ui";
import { booleanCodec, useLocalStorage } from "@shared/storage";
import type { Space } from "@entities/space";
import type { Board } from "@entities/board";
import { spaceSettingsPath } from "@app/routes";

import { ChevronIcon } from "./ChevronIcon";
import { BoardIcon, SpaceIcon } from "./icons";
import styles from "./SpacesSidebar.module.css";

// Per-space expanded flag survives reload through `useLocalStorage`. The
// hook handles fallback in restricted environments (SSR / private mode).
function getExpandedKey(spaceId: string): string {
  return `catique:sidebar:expanded:${spaceId}`;
}

// ---------------------------------------------------------------------------
// SpaceRow — inline collapsible space item with board children.
// ---------------------------------------------------------------------------

interface SpaceRowProps {
  space: Space;
  boards: Board[];
  isActiveSpace: boolean;
  activeBoardId: string | null;
  onSelectSpace: (id: string) => void;
  onSelectBoard: (id: string) => void;
  isDefaultExpanded: boolean;
}

export function SpaceRow({
  space,
  boards,
  isActiveSpace,
  activeBoardId,
  onSelectSpace,
  onSelectBoard,
  isDefaultExpanded,
}: SpaceRowProps): ReactElement {
  const [, setLocation] = useLocation();
  const [isExpanded, setIsExpanded] = useLocalStorage(
    getExpandedKey(space.id),
    booleanCodec,
    isDefaultExpanded,
  );

  const spaceBoards = boards.filter((b) => b.spaceId === space.id);

  // Clicking the space name navigates to the per-space settings page on
  // top of setting the active space so the rest of the app (BoardHome
  // redirects, ScopeSwitch, etc.) stays in sync.
  function handleNameClick(): void {
    onSelectSpace(space.id);
    setLocation(spaceSettingsPath(space.id));
  }

  function handleChevronClick(e: MouseEvent): void {
    e.stopPropagation();
    setIsExpanded((prev) => !prev);
  }

  return (
    <li className={styles.spaceItem}>
      {/* Space header row */}
      <div
        className={cn(styles.spaceRow, isActiveSpace && styles.spaceRowActive)}
        data-testid={`spaces-sidebar-space-row-${space.id}`}
      >
        {/* Chevron — toggles expand/collapse, does NOT change active space */}
        <Button
          variant="ghost"
          className={styles.spaceChevronBtn}
          onClick={handleChevronClick}
          aria-label={isExpanded ? `Collapse ${space.name}` : `Expand ${space.name}`}
          aria-expanded={isExpanded}
        >
          <ChevronIcon open={isExpanded} />
        </Button>

        {/* Space icon + name — sets active space + navigates to settings */}
        <button
          type="button"
          className={styles.spaceNameBtn}
          onClick={handleNameClick}
          aria-label={`${space.name}${isActiveSpace ? " (active space)" : ""}`}
          data-testid={`spaces-sidebar-space-name-${space.id}`}
        >
          <SpaceIcon name={space.name} />
          <span className={styles.spaceNameText}>{space.name}</span>
        </button>
      </div>

      {/* Board rows inside expanded space */}
      {isExpanded && spaceBoards.length > 0 && (
        <ul className={styles.boardList} role="list">
          {spaceBoards.map((board) => {
            const isActive = activeBoardId === board.id;
            return (
              <li key={board.id}>
                <button
                  type="button"
                  className={cn(styles.boardRow, isActive && styles.boardRowActive)}
                  onClick={() => onSelectBoard(board.id)}
                  aria-current={isActive ? "page" : undefined}
                  aria-label={board.name}
                >
                  {/* Active strip for board row */}
                  {isActive && <span className={styles.boardActiveStrip} aria-hidden="true" />}
                  <BoardIcon name={board.name} />
                  <span className={styles.boardRowLabel}>{board.name}</span>
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </li>
  );
}
