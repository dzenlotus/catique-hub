import { useState, type MouseEvent, type ReactElement } from "react";
import { useLocation } from "wouter";

import { cn } from "@shared/lib";
import { Button, Menu, MenuItem, MenuTrigger } from "@shared/ui";
import { booleanCodec, useLocalStorage } from "@shared/storage";
import type { Space } from "@entities/space";
import { type Board, useDeleteBoardMutation } from "@entities/board";
import { spaceSettingsPath } from "@app/routes";
import { useToast } from "@app/providers/ToastProvider";
import { BoardEditor } from "@widgets/board-editor";

import { ChevronIcon } from "./ChevronIcon";
import { KebabIcon } from "./KebabIcon";
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
  // ctq-76 item 3 — open BoardEditor when the user picks "Settings" from
  // the per-board kebab. Round-19d: Delete now wired to the existing
  // `delete_board` IPC; the mutation invalidates `useBoards()` so the
  // row disappears once the backend confirms.
  const [editingBoardId, setEditingBoardId] = useState<string | null>(null);
  const deleteBoardMutation = useDeleteBoardMutation();
  const { pushToast } = useToast();

  function handleDeleteBoard(board: Board): void {
    const ok = window.confirm(
      `Delete board "${board.name}"? Tasks and columns under it will go with it.`,
    );
    if (!ok) return;
    deleteBoardMutation.mutate(board.id, {
      onSuccess: () => {
        pushToast("success", "Board deleted");
      },
      onError: (err) => {
        pushToast("error", `Failed to delete board: ${err.message}`);
      },
    });
  }

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
              <li key={board.id} className={styles.boardItem}>
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

                {/* Per-board kebab menu — Settings opens BoardEditor.
                 *  Delete is omitted until the `delete_board` IPC lands. */}
                <MenuTrigger>
                  <Button
                    variant="ghost"
                    className={styles.boardKebabBtn}
                    aria-label={`Actions for board ${board.name}`}
                    data-testid={`spaces-sidebar-board-kebab-${board.id}`}
                  >
                    <KebabIcon />
                  </Button>
                  <Menu
                    onAction={(key) => {
                      if (key === "settings") setEditingBoardId(board.id);
                      else if (key === "delete") handleDeleteBoard(board);
                    }}
                  >
                    <MenuItem id="settings">Settings</MenuItem>
                    <MenuItem id="delete">Delete</MenuItem>
                  </Menu>
                </MenuTrigger>
              </li>
            );
          })}
        </ul>
      )}

      <BoardEditor
        boardId={editingBoardId}
        onClose={() => setEditingBoardId(null)}
      />
    </li>
  );
}
