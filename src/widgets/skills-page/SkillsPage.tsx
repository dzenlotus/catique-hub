/**
 * SkillsPage — two-pane shell wrapping the existing `<SkillsList>`.
 * Mirrors RolesPage shape; audit-#9: editor is a routed PAGE on
 * `/skills/:skillId` rather than a modal.
 */

import { useState, type ReactElement } from "react";
import { useLocation, useRoute } from "wouter";

import { useSkills } from "@entities/skill";
import { Scrollable } from "@shared/ui";
import { SkillCreateDialog } from "@widgets/skill-create-dialog";
import { SkillEditorPanel } from "@widgets/skill-editor";
import { EntityListSidebar } from "@widgets/entity-list-sidebar";
import { SkillsList } from "@widgets/skills-list";
import { skillPath, routes } from "@app/routes";

import shellStyles from "@widgets/entity-list-sidebar/EntityPageShell.module.css";

export function SkillsPage(): ReactElement {
  const skillsQuery = useSkills();
  const [, setLocation] = useLocation();
  const [match, params] = useRoute<{ skillId: string }>(routes.skill);
  const selectedId = match ? params?.skillId ?? null : null;
  const [isCreateOpen, setIsCreateOpen] = useState(false);

  const items = (skillsQuery.data ?? []).map((s) => ({
    id: s.id,
    name: s.name,
    color: s.color,
  }));

  const handleSelect = (id: string | null): void => {
    setLocation(id ? skillPath(id) : routes.skills);
  };

  return (
    <section className={shellStyles.root} data-testid="skills-page-root">
      <div className={shellStyles.sidebarSlot}>
        <EntityListSidebar
          title="SKILLS"
          ariaLabel="Skills navigation"
          items={items}
          selectedId={selectedId}
          onSelect={(id) => handleSelect(id)}
          addLabel="Add skill"
          onAdd={() => setIsCreateOpen(true)}
          emptyText="No skills yet."
          testIdPrefix="skills-sidebar"
          isLoading={skillsQuery.status === "pending"}
          errorMessage={
            skillsQuery.status === "error"
              ? `Failed to load skills: ${skillsQuery.error.message}`
              : null
          }
        />
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
