import { useState, type ReactElement } from "react";
import { Plus } from "lucide-react";

import { PromptCard, usePrompts } from "@entities/prompt";
import { Button } from "@shared/ui";
import { PromptEditor } from "@widgets/prompt-editor";
import { PromptCreateDialog } from "@widgets/prompt-create-dialog";

import styles from "./PromptsList.module.css";

export interface PromptsListProps {
  /** Called when the user activates a prompt card. */
  onSelectPrompt?: (id: string) => void;
}

/**
 * `PromptsList` — prompts entry-page widget.
 *
 * Async-UI states:
 *   1. loading — three skeleton cards.
 *   2. error   — inline error panel + retry.
 *   3. empty   — friendly headline + hint.
 *   4. populated — CSS-grid of `PromptCard`s.
 */
export function PromptsList({ onSelectPrompt }: PromptsListProps = {}): ReactElement {
  const [selectedPromptId, setSelectedPromptId] = useState<string | null>(null);
  const [isCreateOpen, setIsCreateOpen] = useState(false);
  const promptsQuery = usePrompts();

  return (
    <section className={styles.root} aria-labelledby="prompts-list-heading">
      <header className={styles.header}>
        <h2 id="prompts-list-heading" className={styles.heading}>
          Промпты
        </h2>
        <Button
          variant="primary"
          size="md"
          onPress={() => setIsCreateOpen(true)}
          data-testid="prompts-list-create-button"
        >
          <span className={styles.btnLabel}>
            <Plus size={14} aria-hidden="true" />
            Создать промпт
          </span>
        </Button>
      </header>

      {promptsQuery.status === "pending" ? (
        <div className={styles.grid} data-testid="prompts-list-loading">
          <PromptCard isPending />
          <PromptCard isPending />
          <PromptCard isPending />
        </div>
      ) : promptsQuery.status === "error" ? (
        <div className={styles.error} role="alert">
          <p className={styles.errorMessage}>
            Не удалось загрузить промпты: {promptsQuery.error.message}
          </p>
          <Button
            variant="secondary"
            size="sm"
            onPress={() => {
              void promptsQuery.refetch();
            }}
          >
            Повторить
          </Button>
        </div>
      ) : promptsQuery.data.length === 0 ? (
        <div className={styles.empty} data-testid="prompts-list-empty">
          <p className={styles.emptyTitle}>Нет промптов</p>
          <p className={styles.emptyHint}>
            Импортируйте снимок Promptery или создайте первый промпт.
          </p>
        </div>
      ) : (
        <div className={styles.grid} data-testid="prompts-list-grid">
          {promptsQuery.data.map((prompt) => (
            <PromptCard
              key={prompt.id}
              prompt={prompt}
              onSelect={(id) => {
                setSelectedPromptId(id);
                onSelectPrompt?.(id);
              }}
            />
          ))}
        </div>
      )}

      <PromptEditor
        promptId={selectedPromptId}
        onClose={() => setSelectedPromptId(null)}
      />

      <PromptCreateDialog
        isOpen={isCreateOpen}
        onClose={() => setIsCreateOpen(false)}
      />
    </section>
  );
}
