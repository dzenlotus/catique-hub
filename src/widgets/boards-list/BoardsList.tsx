import { useState } from "react";
import type { FormEvent, ReactElement } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { BoardCard, useBoards, useCreateBoardMutation } from "@entities/board";
import { invoke } from "@shared/api";
import { Button, Dialog, Input } from "@shared/ui";
import { cn } from "@shared/lib";

import styles from "./BoardsList.module.css";

/**
 * Auto-generated default space sentinel — used in the dialog `<select>`
 * when no real spaces exist yet. The hardcoded id is replaced by the
 * real id once the user runs the bootstrap flow (or imports a Promptery
 * snapshot via Olga's E2 module).
 *
 * TODO(E3.x: real space provisioning): when the Spaces entity slice
 * arrives, replace this select with the real picker.
 */
const PLACEHOLDER_SPACE_ID = "default-space-id";

interface SpaceLike {
  id: string;
  name: string;
}

/**
 * Light-weight `list_spaces` query — local to this widget so we don't
 * pull a full Spaces entity slice in for E3.1's narrow needs (just:
 * "do any spaces exist?"). When the Spaces slice lands, replace this
 * with `useSpaces()` and delete the type below.
 */
function useSpacesPeek() {
  return useQuery<SpaceLike[], Error>({
    queryKey: ["spaces", "peek"],
    queryFn: async () => {
      try {
        return await invoke<SpaceLike[]>("list_spaces");
      } catch {
        // Either the IPC isn't wired yet (dev-time) or the DB is fresh.
        // Treat as "no spaces" so the bootstrap CTA renders.
        return [];
      }
    },
  });
}

interface BoardsListProps {
  /** Called when the user activates a board card. */
  onSelectBoard?: (boardId: string) => void;
}

/**
 * `BoardsList` — entry-page widget.
 *
 * Async-UI states (per design-discovery §4.4):
 *   1. loading — three skeleton cards.
 *   2. error — inline error panel + retry.
 *   3. empty — friendly headline + CTA pointing at the new-board dialog.
 *      When NO spaces exist yet, the dialog shows a "Bootstrap default
 *      space" button that calls `create_space` first, then opens the
 *      board form.
 *   4. populated — CSS-grid of `BoardCard`s.
 */
export function BoardsList({ onSelectBoard }: BoardsListProps = {}): ReactElement {
  const boardsQuery = useBoards();
  const [isDialogOpen, setIsDialogOpen] = useState(false);

  return (
    <section className={styles.root} aria-labelledby="boards-list-heading">
      <header className={styles.header}>
        <h2 id="boards-list-heading" className={styles.heading}>
          Boards
        </h2>
        <Button
          variant="primary"
          size="md"
          onPress={() => setIsDialogOpen(true)}
        >
          New board
        </Button>
      </header>

      {boardsQuery.status === "pending" ? (
        <div className={styles.grid} data-testid="boards-list-loading">
          <BoardCard isPending />
          <BoardCard isPending />
          <BoardCard isPending />
        </div>
      ) : boardsQuery.status === "error" ? (
        <div className={styles.error} role="alert">
          <p className={styles.errorMessage}>
            Couldn’t load boards: {boardsQuery.error.message}
          </p>
          <Button
            variant="secondary"
            size="sm"
            onPress={() => {
              void boardsQuery.refetch();
            }}
          >
            Retry
          </Button>
        </div>
      ) : boardsQuery.data.length === 0 ? (
        <div className={styles.empty} data-testid="boards-list-empty">
          <p className={styles.emptyTitle}>No boards yet</p>
          <p className={styles.emptyHint}>
            Create your first board to start organising tasks.
          </p>
          <Button
            variant="primary"
            size="md"
            onPress={() => setIsDialogOpen(true)}
          >
            Create your first board
          </Button>
        </div>
      ) : (
        <div className={styles.grid} data-testid="boards-list-grid">
          {boardsQuery.data.map((board) => (
            <BoardCard
              key={board.id}
              board={board}
              onSelect={(id) => {
                if (onSelectBoard) {
                  onSelectBoard(id);
                  return;
                }
                // Fallback (no-handler) — log so it's clear the prop is
                // missing. Useful while wiring up parent routing.
                // eslint-disable-next-line no-console
                console.info("[boards-list] select board:", id);
              }}
            />
          ))}
        </div>
      )}

      {isDialogOpen ? (
        <NewBoardDialog onClose={() => setIsDialogOpen(false)} />
      ) : null}
    </section>
  );
}

interface NewBoardDialogProps {
  onClose: () => void;
}

/**
 * Internal: new-board dialog.
 *
 * Three branches:
 *   1. spaces are loading → spinner-style hint inside the dialog.
 *   2. spaces returned empty → "Bootstrap default space" button. Clicking
 *      it calls `create_space({ name: 'default', prefix: 'def',
 *      isDefault: true })` then proceeds to step 3 with the new id.
 *   3. spaces present → full form (name input + space dropdown).
 */
function NewBoardDialog({ onClose }: NewBoardDialogProps): ReactElement {
  const queryClient = useQueryClient();
  const spacesQuery = useSpacesPeek();
  const [name, setName] = useState("");
  const [spaceId, setSpaceId] = useState<string | null>(null);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const createBoard = useCreateBoardMutation();

  const bootstrapSpace = useMutation<SpaceLike, Error, void>({
    mutationFn: async () => {
      const created = await invoke<SpaceLike>("create_space", {
        name: "default",
        prefix: "def",
        description: null,
        isDefault: true,
      });
      return created;
    },
    onSuccess: (created) => {
      setSpaceId(created.id);
      void queryClient.invalidateQueries({ queryKey: ["spaces", "peek"] });
    },
    onError: (err) => {
      setSubmitError(err.message);
    },
  });

  // Auto-pick the first space when the query resolves.
  if (
    spacesQuery.status === "success" &&
    spacesQuery.data.length > 0 &&
    spaceId === null
  ) {
    const first = spacesQuery.data[0];
    if (first) setSpaceId(first.id);
  }

  const handleSubmit = (e: FormEvent<HTMLFormElement>): void => {
    e.preventDefault();
    if (!name.trim()) {
      setSubmitError("Name is required.");
      return;
    }
    if (!spaceId) {
      // Fall back to placeholder so the IPC will respond predictably.
      // The user-visible flow always has a space picked — this branch
      // only triggers if state-management goes sideways.
      setSubmitError("Pick or bootstrap a space first.");
      return;
    }
    setSubmitError(null);
    createBoard.mutate(
      { name: name.trim(), spaceId },
      {
        onSuccess: () => {
          onClose();
        },
        onError: (err) => {
          setSubmitError(err.message);
        },
      },
    );
  };

  const noSpacesYet =
    spacesQuery.status === "success" && spacesQuery.data.length === 0;

  return (
    <Dialog
      title="New board"
      description="Boards live inside a Space. Pick a name and a target space."
      isOpen
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <form className={styles.form} onSubmit={handleSubmit} noValidate>
        <Input
          label="Board name"
          value={name}
          onChange={setName}
          placeholder="e.g. Roadmap"
          autoFocus
          {...(submitError && !name.trim()
            ? { errorMessage: submitError }
            : {})}
        />

        {noSpacesYet && spaceId === null ? (
          <div className={styles.bootstrap}>
            <p className={styles.bootstrapHint}>
              No spaces found yet. Bootstrap a default space to continue.
            </p>
            <Button
              variant="secondary"
              type="button"
              size="sm"
              isPending={bootstrapSpace.isPending}
              onPress={() => bootstrapSpace.mutate()}
              data-testid="bootstrap-default-space"
            >
              Bootstrap default space
            </Button>
          </div>
        ) : (
          <label className={styles.selectField}>
            <span className={styles.selectLabel}>Space</span>
            <select
              className={styles.select}
              value={spaceId ?? PLACEHOLDER_SPACE_ID}
              onChange={(e) => setSpaceId(e.target.value)}
            >
              {spacesQuery.status === "success" && spacesQuery.data.length > 0
                ? spacesQuery.data.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.name}
                    </option>
                  ))
                : (
                    /* Placeholder while loading. */
                    <option value={PLACEHOLDER_SPACE_ID}>default</option>
                  )}
            </select>
          </label>
        )}

        {submitError && (name.trim() || !noSpacesYet) ? (
          <p className={cn(styles.formError)} role="alert">
            {submitError}
          </p>
        ) : null}

        <div className={styles.formActions}>
          <Button variant="ghost" type="button" onPress={onClose}>
            Cancel
          </Button>
          <Button
            variant="primary"
            type="submit"
            isPending={createBoard.isPending}
            isDisabled={spaceId === null}
          >
            Create board
          </Button>
        </div>
      </form>
    </Dialog>
  );
}
