import { useState, type MouseEvent, type ReactElement } from "react";
import { useLocation } from "wouter";

import { cn } from "@shared/lib";
import {
  Button,
  ConfirmDialog,
  Menu,
  MenuItem,
  MarqueeText,
  MenuTrigger,
} from "@shared/ui";
import { SidebarNavItem } from "@shared/ui/SidebarShell";
import { booleanCodec, useLocalStorage } from "@shared/storage";
import type { Space } from "@entities/space";
import { type Board, useDeleteBoardMutation } from "@entities/board";
import { boardSettingsPath, spaceSettingsPath } from "@app/routes";
import { useToast } from "@app/providers/ToastProvider";
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
  // Round-19e: "Settings" from the per-board kebab navigates to the
  // /boards/:id/settings route (replaces the modal-based BoardEditor).
  // Replaces the old `window.confirm` flow — modal shows up via the
  // `<ConfirmDialog>` rendered at the bottom of this row.
  const [boardPendingDelete, setBoardPendingDelete] =
    useState<Board | null>(null);
  const deleteBoardMutation = useDeleteBoardMutation();
  const { pushToast } = useToast();

  function handleDeleteBoard(board: Board): void {
    setBoardPendingDelete(board);
  }

  function confirmDeleteBoard(): void {
    if (!boardPendingDelete) return;
    deleteBoardMutation.mutate(boardPendingDelete.id, {
      onSuccess: () => {
        pushToast("success", "Board deleted");
        setBoardPendingDelete(null);
      },
      onError: (err) => {
        pushToast("error", `Failed to delete board: ${err.message}`);
        setBoardPendingDelete(null);
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
          <SpaceIcon name={space.name} icon={space.icon} color={space.color} />
          <MarqueeText text={space.name} className={styles.spaceNameText} />
        </button>
      </div>

      {/* Board rows inside expanded space */}
      {isExpanded && spaceBoards.length > 0 && (
        <ul className={styles.boardList} role="list">
          {spaceBoards.map((board) => {
            const isActive = activeBoardId === board.id;
            return (
              <li key={board.id} className={styles.boardItem}>
                <SidebarNavItem
                  isActive={isActive}
                  level={1}
                  ariaLabel={board.name}
                  onClick={() => onSelectBoard(board.id)}
                  trailing={
                    <MenuTrigger>
                      <Button
                        variant="ghost"
                        size="sm"
                        aria-label={`Actions for board ${board.name}`}
                        data-testid={`spaces-sidebar-board-kebab-${board.id}`}
                      >
                        <KebabIcon />
                      </Button>
                      <Menu
                        onAction={(key) => {
                          if (key === "settings") setLocation(boardSettingsPath(board.id));
                          else if (key === "delete") handleDeleteBoard(board);
                        }}
                      >
                        <MenuItem id="settings">Settings</MenuItem>
                        {/*
                         * Default boards are auto-created with their
                         * owning space and cannot be deleted via the IPC
                         * (use-case returns Validation { is_default }).
                         * Hide the affordance entirely so the user never
                         * fires a doomed delete.
                         */}
                        {board.isDefault ? null : (
                          <MenuItem id="delete">Delete</MenuItem>
                        )}
                      </Menu>
                    </MenuTrigger>
                  }
                >
                  <BoardIcon
                    name={board.name}
                    icon={board.icon}
                    color={board.color}
                  />
                  <MarqueeText
                    text={board.name}
                    className={styles.boardRowLabel}
                  />
                </SidebarNavItem>
              </li>
            );
          })}
        </ul>
      )}

      <ConfirmDialog
        isOpen={boardPendingDelete !== null}
        title={
          boardPendingDelete
            ? `Delete board "${boardPendingDelete.name}"?`
            : "Delete board?"
        }
        description="Tasks and columns under this board will be removed too. This cannot be undone."
        confirmLabel="Delete"
        destructive
        isPending={deleteBoardMutation.status === "pending"}
        onConfirm={confirmDeleteBoard}
        onCancel={() => setBoardPendingDelete(null)}
        data-testid="spaces-sidebar-board-delete-confirm"
      />
    </li>
  );
}
