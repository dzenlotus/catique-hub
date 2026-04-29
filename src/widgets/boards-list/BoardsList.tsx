import { useState } from "react";
import type { ReactElement } from "react";
import { Plus, Pencil, ChevronRight, ChevronLeft } from "lucide-react";

import { BoardCard, useBoards } from "@entities/board";
import { PromptCard, usePrompts } from "@entities/prompt";
import { useSpaces } from "@entities/space";
import { Button, EmptyState } from "@shared/ui";
import { cn } from "@shared/lib";
import { useActiveSpace } from "@app/providers/ActiveSpaceProvider";
import { BoardCreateDialog } from "@widgets/board-create-dialog";
import { BoardEditor } from "@widgets/board-editor";
import { SpaceCreateDialog } from "@widgets/space-create-dialog";
import {
  PromptAttachmentBoundary,
  DraggablePromptRow,
  PromptDropZoneBoardCard,
} from "@features/prompt-attachment";

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
 *
 * Prompt-attachment side panel:
 *   A collapsible "Промпты" panel (280px wide) on the right lists all
 *   prompts as draggable rows. The user drags one onto a BoardCard to
 *   attach it. The DnD boundary is mounted here, wrapping both the
 *   board grid and the prompt panel so drags can cross between them.
 */
export function BoardsList({ onSelectBoard }: BoardsListProps = {}): ReactElement {
  const { activeSpaceId } = useActiveSpace();
  const boardsQuery = useBoards();
  const spacesQuery = useSpaces();
  const promptsQuery = usePrompts();
  const [isCreateOpen, setIsCreateOpen] = useState(false);
  const [isSpaceCreateOpen, setIsSpaceCreateOpen] = useState(false);
  const [editingBoardId, setEditingBoardId] = useState<string | null>(null);
  const [isPanelOpen, setIsPanelOpen] = useState(false);

  // True when spaces have loaded and the workspace is completely empty.
  const hasNoSpaces =
    spacesQuery.status === "success" && spacesQuery.data.length === 0;

  // Derive space-filtered boards at the widget layer (entity hook stays
  // workspace-wide per architecture). When activeSpaceId is null (provider
  // hasn't resolved yet — transient on first mount) fall back to all boards.
  const filteredBoards =
    boardsQuery.status === "success"
      ? activeSpaceId === null
        ? boardsQuery.data
        : boardsQuery.data.filter((b) => b.spaceId === activeSpaceId)
      : [];

  const prompts = promptsQuery.data ?? [];

  return (
    <section className={styles.root} aria-labelledby="boards-list-heading">
      <header className={styles.header}>
        <h2 id="boards-list-heading" className={styles.heading}>
          Доски
        </h2>
        <div className={styles.headerActions}>
          <Button
            variant="ghost"
            size="md"
            onPress={() => setIsPanelOpen((v) => !v)}
            aria-expanded={isPanelOpen}
            aria-controls="prompt-side-panel"
            data-testid="boards-list-prompts-toggle"
          >
            <span className={styles.btnLabel}>
              {isPanelOpen ? (
                <ChevronRight size={14} aria-hidden="true" />
              ) : (
                <ChevronLeft size={14} aria-hidden="true" />
              )}
              Промпты
            </span>
          </Button>
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
        </div>
      </header>

      <PromptAttachmentBoundary>
        <div className={cn(styles.layout, isPanelOpen && styles.layoutWithPanel)}>
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
                    iconName="catique"
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
                          <Plus size={16} aria-hidden="true" />
                          + Create space
                        </span>
                      </Button>
                    }
                  />
                ) : (
                  <EmptyState
                    iconName="boards"
                    title="No boards yet"
                    description="Create your first board to start organising tasks."
                    action={
                      <Button
                        variant="primary"
                        size="md"
                        onPress={() => setIsCreateOpen(true)}
                      >
                        <span className={styles.btnLabel}>
                          <Plus size={16} aria-hidden="true" />
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
                    <PromptDropZoneBoardCard
                      boardId={board.id}
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
          </div>

          {isPanelOpen && (
            <aside
              id="prompt-side-panel"
              className={styles.promptPanel}
              aria-label="Промпты для перетаскивания"
            >
              <p className={styles.panelHeading}>Промпты</p>
              <p className={styles.panelHint}>
                Перетащите промпт на доску, чтобы прикрепить его.
              </p>
              {promptsQuery.status === "pending" ? (
                <div className={styles.panelList} data-testid="prompt-panel-loading">
                  {[0, 1, 2].map((i) => (
                    <PromptCard key={i} isPending />
                  ))}
                </div>
              ) : promptsQuery.status === "error" ? (
                <p className={styles.panelError}>
                  Не удалось загрузить промпты
                </p>
              ) : prompts.length === 0 ? (
                <p className={styles.panelEmpty}>Промптов пока нет</p>
              ) : (
                <ul className={styles.panelList} data-testid="prompt-panel-list">
                  {prompts.map((prompt) => (
                    <li key={prompt.id} className={styles.panelItem}>
                      <DraggablePromptRow promptId={prompt.id}>
                        <PromptCard prompt={prompt} />
                      </DraggablePromptRow>
                    </li>
                  ))}
                </ul>
              )}
            </aside>
          )}
        </div>
      </PromptAttachmentBoundary>

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
