import { useState, type ReactElement } from "react";
import { Plus, ChevronRight, ChevronLeft } from "lucide-react";

import { RoleCard, useRoles } from "@entities/role";
import { PromptCard, usePrompts } from "@entities/prompt";
import { Button, Icon, EmptyState } from "@shared/ui";
import { cn } from "@shared/lib";
import { RoleEditor } from "@widgets/role-editor";
import { RoleCreateDialog } from "@widgets/role-create-dialog";
import {
  PromptAttachmentBoundary,
  DraggablePromptRow,
  PromptDropZoneRoleCard,
} from "@features/prompt-attachment";

import styles from "./RolesList.module.css";

export interface RolesListProps {
  /** Called when the user activates a role card. */
  onSelectRole?: (roleId: string) => void;
}

/**
 * `RolesList` — widget that renders all roles.
 *
 * Async-UI states:
 *   1. loading — three skeleton cards.
 *   2. error — inline error panel + retry.
 *   3. empty — friendly headline + CTA.
 *   4. populated — CSS-grid of `PromptDropZoneRoleCard`s.
 *
 * Prompt-attachment side panel:
 *   A collapsible "Промпты" panel (280px wide) on the right lists all
 *   prompts as draggable rows. The user drags one onto a RoleCard to
 *   attach it. The DnD boundary wraps both the role grid and the prompt
 *   panel so drags can cross between them.
 */
export function RolesList({ onSelectRole }: RolesListProps = {}): ReactElement {
  const [selectedRoleId, setSelectedRoleId] = useState<string | null>(null);
  const [isCreateOpen, setIsCreateOpen] = useState(false);
  const [isPanelOpen, setIsPanelOpen] = useState(false);
  const rolesQuery = useRoles();
  const promptsQuery = usePrompts();

  const prompts = promptsQuery.data ?? [];

  return (
    <section className={styles.root} aria-labelledby="roles-list-heading">
      <header className={styles.header}>
        <div className={styles.headingGroup}>
          <Icon
            name="agent-roles"
            size={20}
            className={styles.headingIcon}
            aria-hidden="true"
          />
          <div className={styles.headingText}>
            <h2 id="roles-list-heading" className={styles.heading}>
              Agent roles
            </h2>
            <p className={styles.description}>
              Personas your AI agents adopt for a task.
            </p>
          </div>
        </div>
        <div className={styles.headerActions}>
          <Button
            variant="ghost"
            size="md"
            onPress={() => setIsPanelOpen((v) => !v)}
            aria-expanded={isPanelOpen}
            aria-controls="roles-prompt-side-panel"
            data-testid="roles-list-prompts-toggle"
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
            data-testid="roles-list-create-button"
          >
            <span className={styles.btnLabel}>
              <Plus size={14} aria-hidden="true" />
              + Create role
            </span>
          </Button>
        </div>
      </header>

      <PromptAttachmentBoundary>
        <div className={cn(styles.layout)}>
          <div className={styles.rolesArea}>
            {rolesQuery.status === "pending" ? (
              <div className={styles.grid} data-testid="roles-list-loading">
                <RoleCard isPending />
                <RoleCard isPending />
                <RoleCard isPending />
              </div>
            ) : rolesQuery.status === "error" ? (
              <div className={styles.error} role="alert">
                <p className={styles.errorMessage}>
                  Не удалось загрузить роли: {rolesQuery.error.message}
                </p>
                <Button
                  variant="secondary"
                  size="sm"
                  onPress={() => {
                    void rolesQuery.refetch();
                  }}
                >
                  Повторить
                </Button>
              </div>
            ) : rolesQuery.data.length === 0 ? (
              <div className={styles.empty} data-testid="roles-list-empty">
                <EmptyState
                  iconName="agent-roles"
                  title="No agent roles yet"
                  description="Personas your AI agents adopt for tasks."
                  action={
                    <Button
                      variant="primary"
                      size="md"
                      onPress={() => setIsCreateOpen(true)}
                    >
                      <span className={styles.btnLabel}>
                        <Plus size={14} aria-hidden="true" />
                        + Create role
                      </span>
                    </Button>
                  }
                />
              </div>
            ) : (
              <div className={styles.grid} data-testid="roles-list-grid">
                {rolesQuery.data.map((role) => (
                  <PromptDropZoneRoleCard
                    key={role.id}
                    roleId={role.id}
                    role={role}
                    onSelect={(id) => {
                      setSelectedRoleId(id);
                      onSelectRole?.(id);
                    }}
                  />
                ))}
              </div>
            )}
          </div>

          {isPanelOpen && (
            <aside
              id="roles-prompt-side-panel"
              className={styles.promptPanel}
              aria-label="Промпты для перетаскивания"
            >
              <p className={styles.panelHeading}>Промпты</p>
              <p className={styles.panelHint}>
                Перетащите промпт на роль, чтобы прикрепить его.
              </p>
              {promptsQuery.status === "pending" ? (
                <div className={styles.panelList} data-testid="roles-prompt-panel-loading">
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
                <ul className={styles.panelList} data-testid="roles-prompt-panel-list">
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

      <RoleEditor
        roleId={selectedRoleId}
        onClose={() => setSelectedRoleId(null)}
      />

      <RoleCreateDialog
        isOpen={isCreateOpen}
        onClose={() => setIsCreateOpen(false)}
      />
    </section>
  );
}
