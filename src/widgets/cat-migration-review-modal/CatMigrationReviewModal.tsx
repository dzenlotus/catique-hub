/**
 * CatMigrationReviewModal — one-shot post-migration review of board
 * owner-cats (ctq-82, P1-T4).
 *
 * Migration `004_cat_as_agent_phase1.sql` auto-assigned every existing
 * board to `maintainer-system` and seeded
 * `settings.cat_migration_reviewed = 'false'`. Until the user dismisses
 * the modal via the "Looks good" CTA the flag stays `false` and the
 * modal re-opens on next boot.
 *
 * Behaviour summary:
 *   - Reads the flag via `get_setting('cat_migration_reviewed')`. The
 *     mount-side `<CatMigrationReviewMount>` decides whether to render
 *     this component at all — the modal itself assumes "open".
 *   - Renders one row per board (across every space) with a per-row
 *     Combobox of selectable cats. Source: `useRoles({excludeSystem})`
 *     which drops the coordinator-only `dirizher-system` row (ctq-88
 *     guard). Maintainer + every user-defined cat stay visible.
 *   - On selection change → optimistically writes the new owner into
 *     the `["boards", id]` cache, fires `set_board_owner`, and rolls
 *     back + toasts on error.
 *   - "Looks good" CTA → `set_setting('cat_migration_reviewed','true')`
 *     and closes. Closing via Esc / scrim does NOT set the flag, so the
 *     modal re-opens next boot.
 *
 * Shape note: this widget is rendered with `isOpen={true}` from a
 * mount-side guard. Keeping the open/close contract local lets the
 * component stay testable with the standard `<Dialog>` primitive while
 * the mount-side wrapper owns the boot-time check.
 */

import { useCallback, type ReactElement } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import type { Key } from "react-aria-components";

import { boardsKeys, useBoards } from "@entities/board";
import type { Board } from "@entities/board";
import { useRoles } from "@entities/role";
import type { Role } from "@entities/role";
import { useSpaces } from "@entities/space";
import { invoke } from "@shared/api";
import {
  Button,
  Combobox,
  Dialog,
  DialogFooter,
  type ComboboxItem,
} from "@shared/ui";
import { useToast } from "@app/providers/ToastProvider";

import styles from "./CatMigrationReviewModal.module.css";

/** Settings key — must match the migration seed (`migrations/004_…`). */
export const CAT_MIGRATION_REVIEWED_KEY = "cat_migration_reviewed";

export interface CatMigrationReviewModalProps {
  /** Controls modal visibility. */
  isOpen: boolean;
  /**
   * Called when the user closes the modal WITHOUT confirming review
   * (Esc, scrim click, programmatic close). The flag is NOT set, so
   * the mount-side guard re-opens the modal on next boot.
   */
  onDismiss: () => void;
  /**
   * Called after a successful `set_setting` write that pins
   * `cat_migration_reviewed='true'`. The mount-side guard tears the
   * modal down once this fires.
   */
  onConfirmed: () => void;
}

export function CatMigrationReviewModal({
  isOpen,
  onDismiss,
  onConfirmed,
}: CatMigrationReviewModalProps): ReactElement {
  return (
    <Dialog
      title="Review your boards' cats"
      description="Migration auto-assigned the Maintainer cat to every existing board. Pick a different cat for any board you want, then confirm."
      isOpen={isOpen}
      onOpenChange={(open) => {
        if (!open) onDismiss();
      }}
      isDismissable
      data-testid="cat-migration-review-modal"
    >
      <CatMigrationReviewBody onConfirmed={onConfirmed} />
    </Dialog>
  );
}

// ─────────────────────────────────────────────────────────────────────────────

interface CatMigrationReviewBodyProps {
  onConfirmed: () => void;
}

function CatMigrationReviewBody({
  onConfirmed,
}: CatMigrationReviewBodyProps): ReactElement {
  const boardsQuery = useBoards();
  const spacesQuery = useSpaces();
  // Owner-cat picker source. `excludeSystem: true` drops the
  // coordinator-only `dirizher-system` row (ctq-88 guard) but keeps
  // `maintainer-system` and every user-defined cat — Maintainer is the
  // pre-assigned owner from migration 004 and must stay selectable.
  const rolesQuery = useRoles({ excludeSystem: true });
  const { pushToast } = useToast();

  const confirmMutation = useMutation<void, Error, void>({
    mutationFn: async () => {
      await invoke<void>("set_setting", {
        key: CAT_MIGRATION_REVIEWED_KEY,
        value: "true",
      });
    },
    onSuccess: () => {
      onConfirmed();
    },
    onError: (err) => {
      pushToast(
        "error",
        `Failed to mark migration review as done: ${err.message}`,
      );
    },
  });

  const handleConfirm = useCallback((): void => {
    confirmMutation.mutate();
  }, [confirmMutation]);

  if (boardsQuery.status === "pending" || spacesQuery.status === "pending") {
    return (
      <div className={styles.body} data-testid="cat-migration-review-loading">
        <p className={styles.intro}>Loading boards…</p>
      </div>
    );
  }

  if (boardsQuery.status === "error") {
    return (
      <div className={styles.body} data-testid="cat-migration-review-error">
        <p className={styles.intro}>
          Failed to load boards: {boardsQuery.error.message}
        </p>
      </div>
    );
  }

  const boards = boardsQuery.data;
  const spaces = spacesQuery.status === "success" ? spacesQuery.data : [];
  const spacePrefixById = new Map(spaces.map((s) => [s.id, s.prefix]));
  const roles: Role[] = rolesQuery.status === "success" ? rolesQuery.data : [];

  return (
    <div className={styles.body} data-testid="cat-migration-review-body">
      {boards.length === 0 ? (
        <p className={styles.empty} data-testid="cat-migration-review-empty">
          No boards exist yet — nothing to review.
        </p>
      ) : (
        <ul className={styles.list} data-testid="cat-migration-review-list">
          {boards.map((board) => (
            <BoardRow
              key={board.id}
              board={board}
              spacePrefix={spacePrefixById.get(board.spaceId) ?? null}
              roles={roles}
              rolesPending={rolesQuery.status === "pending"}
            />
          ))}
        </ul>
      )}

      <DialogFooter data-testid="cat-migration-review-footer">
        <div className={styles.footer}>
          <Button
            variant="primary"
            size="md"
            onPress={handleConfirm}
            isPending={confirmMutation.isPending}
            data-testid="cat-migration-review-confirm"
          >
            Looks good
          </Button>
        </div>
      </DialogFooter>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────

interface BoardRowProps {
  board: Board;
  spacePrefix: string | null;
  roles: Role[];
  rolesPending: boolean;
}

function BoardRow({
  board,
  spacePrefix,
  roles,
  rolesPending,
}: BoardRowProps): ReactElement {
  const queryClient = useQueryClient();
  const { pushToast } = useToast();

  const setOwnerMutation = useMutation<
    Board,
    Error,
    { roleId: string },
    { previousDetail: Board | undefined; previousList: Board[] | undefined }
  >({
    mutationFn: async ({ roleId }) => {
      return invoke<Board>("set_board_owner", {
        boardId: board.id,
        roleId,
      });
    },
    onMutate: async ({ roleId }) => {
      await queryClient.cancelQueries({
        queryKey: boardsKeys.detail(board.id),
      });
      await queryClient.cancelQueries({ queryKey: boardsKeys.list() });
      const previousDetail = queryClient.getQueryData<Board>(
        boardsKeys.detail(board.id),
      );
      const previousList = queryClient.getQueryData<Board[]>(
        boardsKeys.list(),
      );
      if (previousDetail !== undefined) {
        queryClient.setQueryData<Board>(boardsKeys.detail(board.id), {
          ...previousDetail,
          ownerRoleId: roleId,
        });
      }
      if (previousList !== undefined) {
        queryClient.setQueryData<Board[]>(
          boardsKeys.list(),
          previousList.map((b) =>
            b.id === board.id ? { ...b, ownerRoleId: roleId } : b,
          ),
        );
      }
      return { previousDetail, previousList };
    },
    onError: (err, _vars, ctx) => {
      // Roll back both cache entries — the optimistic update touched
      // both, so a one-sided rollback would leave inconsistent state.
      if (ctx?.previousDetail !== undefined) {
        queryClient.setQueryData(
          boardsKeys.detail(board.id),
          ctx.previousDetail,
        );
      }
      if (ctx?.previousList !== undefined) {
        queryClient.setQueryData(boardsKeys.list(), ctx.previousList);
      }
      pushToast("error", `Failed to update owner cat: ${err.message}`);
    },
    onSuccess: (updated) => {
      // Re-sync detail with server-authoritative timestamps, then bump
      // the list cache so any board cards downstream pick up the change.
      queryClient.setQueryData(boardsKeys.detail(board.id), updated);
      void queryClient.invalidateQueries({ queryKey: boardsKeys.list() });
    },
  });

  const items: ComboboxItem[] = roles.map((r) => ({
    id: r.id,
    label: r.name,
  }));

  const onSelectionChange = (key: Key | null): void => {
    if (key === null) return;
    const next = String(key);
    if (next === board.ownerRoleId) return;
    setOwnerMutation.mutate({ roleId: next });
  };

  // Combobox is fully controlled by `selectedKey` to keep the visible
  // cat in lock-step with the optimistic `board.ownerRoleId` reads
  // (which the parent re-renders from the react-query cache).
  return (
    <li
      className={styles.row}
      data-testid={`cat-migration-review-row-${board.id}`}
    >
      <div className={styles.boardLabel}>
        <span className={styles.boardName}>{board.name}</span>
        {spacePrefix !== null ? (
          <span className={styles.boardSpace}>{spacePrefix}/</span>
        ) : null}
      </div>
      <Combobox
        label="Owner cat"
        items={items}
        selectedKey={board.ownerRoleId}
        onSelectionChange={onSelectionChange}
        isDisabled={rolesPending || setOwnerMutation.isPending}
        data-testid={`cat-migration-review-combobox-${board.id}`}
      />
    </li>
  );
}
