import {
  useCallback,
  useMemo,
  useState,
  type ReactElement,
} from "react";
import { useLocationCompat as useLocation } from "@shared/lib";

import {
  Button,
  ConfirmDialog,
  EntityTree,
  type EntityTreeNode,
  KebabIcon,
  MarqueeText,
  Menu,
  MenuItem,
  MenuTrigger,
  RowLeading,
  SidebarShell,
} from "@shared/ui";
import { SidebarSectionAddTrigger } from "@shared/ui/SidebarShell";
import {
  booleanCodec,
  LocalStorageStore,
} from "@shared/storage";
import { useSpaces, type Space } from "@entities/space";
import {
  type Board,
  useBoards,
  useDeleteBoardMutation,
} from "@entities/board";
import { useActiveSpace } from "@app/providers/ActiveSpaceProvider";
import {
  boardPath,
  boardSettingsPath,
  matchBoardSurface,
  spaceSettingsPath,
} from "@app/routes";
import { useToast } from "@app/providers/ToastProvider";
import { SpaceCreateDialog } from "@features/space/create-dialog";

import styles from "./SpacesSidebar.module.css";

// ---------------------------------------------------------------------------
// Per-space expand persistence — one localStorage key per space, same
// contract as the legacy SpaceRow so existing user state survives.
// ---------------------------------------------------------------------------

function expandKey(spaceId: string): string {
  return `catique:sidebar:expanded:${spaceId}`;
}

function readPersistedExpanded(spaceId: string, fallback: boolean): boolean {
  const store = new LocalStorageStore<boolean>({
    key: expandKey(spaceId),
    codec: booleanCodec,
  });
  return store.get() ?? fallback;
}

function writePersistedExpanded(spaceId: string, next: boolean): void {
  const store = new LocalStorageStore<boolean>({
    key: expandKey(spaceId),
    codec: booleanCodec,
  });
  store.set(next);
}

// ---------------------------------------------------------------------------
// Node payload — what each EntityTree row knows about the entity it
// represents. Discriminated union so `renderRow` / `rowConfig` route on
// `kind`.
// ---------------------------------------------------------------------------

type SpaceTreePayload =
  | { kind: "space"; space: Space; isActiveSpace: boolean }
  | { kind: "board"; board: Board };

// ---------------------------------------------------------------------------
// SpacesSidebar — middle column of the three-column app shell.
//
// Hosts the SPACES section header and a collapsible space tree with
// inline board children. Built on top of the unified `<EntityTree/>`:
// space nodes carry `children` (boards) and a `chevron` toggle, board
// rows render a kebab menu via `renderRow`.
// ---------------------------------------------------------------------------

export function SpacesSidebar(): ReactElement {
  const spacesQuery = useSpaces();
  const boardsQuery = useBoards();
  const { activeSpaceId, setActiveSpaceId } = useActiveSpace();
  const [location, setLocation] = useLocation();
  const { pushToast } = useToast();

  const spaces = useMemo(() => spacesQuery.data ?? [], [spacesQuery.data]);
  const boards = useMemo(() => boardsQuery.data ?? [], [boardsQuery.data]);

  const [createDialogOpen, setCreateDialogOpen] = useState(false);

  // Both `/boards/:id` and `/boards/:id/settings` keep the same row
  // highlighted in the sidebar — when the user opens settings the
  // board still reads as "the active surface".
  const activeBoardId = matchBoardSurface(location)?.boardId ?? null;

  // Expand state lives here, seeded from localStorage on first read for
  // each space id. Toggling writes through so reloads restore the same
  // set of open spaces.
  const [expandedMap, setExpandedMap] = useState<Record<string, boolean>>({});

  const isExpanded = useCallback(
    (space: Space, index: number): boolean => {
      const current = expandedMap[space.id];
      if (current !== undefined) return current;
      // Fallback: first space + the user-declared default space start
      // expanded so the user lands on a populated tree.
      const fallback = index === 0 || space.isDefault;
      return readPersistedExpanded(space.id, fallback);
    },
    [expandedMap],
  );

  const toggleExpanded = useCallback(
    (space: Space, index: number): void => {
      setExpandedMap((prev) => {
        const current = prev[space.id];
        const resolved =
          current ?? readPersistedExpanded(space.id, index === 0 || space.isDefault);
        const next = !resolved;
        writePersistedExpanded(space.id, next);
        return { ...prev, [space.id]: next };
      });
    },
    [],
  );

  // Board delete confirmation — modal handles the destructive flow.
  const [boardPendingDelete, setBoardPendingDelete] = useState<Board | null>(
    null,
  );
  const deleteBoardMutation = useDeleteBoardMutation();

  const handleConfirmDeleteBoard = (): void => {
    if (boardPendingDelete === null) return;
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
  };

  const handleSelectSpace = useCallback(
    (space: Space): void => {
      setActiveSpaceId(space.id);
      setLocation(spaceSettingsPath(space.id));
    },
    [setActiveSpaceId, setLocation],
  );

  const handleSelectBoard = useCallback(
    (boardId: string): void => {
      setLocation(boardPath(boardId));
    },
    [setLocation],
  );

  // Tree data — root nodes are spaces; their children are the boards
  // attached to each space. The active-space flag is baked into the
  // payload so `rowConfig` doesn't have to close over the surrounding
  // hook.
  const treeData = useMemo<EntityTreeNode<SpaceTreePayload>[]>(
    () =>
      spaces.map((space) => ({
        id: space.id,
        label: space.name,
        data: {
          kind: "space",
          space,
          isActiveSpace: space.id === activeSpaceId,
        },
        children: boards
          .filter((b) => b.spaceId === space.id)
          .map((board) => ({
            id: board.id,
            label: board.name,
            data: { kind: "board", board },
          })),
      })),
    [spaces, boards, activeSpaceId],
  );

  const sectionState = (() => {
    if (spacesQuery.status === "pending") {
      return { isLoading: true, errorMessage: null as string | null };
    }
    if (spacesQuery.status === "error") {
      return {
        isLoading: false,
        errorMessage: `Spaces unavailable: ${spacesQuery.error.message}`,
      };
    }
    return { isLoading: false, errorMessage: null };
  })();

  return (
    <>
      <SidebarShell
        ariaLabel="Spaces navigation"
        testId="spaces-sidebar-root"
      >
        <EntityTree<SpaceTreePayload>
          testIdPrefix="spaces-sidebar"
          title="SPACES"
          titleAriaLabel="Spaces"
          titleTrailingNode={
            spacesQuery.status === "success" ? (
              <SidebarSectionAddTrigger
                ariaLabel="Add space"
                onPress={() => setCreateDialogOpen(true)}
                testId="spaces-sidebar-add"
              />
            ) : null
          }
          emptyText="No spaces yet"
          isLoading={sectionState.isLoading}
          errorMessage={sectionState.errorMessage}
          data={treeData}
          rowConfig={(node) => {
            const payload = node.data;
            if (payload?.kind === "space") {
              const { space } = payload;
              const spaceIndex = spaces.findIndex((s) => s.id === space.id);
              const expanded = isExpanded(space, spaceIndex);
              const onSpaceSettings = location === spaceSettingsPath(space.id);
              return {
                isActive: onSpaceSettings,
                onClick: () => handleSelectSpace(space),
                // Render as a Group even when the space currently has no
                // boards so the chevron stays visible and the user can
                // collapse / expand consistently across all spaces.
                expandable: true,
                isExpanded: expanded,
                onToggleExpand: () => toggleExpanded(space, spaceIndex),
                chevronAriaLabel: expanded
                  ? `Collapse ${space.name}`
                  : `Expand ${space.name}`,
              };
            }
            if (payload?.kind === "board") {
              const { board } = payload;
              return {
                isActive: activeBoardId === board.id,
                onClick: () => handleSelectBoard(board.id),
              };
            }
            return { isActive: false };
          }}
          renderRow={({ node }) => {
            const payload = node.data;
            if (payload?.kind === "space") {
              const { space, isActiveSpace } = payload;
              return (
                <button
                  type="button"
                  className={styles.spaceNameBtn}
                  onClick={() => handleSelectSpace(space)}
                  aria-label={`${space.name}${isActiveSpace ? " (active space)" : ""}`}
                  data-testid={`spaces-sidebar-space-name-${space.id}`}
                >
                  <RowLeading icon={space.icon} color={space.color} />
                  <MarqueeText
                    text={space.name}
                    className={styles.spaceNameText}
                  />
                </button>
              );
            }
            if (payload?.kind === "board") {
              const { board } = payload;
              return (
                <BoardRowBody
                  board={board}
                  onSelect={() => handleSelectBoard(board.id)}
                  onSettings={() =>
                    setLocation(boardSettingsPath(board.id))
                  }
                  onDelete={() => setBoardPendingDelete(board)}
                />
              );
            }
            return null;
          }}
        />
      </SidebarShell>

      <SpaceCreateDialog
        isOpen={createDialogOpen}
        onClose={() => setCreateDialogOpen(false)}
        onCreated={(space) => setActiveSpaceId(space.id)}
      />

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
        onConfirm={handleConfirmDeleteBoard}
        onCancel={() => setBoardPendingDelete(null)}
        data-testid="spaces-sidebar-board-delete-confirm"
      />
    </>
  );
}

// ---------------------------------------------------------------------------
// Board row body — kebab + label-button, lives outside `<EntityTree/>`
// because it needs the per-row action menu.
// ---------------------------------------------------------------------------

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
