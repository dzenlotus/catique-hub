/**
 * SkillsPage — two-pane shell wrapping the existing `<SkillsList>`.
 *
 * Round-26 (Row/Group split): rail composes `<RailSection>` + `<Row>`
 * directly so the page owns iteration over `useSkills().data`.
 *
 * audit-#9: editor is a routed PAGE on `/skills/:skillId` rather than
 * a modal.
 */

import { useState, type ReactElement } from "react";
import { useLocation, useRoute } from "wouter";

import { useSkills } from "@entities/skill";
import {
  RailSection,
  Row,
  RowLabelButton,
  Scrollable,
  SidebarShell,
} from "@shared/ui";
import { SkillCreateDialog } from "@widgets/skill-create-dialog";
import { SkillEditorPanel } from "@widgets/skill-editor";
import { entityPageShellStyles as shellStyles } from "@widgets/entity-page-shell";
import { SkillsList } from "@widgets/skills-list";
import { skillPath, routes } from "@app/routes";

export function SkillsPage(): ReactElement {
  const skillsQuery = useSkills();
  const [, setLocation] = useLocation();
  const [match, params] = useRoute<{ skillId: string }>(routes.skill);
  const selectedId = match ? params?.skillId ?? null : null;
  const [isCreateOpen, setIsCreateOpen] = useState(false);

  const skills = skillsQuery.data ?? [];

  const handleSelect = (id: string | null): void => {
    setLocation(id ? skillPath(id) : routes.skills);
  };

  return (
    <section className={shellStyles.root} data-testid="skills-page-root">
      <div className={shellStyles.sidebarSlot}>
        <SidebarShell
          ariaLabel="Skills navigation"
          testId="skills-sidebar-root-shell"
        >
          <RailSection
            title="SKILLS"
            titleAriaLabel="Skills navigation"
            testIdPrefix="skills-sidebar"
            addLabel="Add skill"
            onAdd={() => setIsCreateOpen(true)}
            emptyText="No skills yet."
            isLoading={skillsQuery.status === "pending"}
            errorMessage={
              skillsQuery.status === "error"
                ? `Failed to load skills: ${skillsQuery.error.message}`
                : null
            }
            isEmpty={skills.length === 0}
          >
            {skills.map((skill) => (
              <Row
                key={skill.id}
                testId={`skills-sidebar-item-${skill.id}`}
                isActive={skill.id === selectedId}
                onClick={() => handleSelect(skill.id)}
                renderContent={() => (
                  <RowLabelButton
                    label={skill.name}
                    color={skill.color}
                    onClick={() => handleSelect(skill.id)}
                    testId={`skills-sidebar-row-${skill.id}`}
                  />
                )}
              />
            ))}
          </RailSection>
        </SidebarShell>
      </div>

      <Scrollable
        axis="y"
        className={shellStyles.contentSlot}
        data-testid="skills-page-content-scroll"
      >
        {selectedId ? (
          <SkillEditorPanel
            skillId={selectedId}
            onClose={() => handleSelect(null)}
          />
        ) : (
          <SkillsList
            onSelectSkill={(id) => handleSelect(id)}
            onCreate={() => setIsCreateOpen(true)}
          />
        )}
      </Scrollable>

      <SkillCreateDialog
        isOpen={isCreateOpen}
        onClose={() => setIsCreateOpen(false)}
      />
    </section>
  );
}
