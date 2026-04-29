import { useState, type ReactElement } from "react";
import { Plus } from "lucide-react";

import { TagChip, useTags } from "@entities/tag";
import { Button, Icon, EmptyState } from "@shared/ui";
import { cn } from "@shared/lib";
import { TagEditor } from "@widgets/tag-editor";
import { TagCreateDialog } from "@widgets/tag-create-dialog";

import styles from "./TagsList.module.css";

interface TagsListProps {
  /** Called when the user activates a tag chip. */
  onSelectTag?: (id: string) => void;
  /**
   * When set to `"kind"`, chips are grouped under section headers by
   * their `kind` value. The current binding has no `kind` field so this
   * option is accepted but renders a single unlabelled group (future-
   * proof hook for when `kind` lands in the binding).
   */
  groupBy?: "kind";
  /** Optional class merged onto the root element. */
  className?: string;
}

/**
 * `TagsList` — widget that renders all tags as an inline wrapping row
 * of `TagChip` pills.
 *
 * Async-UI states:
 *   1. loading — three skeleton chips.
 *   2. error — inline error panel.
 *   3. empty — friendly hint.
 *   4. populated — flex-wrap row of `TagChip`s.
 *
 * A "Создать тег" header button is always visible regardless of state.
 */
export function TagsList({
  onSelectTag,
  groupBy,
  className,
}: TagsListProps = {}): ReactElement {
  const [selectedTagId, setSelectedTagId] = useState<string | null>(null);
  const [isCreateOpen, setIsCreateOpen] = useState(false);
  const tagsQuery = useTags();

  const header = (
    <header className={styles.header}>
      <div className={styles.headingGroup}>
        <Icon
          name="tag"
          size={20}
          className={styles.headingIcon}
          aria-hidden="true"
        />
        <div className={styles.headingText}>
          <h2 id="tags-list-heading" className={styles.heading}>
            Tags
          </h2>
          <p className={styles.description}>
            Labels for organising prompts and tasks.
          </p>
        </div>
      </div>
      <div className={styles.headerActions}>
        <Button
          variant="primary"
          size="md"
          onPress={() => setIsCreateOpen(true)}
          data-testid="tags-list-create-button"
        >
          <span className={styles.btnLabel}>
            <Plus size={14} aria-hidden="true" />
            + Create tag
          </span>
        </Button>
      </div>
    </header>
  );

  if (tagsQuery.status === "pending") {
    return (
      <section
        className={cn(styles.root, className)}
        aria-labelledby="tags-list-heading"
        data-testid="tags-list-loading"
        aria-busy="true"
      >
        {header}
        <div className={styles.chips}>
          <TagChip isPending />
          <TagChip isPending />
          <TagChip isPending />
        </div>
      </section>
    );
  }

  if (tagsQuery.status === "error") {
    return (
      <section
        className={cn(styles.root, className)}
        aria-labelledby="tags-list-heading"
      >
        {header}
        <div className={styles.error} role="alert">
          <p className={styles.errorMessage}>
            Не удалось загрузить теги: {tagsQuery.error.message}
          </p>
        </div>
        <TagCreateDialog
          isOpen={isCreateOpen}
          onClose={() => setIsCreateOpen(false)}
        />
      </section>
    );
  }

  if (tagsQuery.data.length === 0) {
    return (
      <section
        className={cn(styles.root, className)}
        aria-labelledby="tags-list-heading"
        data-testid="tags-list-empty"
      >
        {header}
        <EmptyState
          iconName="tag"
          title="No tags yet"
          description="Labels for organising prompts and tasks."
          action={
            <Button
              variant="primary"
              size="md"
              onPress={() => setIsCreateOpen(true)}
            >
              <span className={styles.btnLabel}>
                <Plus size={14} aria-hidden="true" />
                + Create tag
              </span>
            </Button>
          }
        />
        <TagCreateDialog
          isOpen={isCreateOpen}
          onClose={() => setIsCreateOpen(false)}
        />
      </section>
    );
  }

  const handleSelectTag = (id: string): void => {
    setSelectedTagId(id);
    onSelectTag?.(id);
  };

  // groupBy="kind" — the current Tag binding has no `kind` field, so we
  // render a single flat group. When `kind` is added to the binding this
  // branch can be expanded.
  if (groupBy === "kind") {
    return (
      <section
        className={cn(styles.root, className)}
        aria-labelledby="tags-list-heading"
        data-testid="tags-list-chips"
      >
        {header}
        <div className={styles.chips}>
          {tagsQuery.data.map((tag) => (
            <TagChip
              key={tag.id}
              tag={tag}
              onSelect={handleSelectTag}
            />
          ))}
        </div>
        <TagEditor
          tagId={selectedTagId}
          onClose={() => setSelectedTagId(null)}
        />
        <TagCreateDialog
          isOpen={isCreateOpen}
          onClose={() => setIsCreateOpen(false)}
        />
      </section>
    );
  }

  return (
    <section
      className={cn(styles.root, className)}
      aria-labelledby="tags-list-heading"
      data-testid="tags-list-chips"
    >
      {header}
      <div className={styles.chips}>
        {tagsQuery.data.map((tag) => (
          <TagChip
            key={tag.id}
            tag={tag}
            onSelect={handleSelectTag}
          />
        ))}
      </div>
      <TagEditor
        tagId={selectedTagId}
        onClose={() => setSelectedTagId(null)}
      />
      <TagCreateDialog
        isOpen={isCreateOpen}
        onClose={() => setIsCreateOpen(false)}
      />
    </section>
  );
}
