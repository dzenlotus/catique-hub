import { useState, type ReactElement } from "react";
import { Plus } from "lucide-react";

import { SkillCard, useSkills } from "@entities/skill";
import { Button, Icon } from "@shared/ui";
import { SkillEditor } from "@widgets/skill-editor";
import { SkillCreateDialog } from "@widgets/skill-create-dialog";

import styles from "./SkillsList.module.css";

export interface SkillsListProps {
  /** Called when the user activates a skill card. */
  onSelectSkill?: (skillId: string) => void;
}

/**
 * `SkillsList` — widget that renders all skills.
 *
 * Async-UI states:
 *   1. loading — three skeleton cards.
 *   2. error — inline error panel + retry.
 *   3. empty — friendly headline + CTA.
 *   4. populated — CSS-grid of `SkillCard`s.
 */
export function SkillsList({ onSelectSkill }: SkillsListProps = {}): ReactElement {
  const [selectedSkillId, setSelectedSkillId] = useState<string | null>(null);
  const [isCreateOpen, setIsCreateOpen] = useState(false);
  const skillsQuery = useSkills();

  return (
    <section className={styles.root} aria-labelledby="skills-list-heading">
      <header className={styles.header}>
        <div className={styles.headingGroup}>
          <Icon
            name="skills"
            size={20}
            className={styles.headingIcon}
            aria-hidden="true"
          />
          <div className={styles.headingText}>
            <h2 id="skills-list-heading" className={styles.heading}>
              Skills
            </h2>
            <p className={styles.description}>
              Capabilities you grant to agents.
            </p>
          </div>
        </div>
        <div className={styles.headerActions}>
          <Button
            variant="primary"
            size="md"
            onPress={() => setIsCreateOpen(true)}
            data-testid="skills-list-create-button"
          >
            <span className={styles.btnLabel}>
              <Plus size={14} aria-hidden="true" />
              + Create skill
            </span>
          </Button>
        </div>
      </header>

      {skillsQuery.status === "pending" ? (
        <div className={styles.grid} data-testid="skills-list-loading">
          <SkillCard isPending />
          <SkillCard isPending />
          <SkillCard isPending />
        </div>
      ) : skillsQuery.status === "error" ? (
        <div className={styles.error} role="alert">
          <p className={styles.errorMessage}>
            Не удалось загрузить навыки: {skillsQuery.error.message}
          </p>
          <Button
            variant="secondary"
            size="sm"
            onPress={() => {
              void skillsQuery.refetch();
            }}
          >
            Повторить
          </Button>
        </div>
      ) : skillsQuery.data.length === 0 ? (
        <div className={styles.empty} data-testid="skills-list-empty">
          <p className={styles.emptyTitle}>Нет навыков</p>
          <p className={styles.emptyHint}>
            Создайте первый навык, чтобы описать компетенции команды.
          </p>
        </div>
      ) : (
        <div className={styles.grid} data-testid="skills-list-grid">
          {skillsQuery.data.map((skill) => (
            <SkillCard
              key={skill.id}
              skill={skill}
              onSelect={(id) => {
                setSelectedSkillId(id);
                onSelectSkill?.(id);
              }}
            />
          ))}
        </div>
      )}

      <SkillEditor
        skillId={selectedSkillId}
        onClose={() => setSelectedSkillId(null)}
      />

      <SkillCreateDialog
        isOpen={isCreateOpen}
        onClose={() => setIsCreateOpen(false)}
      />
    </section>
  );
}
