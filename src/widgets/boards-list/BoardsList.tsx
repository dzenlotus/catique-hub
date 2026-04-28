import { useState } from "react";
import type { FormEvent, ReactElement } from "react";

import { BoardCard, useBoards, useCreateBoardMutation } from "@entities/board";
import { Button, Dialog, Input } from "@shared/ui";
import { cn } from "@shared/lib";

import styles from "./BoardsList.module.css";

/**
 * `BoardsList` — entry-page widget.
 *
 * Owns the four canonical async-UI states:
 * 1. **loading** — three skeleton cards (3 is the design-discovery
 *    figure for "enough to fill the visual rhythm without lying about
 *    likely count").
 * 2. **error** — inline error panel with the `AppError` message and a
 *    retry button. Toast region is deferred to E2.5+ (per Maria's a11y
 *    findings §4 — `aria-live` toasts arrive with the welcome-flow
 *    widget, this widget surfaces errors inline so the user sees them
 *    even without a live-region wired in).
 * 3. **empty** — friendly headline + CTA pointing the user at the
 *    new-board dialog.
 * 4. **populated** — CSS-grid of `BoardCard`s, plus a header bar with a
 *    "New board" button.
 *
 * The new-board dialog hardcodes the space dropdown to a single
 * "default" option. Olga's E1 migration seeds a default Space; the
 * full Space-picker arrives with the Spaces entity slice (E2.4) and
 * will replace the hardcoded `<select>` here.
 */
export function BoardsList(): ReactElement {
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
                // Selection wiring lands in E2.5 (peek panel widget).
                // For now just log — kept here so the contract is
                // visible at the call-site for the next agent.
                // eslint-disable-next-line no-console
                console.info("[boards-list] select board:", id);
              }}
            />
          ))}
        </div>
      )}

      {isDialogOpen ? (
        <NewBoardDialog
          onClose={() => setIsDialogOpen(false)}
        />
      ) : null}
    </section>
  );
}

interface NewBoardDialogProps {
  onClose: () => void;
}

/**
 * Internal: new-board dialog. Lives in the same widget file because it
 * is single-use and not exported. If a second board-create entrypoint
 * appears (e.g. Spaces sidebar context-menu) we'll lift this into
 * `widgets/board-manager/` per design-discovery §3.4.
 */
function NewBoardDialog({ onClose }: NewBoardDialogProps): ReactElement {
  const [name, setName] = useState("");
  const [spaceId, setSpaceId] = useState("default");
  const [submitError, setSubmitError] = useState<string | null>(null);
  const mutation = useCreateBoardMutation();

  const handleSubmit = (e: FormEvent<HTMLFormElement>): void => {
    e.preventDefault();
    if (!name.trim()) {
      setSubmitError("Name is required.");
      return;
    }
    setSubmitError(null);
    mutation.mutate(
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

        <label className={styles.selectField}>
          <span className={styles.selectLabel}>Space</span>
          <select
            className={styles.select}
            value={spaceId}
            onChange={(e) => setSpaceId(e.target.value)}
          >
            {/* Hardcoded for E2.3. Real space-picker lands with the
             * Spaces entity slice (E2.4) per design-discovery §3.4. */}
            <option value="default">default</option>
          </select>
        </label>

        {submitError && name.trim() ? (
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
            isPending={mutation.isPending}
          >
            Create board
          </Button>
        </div>
      </form>
    </Dialog>
  );
}
