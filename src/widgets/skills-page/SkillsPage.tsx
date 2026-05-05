/**
 * SkillsPage — two-pane shell wrapping the existing `<SkillsList>`.
 * Mirrors RolesPage shape so the four routed pages with sidebars
 * (boards, prompts, roles, skills, mcp-tools) share the same layout.
 */

import { useState, type ReactElement } from "react";

import { useSkills } from "@entities/skill";
import { Scrollable } from "@shared/ui";
import { SkillCreateDialog } from "@widgets/skill-create-dialog";
import { SkillEditor } from "@widgets/skill-editor";
import { EntityListSidebar } from "@widgets/entity-list-sidebar";
import { SkillsList } from "@widgets/skills-list";

import shellStyles from "@widgets/entity-list-sidebar/EntityPageShell.module.css";

export function SkillsPage(): ReactElement {
  const skillsQuery = useSkills();
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [isCreateOpen, setIsCreateOpen] = useState(false);

  const items = (skillsQuery.data ?? []).map((s) => ({
    id: s.id,
    name: s.name,
    color: s.color,
  }));

  return (
    <section className={shellStyles.root} data-testid="skills-page-root">
      <div className={shellStyles.sidebarSlot}>
        <EntityListSidebar
          title="SKILLS"
          ariaLabel="Skills navigation"
          items={items}
          selectedId={selectedId}
          onSelect={setSelectedId}
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
        <SkillsList
          onSelectSkill={setSelectedId}
          onCreate={() => setIsCreateOpen(true)}
        />
      </Scrollable>

      <SkillEditor
        skillId={selectedId}
        onClose={() => setSelectedId(null)}
      />
      <SkillCreateDialog
        isOpen={isCreateOpen}
        onClose={() => setIsCreateOpen(false)}
      />
    </section>
  );
}
