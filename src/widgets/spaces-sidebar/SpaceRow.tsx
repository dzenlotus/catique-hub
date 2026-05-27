import { useState, type ReactElement } from "react";
import { useLocationCompat as useLocation } from "@shared/lib";

import {
  Button,
  ConfirmDialog,
  Group,
  KebabIcon,
  MarqueeText,
  Menu,
  MenuItem,
  MenuTrigger,
  Row,
  RowLeading,
} from "@shared/ui";
import { booleanCodec, useLocalStorage } from "@shared/storage";
import type { Space } from "@entities/space";
import {
  type Board,
  useDeleteBoardMutation,
} from "@entities/board";
import { boardSettingsPath, spaceSettingsPath } from "@app/routes";
import { useToast } from "@app/providers/ToastProvider";
import styles from "./SpacesSidebar.module.css";

// Per-space expanded flag survives reload through `useLocalStorage`. The
// hook handles fallback in restricted environments (SSR / private mode).
function getExpandedKey(spaceId: string): string {
  return `catique:sidebar:expanded:${spaceId}`;
}

// ---------------------------------------------------------------------------
// SpaceRow — inline collapsible space item with board children.
//
// Round-26 (Row/Group split): the row chrome (red strip, accent-soft
// underlay, hover overlay, chevron column) lives in
// `shared/ui/EntityTree`. This widget only owns the row bodies + the
// board kebab menu + the delete ConfirmDialog.
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
  const [location, setLocation] = useLocation();
  const [isExpanded, setIsExpanded] = useLocalStorage(
    getExpandedKey(space.id),
    booleanCodec,
    isDefaultExpanded,
  );

  // Round-19f: highlight the space header when the user is on its
  // settings page, mirroring how the board row highlights when a
  // /boards/:id route is active. Other surfaces (BoardHome, kanban)
  // intentionally don't trigger this — the active board row carries
  // the highlight there.
  const isOnSpaceSettings = location === spaceSettingsPath(space.id);

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
  function handleSelectSpace(): void {
    onSelectSpace(space.id);
    setLocation(spaceSettingsPath(space.id));
  }

  function handleToggleExpand(): void {
    setIsExpanded((prev) => !prev);
  }

  return (
    <>
      <Group
        testId={`spaces-sidebar-space-row-${space.id}`}
        isActive={isOnSpaceSettings}
        isExpand={isExpanded}
        onToggleExpand={handleToggleExpand}
        chevronAriaLabel={
          isExpanded ? `Collapse ${space.name}` : `Expand ${space.name}`
        }
        onClick={handleSelectSpace}
        renderContent={() => (
          <SpaceHeaderBody
            space={space}
            isActiveSpace={isActiveSpace}
            onSelect={handleSelectSpace}
          />
        )}
      >
        {spaceBoards.map((board) => (
          <Row
            key={board.id}
            testId={`spaces-sidebar-board-row-${board.id}`}
            isActive={activeBoardId === board.id}
            onClick={() => onSelectBoard(board.id)}
            renderContent={() => (
              <BoardRowBody
                board={board}
                onSelect={() => onSelectBoard(board.id)}
                onSettings={() => setLocation(boardSettingsPath(board.id))}
                onDelete={() => handleDeleteBoard(board)}
              />
            )}
          />
        ))}
      </Group>

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
    </>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Row bodies — canonical `renderContent` shape (same as PromptsSidebar):
// label-button on the left, kebab MenuTrigger as a sibling on the right.
// ─────────────────────────────────────────────────────────────────────────────

interface SpaceHeaderBodyProps {
  space: Space;
  isActiveSpace: boolean;
  onSelect: () => void;
}

function SpaceHeaderBody({
  space,
  isActiveSpace,
  onSelect,
}: SpaceHeaderBodyProps): ReactElement {
  return (
    <button
      type="button"
      className={styles.spaceNameBtn}
      onClick={onSelect}
      aria-label={`${space.name}${isActiveSpace ? " (active space)" : ""}`}
      data-testid={`spaces-sidebar-space-name-${space.id}`}
    >
      <RowLeading icon={space.icon} color={space.color} />
      <MarqueeText text={space.name} className={styles.spaceNameText} />
    </button>
  );
}

interface BoardRowBodyProps {
  board: Board;
  onSelect: () => void;
  onSettings: () => void;
  onDelete: () => void;
}

function BoardRowBody({
  board,
  onSelect,
  onSettings,
  onDelete,
}: BoardRowBodyProps): ReactElement {
  return (
    <>
      <button
        type="button"
        className={styles.boardRowBtn}
        onClick={onSelect}
        aria-label={board.name}
        data-testid={`spaces-sidebar-board-row-btn-${board.id}`}
      >
        <RowLeading icon={board.icon} color={board.color} />
        <MarqueeText text={board.name} className={styles.boardRowLabel} />
      </button>
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
            if (key === "settings") onSettings();
            else if (key === "delete") onDelete();
          }}
        >
          <MenuItem id="settings">Settings</MenuItem>
          {/*
           * Default boards are auto-created with their owning space and
           * cannot be deleted via the IPC (use-case returns
           * Validation { is_default }). Hide the affordance entirely so
           * the user never fires a doomed delete.
           */}
          {board.isDefault ? null : <MenuItem id="delete">Delete</MenuItem>}
        </Menu>
      </MenuTrigger>
    </>
  );
}
