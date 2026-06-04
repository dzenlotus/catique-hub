import {
  useCallback,
  useMemo,
  useState,
  type ReactElement,
} from "react";
import { useLocationCompat as useLocation } from "@shared/lib";

import {
  ConfirmDialog,
  EntityActionMenu,
  EntityTree,
  type EntityTreeNode,
  MarqueeText,
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
import { useActiveSpace } from "@shared/lib";
import { useExpandedSpaces } from "@app/providers/ExpandedSpacesProvider";
import {
  boardPath,
  boardSettingsPath,
  matchBoardSurface,
  matchSpaceBoardSurface,
  spaceSettingsPath,
} from "@app/routes";
import { useToast } from "@shared/lib";
import { SpaceCreateDialog } from "@features/space/create-dialog";

import styles from "./SpacesSidebar.module.css";

// ---------------------------------------------------------------------------
// Per-space expand persistence — one localStorage key per space, same
// contract as the legacy SpaceRow so existing user state survives.
// ---------------------------------------------------------------------------

// Fallback icon for projects with no explicit icon — keeps the tree row
// from rendering a blank leading slot. Matches the nav's project glyph.
const DEFAULT_PROJECT_ICON = "PixelCodingAppsWebsitesModule";

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
//
// When mounted **inside** the unified `<AppSidebar/>` (Project Map v3),
// pass `embedded` so the outer `<SidebarShell>` chrome and the "SPACES"
// section title fold away — AppSidebar owns the section heading itself
// so it sits alongside its peer "Pinned" / "Recent" titles. Standalone
// callers (legacy pages, Storybook) get the default `embedded={false}`
// and keep the full chrome.
// ---------------------------------------------------------------------------

export interface SpacesSidebarProps {
  /**
   * When true, render only the `<EntityTree/>` block (no `<SidebarShell>`
   * wrapper, no "SPACES" header). The host is expected to provide its own
   * section title and surrounding chrome.
   */
  embedded?: boolean;
}

export function SpacesSidebar(props: SpacesSidebarProps = {}): ReactElement {
  const { embedded = false } = props;
  const spacesQuery = useSpaces();
  const boardsQuery = useBoards();
  const { activeSpaceId, setActiveSpaceId } = useActiveSpace();
  const [location, setLocation] = useLocation();
  const { pushToast } = useToast();

  const spaces = useMemo(() => spacesQuery.data ?? [], [spacesQuery.data]);
  const boards = useMemo(() => boardsQuery.data ?? [], [boardsQuery.data]);

  const [createDialogOpen, setCreateDialogOpen] = useState(false);

  // Keep the clicked board highlighted across every board surface. The
  // tree navigates to the CANONICAL `/spaces/:spaceId/boards/:boardId`
  // (spaceBoardPath), so that matcher must be checked FIRST; the legacy
  // `/boards/:id` form is kept as a fallback. (Settings sub-paths resolve
  // to the same boardId via the matchers, so the row stays active there.)
  const activeBoardId =
    matchSpaceBoardSurface(location)?.boardId ??
    matchBoardSurface(location)?.boardId ??
    null;

  // Expand state lives in the App-level `ExpandedSpacesProvider` so a
  // navigation that re-mounts `<SpacesSidebar/>` (e.g. clicking a board
  // → BoardHome → BoardDetailPage) keeps every previously-opened space
  // expanded. The provider also persists to localStorage on toggle.
  const { getExpanded, toggleExpanded: providerToggle } = useExpandedSpaces();

  const isExpanded = useCallback(
    (space: Space, index: number): boolean => {
      const explicit = getExpanded(space.id);
      if (explicit !== undefined) return explicit;
      // Fallback: first space + the user-declared default space start
      // expanded so the user lands on a populated tree.
      const fallback = index === 0 || space.isDefault;
      return readPersistedExpanded(space.id, fallback);
    },
    [getExpanded],
  );

  const toggleExpanded = useCallback(
    (space: Space, index: number): void => {
      const fallback = index === 0 || space.isDefault;
      const current =
        getExpanded(space.id) ?? readPersistedExpanded(space.id, fallback);
      providerToggle(space.id, current);
      // Keep the per-space localStorage slot in lockstep with the
      // provider's map so older keys written before round-N migration
      // still resolve correctly during the transition.
      writePersistedExpanded(space.id, !current);
    },
    [getExpanded, providerToggle],
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

  // When embedded inside `<AppSidebar/>` the host owns the section
  // heading + chrome, so we render the bare `<EntityTree/>` and surface
  // the "+ Add project" affordance through the embedded host instead of
  // the title trailing slot. Standalone usage keeps the full
  // `<SidebarShell>` + section title.
  const addSpaceTrigger =
    spacesQuery.status === "success" ? (
      <SidebarSectionAddTrigger
        ariaLabel="Add project"
        onPress={() => setCreateDialogOpen(true)}
        testId="spaces-sidebar-add"
      />
    ) : null;

  const tree = (
    <EntityTree<SpaceTreePayload>
      testIdPrefix="spaces-sidebar"
      {...(embedded
        ? {}
        : {
            title: "PROJECTS",
            titleAriaLabel: "Projects",
            titleTrailingNode: addSpaceTrigger,
          })}
      emptyText="No projects yet"
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
            <div className={styles.spaceRowBody}>
              <button
                type="button"
                className={styles.spaceNameBtn}
                onClick={() => handleSelectSpace(space)}
                aria-label={`${space.name}${isActiveSpace ? " (active space)" : ""}`}
                data-testid={`spaces-sidebar-space-name-${space.id}`}
              >
                <RowLeading
                  icon={space.icon ?? DEFAULT_PROJECT_ICON}
                  color={space.color}
                />
                <MarqueeText
                  text={space.name}
                  className={styles.spaceNameText}
                />
              </button>
            </div>
          );
        }
        if (payload?.kind === "board") {
          const { board } = payload;
          return (
            <BoardRowBody
              board={board}
              onSelect={() => handleSelectBoard(board.id)}
              onSettings={() => setLocation(boardSettingsPath(board.id))}
              onDelete={() => setBoardPendingDelete(board)}
            />
          );
        }
        return null;
      }}
    />
  );

  return (
    <>
      {embedded ? (
        // Host (`AppSidebar`) owns the outer `<aside>` landmark and
        // scroll container. We render a plain wrapper here with the
        // SPACES heading sitting as a peer of "Pinned" / "Recent" so
        // visual hierarchy stays flat. Loading / error / empty states
        // are surfaced inline because the headerless branch of
        // `<EntityTree/>` skips them.
        <div
          className={styles.embeddedRoot}
          data-testid="spaces-sidebar-root"
        >
          <div className={styles.embeddedTitleRow}>
            <span className={styles.embeddedTitle}>PROJECTS</span>
            {addSpaceTrigger}
          </div>
          {sectionState.isLoading ? (
            <div className={styles.embeddedHint} aria-hidden="true">
              Loading…
            </div>
          ) : sectionState.errorMessage !== null ? (
            <div className={styles.embeddedError} role="alert">
              {sectionState.errorMessage}
            </div>
          ) : treeData.length === 0 ? (
            <div className={styles.embeddedHint}>No projects yet</div>
          ) : (
            tree
          )}
        </div>
      ) : (
        <SidebarShell
          ariaLabel="Spaces navigation"
          testId="spaces-sidebar-root"
        >
          {tree}
        </SidebarShell>
      )}

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
  // Default boards are auto-created with their owning space and cannot
  // be deleted via the IPC (use-case returns Validation { is_default }).
  // Hide the affordance entirely so the user never fires a doomed delete.
  const menuItems = [
    { id: "settings", label: "Settings", onAction: onSettings },
    ...(board.isDefault
      ? []
      : [{ id: "delete", label: "Delete", onAction: onDelete }]),
  ];
  return (
    <div className={styles.boardRowBody}>
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
      <EntityActionMenu
        items={menuItems}
        triggerAriaLabel={`Actions for board ${board.name}`}
        triggerTestId={`spaces-sidebar-board-kebab-${board.id}`}
        triggerClassName={styles.boardKebab}
      />
    </div>
  );
}
