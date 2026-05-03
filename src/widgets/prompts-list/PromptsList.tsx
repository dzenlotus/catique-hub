import { useState, useMemo, type ReactElement } from "react";
import {
  PixelInterfaceEssentialClip1,
  PixelInterfaceEssentialPlus,
} from "@shared/ui/Icon";

import { PromptCard, usePrompts, usePromptTagsMap } from "@entities/prompt";
import { Button, EmptyState } from "@shared/ui";
import { PixelInterfaceEssentialMessage } from "@shared/ui/Icon";
import { stringCodec, useLocalStorage } from "@shared/storage";
import { PromptEditor } from "@widgets/prompt-editor";
import { PromptCreateDialog } from "@widgets/prompt-create-dialog";
import { AttachPromptDialog } from "@widgets/attach-prompt-dialog";
import { PromptsTagFilter } from "@widgets/prompts-tag-filter";

import styles from "./PromptsList.module.css";

const ACTIVE_TAG_STORAGE_KEY = "catique:prompts:active-tag";

export interface PromptsListProps {
  /** Called when the user activates a prompt card. */
  onSelectPrompt?: (id: string) => void;
  /**
   * When provided, the parent owns the editor open/close state and
   * `<PromptsList>` will NOT mount its own `<PromptEditor>`. Used by
   * `<PromptsPage>` (round-19c) where one editor instance is shared
   * between the sidebar and the grid.
   */
  externallyManagedEditor?: boolean;
}

/**
 * `PromptsList` — prompts entry-page widget.
 *
 * Async-UI states:
 *   1. loading — three skeleton cards.
 *   2. error   — inline error panel + retry.
 *   3. empty   — friendly headline + hint.
 *   4. populated — CSS-grid of `PromptCard`s.
 *
 * A `PromptsTagFilter` row between the header and the grid lets the user
 * filter the list by attached tag (client-side, via `usePromptTagsMap`).
 */
export function PromptsList({
  onSelectPrompt,
  externallyManagedEditor = false,
}: PromptsListProps = {}): ReactElement {
  const [selectedPromptId, setSelectedPromptId] = useState<string | null>(null);
  const [isCreateOpen, setIsCreateOpen] = useState(false);
  const [isAttachOpen, setIsAttachOpen] = useState(false);
  // Persisted via @shared/storage — the hook handles restricted-environment
  // fallback and cross-tab sync.
  const [activeTagId, setActiveTagIdRaw, clearActiveTagId] = useLocalStorage(
    ACTIVE_TAG_STORAGE_KEY,
    stringCodec,
  );

  const setActiveTagId = (next: string | null): void => {
    if (next === null) {
      clearActiveTagId();
    } else {
      setActiveTagIdRaw(next);
    }
  };

  const promptsQuery = usePrompts();
  const tagMapQuery = usePromptTagsMap();

  // Derive the filtered prompt list from the full list + tag-map.
  const filteredPrompts = useMemo(() => {
    const allPrompts = promptsQuery.data ?? [];
    if (activeTagId === null) return allPrompts;
    const tagMap = tagMapQuery.data ?? [];
    const taggedPromptIds = new Set(
      tagMap
        .filter((entry) => entry.tagIds.includes(activeTagId))
        .map((entry) => entry.promptId),
    );
    return allPrompts.filter((p) => taggedPromptIds.has(p.id));
  }, [promptsQuery.data, tagMapQuery.data, activeTagId]);

  // Whether the filter produced an empty result for a non-empty prompt list.
  const isFilterEmpty =
    activeTagId !== null &&
    filteredPrompts.length === 0 &&
    (promptsQuery.data?.length ?? 0) > 0;

  return (
    <section className={styles.root} aria-labelledby="prompts-list-heading">
      <header className={styles.header}>
        <div className={styles.headingGroup}>
          <PixelInterfaceEssentialMessage
            width={20}
            height={20}
            className={styles.headingIcon}
            aria-hidden={true}
          />
          <div className={styles.headingText}>
            <h2 id="prompts-list-heading" className={styles.heading}>
              Prompts
            </h2>
            <p className={styles.description}>
              Reusable agent prompts inheriting through space → board → column → task.
            </p>
          </div>
        </div>
        <div className={styles.headerActions}>
          <Button
            variant="secondary"
            size="md"
            onPress={() => setIsAttachOpen(true)}
            data-testid="prompts-list-attach-button"
          >
            <span className={styles.btnLabel}>
              <PixelInterfaceEssentialClip1 width={14} height={14} aria-hidden="true" />
              Attach prompt
            </span>
          </Button>
          <Button
            variant="primary"
            size="md"
            onPress={() => setIsCreateOpen(true)}
            data-testid="prompts-list-create-button"
          >
            <span className={styles.btnLabel}>
              <PixelInterfaceEssentialPlus width={12} height={12} aria-hidden="true" />
              Create prompt
            </span>
          </Button>
        </div>
      </header>

      {/* Tag filter row — shown when tags are available or loading */}
      <PromptsTagFilter
        selectedTagId={activeTagId}
        onChange={setActiveTagId}
      />

      {promptsQuery.status === "pending" ? (
        <div className={styles.grid} data-testid="prompts-list-loading">
          <PromptCard isPending />
          <PromptCard isPending />
          <PromptCard isPending />
        </div>
      ) : promptsQuery.status === "error" ? (
        <div className={styles.error} role="alert">
          <p className={styles.errorMessage}>
            Failed to load prompts: {promptsQuery.error.message}
          </p>
          <Button
            variant="secondary"
            size="sm"
            onPress={() => {
              void promptsQuery.refetch();
            }}
          >
            Retry
          </Button>
        </div>
      ) : isFilterEmpty ? (
        <div className={styles.empty} data-testid="prompts-list-filter-empty">
          <EmptyState
            icon={<PixelInterfaceEssentialMessage width={64} height={64} />}
            title="No prompts match the filter"
            description="Try a different tag or clear the filter."
            action={
              <Button
                variant="secondary"
                size="md"
                onPress={() => setActiveTagId(null)}
              >
                Clear filter
              </Button>
            }
          />
        </div>
      ) : promptsQuery.data.length === 0 ? (
        <div className={styles.empty} data-testid="prompts-list-empty">
          <EmptyState
            icon={<PixelInterfaceEssentialMessage width={64} height={64} />}
            title="No prompts yet"
            description="Reusable agent prompts will appear here."
            action={
              <Button
                variant="primary"
                size="md"
                onPress={() => setIsCreateOpen(true)}
              >
                {/*
                 * Ctq-76 item 8: drop the duplicate "+ +" prefix and use
                 * the pixel "+" icon instead of two stacked text
                 * markers. One icon, one label.
                 */}
                <span className={styles.btnLabel}>
                  <PixelInterfaceEssentialPlus width={12} height={12} aria-hidden="true" />
                  Create prompt
                </span>
              </Button>
            }
          />
        </div>
      ) : (
        <div className={styles.grid} data-testid="prompts-list-grid">
          {filteredPrompts.map((prompt) => (
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

      {externallyManagedEditor ? null : (
        <PromptEditor
          promptId={selectedPromptId}
          onClose={() => setSelectedPromptId(null)}
        />
      )}

      <PromptCreateDialog
        isOpen={isCreateOpen}
        onClose={() => setIsCreateOpen(false)}
      />

      <AttachPromptDialog
        isOpen={isAttachOpen}
        onClose={() => setIsAttachOpen(false)}
      />
    </section>
  );
}
