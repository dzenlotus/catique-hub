import { useState, type ReactElement } from "react";

import { SkillCard, useSkills } from "@entities/skill";
import { Button, EmptyState, Scrollable } from "@shared/ui";
import { PixelDesignMagicWand } from "@shared/ui/Icon";
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
    <Scrollable
      axis="y"
      className={styles.scrollHost}
      data-testid="skills-list-scroll"
    >
    <section className={styles.root} aria-labelledby="skills-list-heading">
      <header className={styles.header}>
        <div className={styles.headingGroup}>
          <PixelDesignMagicWand
            width={20}
            height={20}
            className={styles.headingIcon}
            aria-hidden={true}
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
            Create skill
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
            Failed to load skills: {skillsQuery.error.message}
          </p>
          <Button
            variant="secondary"
            size="sm"
            onPress={() => {
              void skillsQuery.refetch();
            }}
          >
            Retry
          </Button>
        </div>
      ) : skillsQuery.data.length === 0 ? (
        <div className={styles.empty} data-testid="skills-list-empty">
          <EmptyState
            icon={<PixelDesignMagicWand width={64} height={64} />}
            title="No skills yet"
            description="Capabilities you grant to agents."
            action={
              <Button
                variant="primary"
                size="md"
                onPress={() => setIsCreateOpen(true)}
              >
                Create skill
              </Button>
            }
          />
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
    </Scrollable>
  );
}
