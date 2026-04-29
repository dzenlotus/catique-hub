import { useState } from "react";
import type { ReactElement } from "react";
import { PixelInterfaceEssentialPencilEdit1 } from "@shared/ui/Icon";

import { BoardCard, useBoards } from "@entities/board";
import { useSpaces } from "@entities/space";
import { Button, EmptyState } from "@shared/ui";
import { PixelPetAnimalsCat, PixelCodingAppsWebsitesModule } from "@shared/ui/Icon";
import { useActiveSpace } from "@app/providers/ActiveSpaceProvider";
import { BoardCreateDialog } from "@widgets/board-create-dialog";
import { BoardEditor } from "@widgets/board-editor";
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
  const [isCreateOpen, setIsCreateOpen] = useState(false);
  const [isSpaceCreateOpen, setIsSpaceCreateOpen] = useState(false);
  const [editingBoardId, setEditingBoardId] = useState<string | null>(null);

  const hasNoSpaces =
    spacesQuery.status === "success" && spacesQuery.data.length === 0;

  const filteredBoards =
    boardsQuery.status === "success"
      ? activeSpaceId === null
        ? boardsQuery.data
        : boardsQuery.data.filter((b) => b.spaceId === activeSpaceId)
      : [];

  return (
    <section className={styles.root} aria-labelledby="boards-list-heading">
      <header className={styles.header}>
        <h2 id="boards-list-heading" className={styles.heading}>
          Доски
        </h2>
        <div className={styles.headerActions}>
          <Button
            variant="primary"
            size="md"
            onPress={() => setIsCreateOpen(true)}
            data-testid="boards-list-create-button"
          >
            <span className={styles.btnLabel}>
              <span aria-hidden="true">+</span>
              Создать доску
            </span>
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
                Не удалось загрузить доски: {boardsQuery.error.message}
              </p>
              <Button
                variant="secondary"
                size="sm"
                onPress={() => {
                  void boardsQuery.refetch();
                }}
              >
                Повторить
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
                      <span className={styles.btnLabel}>
                        <span aria-hidden="true">+</span>
                        + Create space
                      </span>
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
                      <span className={styles.btnLabel}>
                        <span aria-hidden="true">+</span>
                        + Create board
                      </span>
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
                  <button
                    type="button"
                    className={styles.editButton}
                    aria-label="Редактировать доску"
                    onClick={(e) => {
                      e.stopPropagation();
                      setEditingBoardId(board.id);
                    }}
                  >
                    <PixelInterfaceEssentialPencilEdit1 width={14} height={14} aria-hidden="true" />
                  </button>
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

      <BoardEditor
        boardId={editingBoardId}
        onClose={() => setEditingBoardId(null)}
      />
    </section>
  );
}
