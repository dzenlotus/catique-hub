import { useState } from "react";
import type { ReactElement } from "react";
import { useLocation } from "wouter";
import { PixelInterfaceEssentialPencilEdit1 } from "@shared/ui/Icon";

import { BoardCard, useBoards } from "@entities/board";
import { useSpaces } from "@entities/space";
import { Button, EmptyState, Scrollable } from "@shared/ui";
import { PixelPetAnimalsCat, PixelCodingAppsWebsitesModule } from "@shared/ui/Icon";
import { useActiveSpace } from "@app/providers/ActiveSpaceProvider";
import { boardSettingsPath } from "@app/routes";
import { BoardCreateDialog } from "@widgets/board-create-dialog";
import { SpaceCreateDialog } from "@widgets/space-create-dialog";

import styles from "./BoardsList.module.css";

interface BoardsListProps {
  /** Called when the user activates a board card. */
  onSelectBoard?: (boardId: string) => void;
}

/**
 * `BoardsList` — entry-page widget.
 *
 * Async-UI states:
 *   1. loading — three skeleton cards.
 *   2. error — inline error panel + retry.
 *   3. empty — friendly headline + CTA pointing at the new-board dialog.
 *   4. populated — CSS-grid of `BoardCard`s.
 *
 * NOTE: Prompt-attach drag-and-drop was removed when the widget was
 * migrated off `@dnd-kit/core` (the new `@dnd-kit/react` migration only
 * covers the kanban). The prompt panel can be re-introduced as a
 * follow-up using the new API.
 */
export function BoardsList({ onSelectBoard }: BoardsListProps = {}): ReactElement {
  const { activeSpaceId } = useActiveSpace();
  const boardsQuery = useBoards();
  const spacesQuery = useSpaces();
  const [, setLocation] = useLocation();
  const [isCreateOpen, setIsCreateOpen] = useState(false);
  const [isSpaceCreateOpen, setIsSpaceCreateOpen] = useState(false);

  const hasNoSpaces =
    spacesQuery.status === "success" && spacesQuery.data.length === 0;

  const filteredBoards =
    boardsQuery.status === "success"
      ? activeSpaceId === null
        ? boardsQuery.data
        : boardsQuery.data.filter((b) => b.spaceId === activeSpaceId)
      : [];

  return (
    <Scrollable
      axis="y"
      className={styles.scrollHost}
      data-testid="boards-list-scroll"
    >
    <section className={styles.root} aria-labelledby="boards-list-heading">
      <header className={styles.header}>
        <h2 id="boards-list-heading" className={styles.heading}>
          Boards
        </h2>
        <div className={styles.headerActions}>
          <Button
            variant="primary"
            size="md"
            onPress={() => setIsCreateOpen(true)}
            data-testid="boards-list-create-button"
          >
            Create board
          </Button>
        </div>
      </header>

      <div className={styles.layout}>
        <div className={styles.boardsArea}>
          {boardsQuery.status === "pending" ? (
            <div className={styles.grid} data-testid="boards-list-loading">
              <BoardCard isPending />
              <BoardCard isPending />
              <BoardCard isPending />
            </div>
          ) : boardsQuery.status === "error" ? (
            <div className={styles.error} role="alert">
              <p className={styles.errorMessage}>
                Failed to load boards: {boardsQuery.error.message}
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
          ) : filteredBoards.length === 0 ? (
            <div className={styles.empty} data-testid="boards-list-empty">
              {hasNoSpaces ? (
                <EmptyState
                  icon={<PixelPetAnimalsCat width={64} height={64} />}
                  title="No spaces yet"
                  description="Create your first space to start organising boards."
                  action={
                    <Button
                      variant="primary"
                      size="md"
                      onPress={() => setIsSpaceCreateOpen(true)}
                      data-testid="boards-list-create-space-button"
                    >
                      Create space
                    </Button>
                  }
                />
              ) : (
                <EmptyState
                  icon={<PixelCodingAppsWebsitesModule width={64} height={64} />}
                  title="No boards yet"
                  description="Create your first board to start organising tasks."
                  action={
                    <Button
                      variant="primary"
                      size="md"
                      onPress={() => setIsCreateOpen(true)}
                    >
                      Create board
                    </Button>
                  }
                />
              )}
            </div>
          ) : (
            <div className={styles.grid} data-testid="boards-list-grid">
              {filteredBoards.map((board) => (
                <div key={board.id} className={styles.cardWrapper}>
                  <BoardCard
                    board={board}
                    onSelect={(id) => {
                      if (onSelectBoard) {
                        onSelectBoard(id);
                        return;
                      }
                      // eslint-disable-next-line no-console
                      console.info("[boards-list] select board:", id);
                    }}
                  />
                  {/* Audit-#22: shared `<Button variant="ghost">`
                      replaces a raw `<button>` so all CTAs in this
                      widget run through the design-system primitive. */}
                  <Button
                    variant="ghost"
                    size="sm"
                    aria-label="Edit board"
                    className={styles.editButton}
                    onPress={() => setLocation(boardSettingsPath(board.id))}
                    data-testid={`boards-list-edit-${board.id}`}
                  >
                    <PixelInterfaceEssentialPencilEdit1 width={14} height={14} aria-hidden="true" />
                  </Button>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      <BoardCreateDialog
        isOpen={isCreateOpen}
        onClose={() => setIsCreateOpen(false)}
      />

      <SpaceCreateDialog
        isOpen={isSpaceCreateOpen}
        onClose={() => setIsSpaceCreateOpen(false)}
      />

    </section>
    </Scrollable>
  );
}
