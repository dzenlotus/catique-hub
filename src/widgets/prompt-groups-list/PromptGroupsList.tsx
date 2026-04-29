import { useState, type ReactElement } from "react";
import { Plus } from "lucide-react";

import { PromptGroupCard, usePromptGroups } from "@entities/prompt-group";
import { Button, Icon } from "@shared/ui";
import { PromptGroupEditor } from "@widgets/prompt-group-editor";
import { PromptGroupCreateDialog } from "@widgets/prompt-group-create-dialog";

import styles from "./PromptGroupsList.module.css";

export interface PromptGroupsListProps {
  /** Called when the user activates a group card. */
  onSelectGroup?: (groupId: string) => void;
}

/**
 * `PromptGroupsList` — widget that renders all prompt groups.
 *
 * Async-UI states:
 *   1. loading — three skeleton cards.
 *   2. error — inline error panel + retry.
 *   3. empty — friendly headline + CTA.
 *   4. populated — CSS-grid of `PromptGroupCard`s.
 */
export function PromptGroupsList({
  onSelectGroup,
}: PromptGroupsListProps = {}): ReactElement {
  const [selectedGroupId, setSelectedGroupId] = useState<string | null>(null);
  const [isCreateOpen, setIsCreateOpen] = useState(false);
  const groupsQuery = usePromptGroups();

  return (
    <section
      className={styles.root}
      aria-labelledby="prompt-groups-list-heading"
    >
      <header className={styles.header}>
        <div className={styles.headingGroup}>
          <Icon
            name="prompt-groups"
            size={20}
            className={styles.headingIcon}
            aria-hidden="true"
          />
          <div className={styles.headingText}>
            <h2 id="prompt-groups-list-heading" className={styles.heading}>
              Prompt groups
            </h2>
            <p className={styles.description}>
              Bundles of prompts attached as a unit.
            </p>
          </div>
        </div>
        <div className={styles.headerActions}>
          <Button
            variant="primary"
            size="md"
            onPress={() => setIsCreateOpen(true)}
            data-testid="prompt-groups-list-create-button"
          >
            <span className={styles.btnLabel}>
              <Plus size={14} aria-hidden="true" />
              + Create group
            </span>
          </Button>
        </div>
      </header>

      {groupsQuery.status === "pending" ? (
        <div className={styles.grid} data-testid="prompt-groups-list-loading">
          <PromptGroupCard isPending />
          <PromptGroupCard isPending />
          <PromptGroupCard isPending />
        </div>
      ) : groupsQuery.status === "error" ? (
        <div className={styles.error} role="alert">
          <p className={styles.errorMessage}>
            Не удалось загрузить группы: {groupsQuery.error.message}
          </p>
          <Button
            variant="secondary"
            size="sm"
            onPress={() => {
              void groupsQuery.refetch();
            }}
          >
            Повторить
          </Button>
        </div>
      ) : groupsQuery.data.length === 0 ? (
        <div className={styles.empty} data-testid="prompt-groups-list-empty">
          <p className={styles.emptyTitle}>Нет групп промптов</p>
          <p className={styles.emptyHint}>
            Создайте первую группу, чтобы упорядочить промпты.
          </p>
        </div>
      ) : (
        <div className={styles.grid} data-testid="prompt-groups-list-grid">
          {groupsQuery.data.map((group) => (
            <PromptGroupCard
              key={group.id}
              group={group}
              onSelect={(id) => {
                setSelectedGroupId(id);
                onSelectGroup?.(id);
              }}
            />
          ))}
        </div>
      )}

      <PromptGroupEditor
        groupId={selectedGroupId}
        onClose={() => setSelectedGroupId(null)}
      />

      <PromptGroupCreateDialog
        isOpen={isCreateOpen}
        onClose={() => setIsCreateOpen(false)}
      />
    </section>
  );
}
