import { useState, useMemo, type ReactElement } from "react";
import { PromptCard, usePrompts, usePromptTagsMap } from "@entities/prompt";
import { Button, EmptyState } from "@shared/ui";
import { PixelInterfaceEssentialMessage } from "@shared/ui/Icon";
import { jsonCodec, useLocalStorage } from "@shared/storage";
import { PromptEditor } from "@widgets/prompt-editor";
import { PromptCreateDialog } from "@widgets/prompt-create-dialog";
import { PromptsTagFilter } from "@widgets/prompts-tag-filter";

import styles from "./PromptsList.module.css";

// Round-19e: storage shape changed from a single tag id (string) to a
// list (string[]) so the grid filter is multi-select. Bumping the key
// avoids reading a stale single-id payload from older versions.
const ACTIVE_TAG_IDS_STORAGE_KEY = "catique:prompts:active-tag-ids";
const tagIdsCodec = jsonCodec<string[]>();

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
  // Persisted via @shared/storage — list of selected tag ids.
  const [activeTagIds, setActiveTagIds] = useLocalStorage<string[]>(
    ACTIVE_TAG_IDS_STORAGE_KEY,
    tagIdsCodec,
    [],
  );

  const promptsQuery = usePrompts();
  const tagMapQuery = usePromptTagsMap();

  // Filter: prompts that carry EVERY selected tag (intersection). Mirrors
  // the sidebar's TagsFilterButton semantics so the two surfaces match.
  const filteredPrompts = useMemo(() => {
    const allPrompts = promptsQuery.data ?? [];
    if (activeTagIds.length === 0) return allPrompts;
    const tagMap = tagMapQuery.data ?? [];
    const promptToTags = new Map<string, Set<string>>();
    for (const entry of tagMap) {
      promptToTags.set(entry.promptId, new Set(entry.tagIds));
    }
    return allPrompts.filter((p) => {
      const tagSet = promptToTags.get(p.id);
      if (!tagSet) return false;
      return activeTagIds.every((id) => tagSet.has(id));
    });
  }, [promptsQuery.data, tagMapQuery.data, activeTagIds]);

  // Whether the filter produced an empty result for a non-empty prompt list.
  const isFilterEmpty =
    activeTagIds.length > 0 &&
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
            variant="primary"
            size="md"
            onPress={() => setIsCreateOpen(true)}
            data-testid="prompts-list-create-button"
          >
            Create prompt
          </Button>
        </div>
      </header>

      {/* Tag filter row — multi-select. */}
      <PromptsTagFilter
        selectedTagIds={activeTagIds}
        onChange={(next) => setActiveTagIds([...next])}
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
                onPress={() => setActiveTagIds([])}
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
                Create prompt
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

    </section>
  );
}
