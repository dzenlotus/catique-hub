/**
 * SkillsPage — two-pane shell wrapping the existing `<SkillsList>`.
 *
 * Sidebar uses the unified `<EntityTree/>` with the default label-button
 * body. Selection state lives in the URL — the editor mounts on
 * `/skills/:skillId`.
 */

import { useMemo, useState, type ReactElement } from "react";
import { useLocationCompat as useLocation, useRouteCompat as useRoute } from "@shared/lib";

import { useSkills, type Skill } from "@entities/skill";
import {
  EntityTree,
  type EntityTreeNode,
  RowLabelButton,
  Scrollable,
  SidebarShell,
} from "@shared/ui";
import { SidebarSectionAddTrigger } from "@shared/ui/SidebarShell";
import { SkillCreateDialog } from "@features/skill/create-dialog";
import { SkillEditorPanel } from "@features/skill/editor";
import { entityPageShellStyles as shellStyles } from "@widgets/entity-page-shell";
import { SkillsList } from "@entities/skill";
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

  const treeData = useMemo<EntityTreeNode<Skill>[]>(
    () =>
      skills.map((skill) => ({
        id: skill.id,
        label: skill.name,
        data: skill,
      })),
    [skills],
  );

  return (
    <section className={shellStyles.root} data-testid="skills-page-root">
      <div className={shellStyles.sidebarSlot}>
        <SidebarShell
          ariaLabel="Skills navigation"
          testId="skills-sidebar-root-shell"
        >
          <EntityTree<Skill>
            testIdPrefix="skills-sidebar"
            title="SKILLS"
            titleAriaLabel="Skills navigation"
            titleTrailingNode={
              skillsQuery.status === "success" ? (
                <SidebarSectionAddTrigger
                  ariaLabel="Add skill"
                  onPress={() => setIsCreateOpen(true)}
                  testId="skills-sidebar-add"
                />
              ) : null
            }
            emptyText="No skills yet."
            isLoading={skillsQuery.status === "pending"}
            errorMessage={
              skillsQuery.status === "error"
                ? `Failed to load skills: ${skillsQuery.error.message}`
                : null
            }
            data={treeData}
            rowConfig={(node) => ({
              isActive: node.id === selectedId,
              onClick: () => handleSelect(node.id),
            })}
            renderRow={({ node }) => {
              const skill = node.data;
              return (
                <RowLabelButton
                  label={node.label}
                  color={skill?.color ?? null}
                  onClick={() => handleSelect(node.id)}
                  testId={`skills-sidebar-row-${node.id}`}
                />
              );
            }}
          />
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
