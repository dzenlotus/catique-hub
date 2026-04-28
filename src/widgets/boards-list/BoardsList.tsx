import { useState } from "react";
import type { ReactElement } from "react";
import { Plus, Pencil } from "lucide-react";

import { BoardCard, useBoards } from "@entities/board";
import { Button } from "@shared/ui";
import { BoardCreateDialog } from "@widgets/board-create-dialog";
import { BoardEditor } from "@widgets/board-editor";

import styles from "./BoardsList.module.css";

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
 *   4. populated — CSS-grid of `BoardCard`s.
 */
export function BoardsList({ onSelectBoard }: BoardsListProps = {}): ReactElement {
  const boardsQuery = useBoards();
  const [isCreateOpen, setIsCreateOpen] = useState(false);
  const [editingBoardId, setEditingBoardId] = useState<string | null>(null);

  return (
    <section className={styles.root} aria-labelledby="boards-list-heading">
      <header className={styles.header}>
        <h2 id="boards-list-heading" className={styles.heading}>
          Доски
        </h2>
        <Button
          variant="primary"
          size="md"
          onPress={() => setIsCreateOpen(true)}
          data-testid="boards-list-create-button"
        >
          <span className={styles.btnLabel}>
            <Plus size={14} aria-hidden="true" />
            Создать доску
          </span>
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
      ) : boardsQuery.data.length === 0 ? (
        <div className={styles.empty} data-testid="boards-list-empty">
          <p className={styles.emptyTitle}>Нет досок</p>
          <p className={styles.emptyHint}>
            Создайте первую доску, чтобы начать организацию задач.
          </p>
          <Button
            variant="primary"
            size="md"
            onPress={() => setIsCreateOpen(true)}
          >
            <span className={styles.btnLabel}>
              <Plus size={16} aria-hidden="true" />
              Создать первую доску
            </span>
          </Button>
        </div>
      ) : (
        <div className={styles.grid} data-testid="boards-list-grid">
          {boardsQuery.data.map((board) => (
            <div key={board.id} className={styles.cardWrapper}>
              <BoardCard
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
              <button
                type="button"
                className={styles.editButton}
                aria-label="Редактировать доску"
                onClick={(e) => {
                  e.stopPropagation();
                  setEditingBoardId(board.id);
                }}
              >
                <Pencil size={14} aria-hidden="true" />
              </button>
            </div>
          ))}
        </div>
      )}

      <BoardCreateDialog
        isOpen={isCreateOpen}
        onClose={() => setIsCreateOpen(false)}
      />

      <BoardEditor
        boardId={editingBoardId}
        onClose={() => setEditingBoardId(null)}
      />
    </section>
  );
}
