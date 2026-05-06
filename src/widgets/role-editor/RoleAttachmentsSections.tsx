/**
 * `RoleAttachmentsSections` — three composed sections rendered inside
 * `RoleEditor`: attached prompts, skills, MCP tools.
 *
 * Each section is a single `<MultiSelect>` chip field whose own label
 * doubles as the section header — the duplicate `<p className="sectionLabel">`
 * tags were dropped per maintainer feedback (round-21). The
 * "Create + attach" prompts trigger was removed at the same time:
 * authoring a prompt belongs on the prompts page, not buried inside the
 * role editor.
 */

import { useMemo, type ReactElement } from "react";

import { MultiSelect } from "@shared/ui";
import { useToast } from "@app/providers/ToastProvider";
import {
  useRolePrompts,
  useRoleSkills,
  useRoleMcpTools,
  useSetRolePromptsMutation,
  useSetRoleSkillsMutation,
  useSetRoleMcpToolsMutation,
} from "@entities/role";
import { usePrompts, type Prompt } from "@entities/prompt";
import { useSkills, type Skill } from "@entities/skill";
import { useMcpTools, type McpTool } from "@entities/mcp-tool";

import styles from "./RoleEditor.module.css";

// ─── Public API ──────────────────────────────────────────────────────────────

export interface RoleAttachmentsSectionsProps {
  roleId: string;
}

/** Render the three role-attachment sections in document order. */
export function RoleAttachmentsSections({
  roleId,
}: RoleAttachmentsSectionsProps): ReactElement {
  return (
    <>
      <RolePromptsSection roleId={roleId} />
      <RoleSkillsSection roleId={roleId} />
      <RoleMcpToolsSection roleId={roleId} />
    </>
  );
}

// ─── Prompts section ─────────────────────────────────────────────────────────

interface SectionProps {
  roleId: string;
}

function RolePromptsSection({ roleId }: SectionProps): ReactElement {
  const attachedQuery = useRolePrompts(roleId);
  const allQuery = usePrompts();
  const setMutation = useSetRolePromptsMutation();
  const { pushToast } = useToast();

  const attachedIds = useMemo(
    () => (attachedQuery.data ?? []).map((p) => p.id),
    [attachedQuery.data],
  );

  const options = useMemo(
    () => toOptions<Prompt>(allQuery.data ?? [], (p) => p.shortDescription),
    [allQuery.data],
  );

  const handleChange = (next: string[]): void => {
    setMutation.mutate(
      { roleId, promptIds: next },
      {
        onError: (err) => {
          pushToast("error", `Failed to update prompts: ${err.message}`);
        },
      },
    );
  };

  return (
    <section
      className={styles.section}
      data-testid="role-editor-prompts-section"
    >
      <MultiSelect<string>
        label="Prompts"
        values={attachedIds}
        options={options}
        onChange={handleChange}
        reorderable
        placeholder="Search prompts…"
        emptyText="No prompts available"
        testId="role-editor-prompts-select"
      />
    </section>
  );
}

// ─── Skills section ──────────────────────────────────────────────────────────

function RoleSkillsSection({ roleId }: SectionProps): ReactElement {
  const attachedQuery = useRoleSkills(roleId);
  const allQuery = useSkills();
  const setMutation = useSetRoleSkillsMutation();
  const { pushToast } = useToast();

  const attachedIds = useMemo(
    () => (attachedQuery.data ?? []).map((s) => s.id),
    [attachedQuery.data],
  );

  const options = useMemo(
    () => toOptions<Skill>(allQuery.data ?? [], (s) => s.description),
    [allQuery.data],
  );

  const handleChange = (next: string[]): void => {
    setMutation.mutate(
      { roleId, previous: attachedIds, next },
      {
        onError: (err) => {
          pushToast("error", `Failed to update skills: ${err.message}`);
        },
      },
    );
  };

  return (
    <section
      className={styles.section}
      data-testid="role-editor-skills-section"
    >
      <MultiSelect<string>
        label="Skills"
        values={attachedIds}
        options={options}
        onChange={handleChange}
        placeholder="Search skills…"
        emptyText="No skills available"
        testId="role-editor-skills-select"
      />
    </section>
  );
}

// ─── MCP tools section ───────────────────────────────────────────────────────

function RoleMcpToolsSection({ roleId }: SectionProps): ReactElement {
  const attachedQuery = useRoleMcpTools(roleId);
  const allQuery = useMcpTools();
  const setMutation = useSetRoleMcpToolsMutation();
  const { pushToast } = useToast();

  const attachedIds = useMemo(
    () => (attachedQuery.data ?? []).map((t) => t.id),
    [attachedQuery.data],
  );

  const options = useMemo(
    () => toOptions<McpTool>(allQuery.data ?? [], (t) => t.description),
    [allQuery.data],
  );

  const handleChange = (next: string[]): void => {
    setMutation.mutate(
      { roleId, previous: attachedIds, next },
      {
        onError: (err) => {
          pushToast("error", `Failed to update MCP tools: ${err.message}`);
        },
      },
    );
  };

  return (
    <section
      className={styles.section}
      data-testid="role-editor-mcp-tools-section"
    >
      <MultiSelect<string>
        label="MCP tools"
        values={attachedIds}
        options={options}
        onChange={handleChange}
        placeholder="Search MCP tools…"
        emptyText="No MCP tools available"
        testId="role-editor-mcp-tools-select"
      />
    </section>
  );
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function toOptions<T extends { id: string; name: string }>(
  items: ReadonlyArray<T>,
  getDescription: (item: T) => string | null | undefined,
): { id: string; name: string; description?: string }[] {
  return items.map((item) => {
    const description = getDescription(item);
    return description != null && description.length > 0
      ? { id: item.id, name: item.name, description }
      : { id: item.id, name: item.name };
  });
}
