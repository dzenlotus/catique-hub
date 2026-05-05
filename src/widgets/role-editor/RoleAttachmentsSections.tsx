/**
 * `RoleAttachmentsSections` — three composed sections rendered inside
 * `RoleEditor`: attached prompts, skills, MCP tools.
 *
 * Audit-#8 reshape: each section is now a single `<MultiSelect>` chip
 * field (ctq-103 / ctq-116 surface). `Create + attach` stays a small
 * sibling button for prompts so users can mint a new prompt without
 * leaving the dialog. Drag-reorder for prompts is preserved by passing
 * `reorderable` to the prompt MultiSelect.
 */

import { useMemo, useState, type ReactElement } from "react";

import { Button, MultiSelect } from "@shared/ui";
import { useToast } from "@app/providers/ToastProvider";
import {
  useRolePrompts,
  useRoleSkills,
  useRoleMcpTools,
  useAddRolePromptMutation,
  useSetRolePromptsMutation,
  useSetRoleSkillsMutation,
  useSetRoleMcpToolsMutation,
} from "@entities/role";
import {
  usePrompts,
  useCreatePromptMutation,
  type Prompt,
} from "@entities/prompt";
import { useSkills, type Skill } from "@entities/skill";
import { useMcpTools, type McpTool } from "@entities/mcp-tool";
import { PromptCreateDialog } from "@widgets/prompt-create-dialog";

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
  const addMutation = useAddRolePromptMutation();
  const createMutation = useCreatePromptMutation();
  const { pushToast } = useToast();

  const [isCreateOpen, setIsCreateOpen] = useState(false);

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
      <div className={styles.attachmentSectionHeader}>
        <p className={styles.sectionLabel}>Prompts</p>
        <Button
          variant="ghost"
          size="sm"
          onPress={() => setIsCreateOpen(true)}
          data-testid="role-editor-prompts-create"
        >
          Create + attach
        </Button>
      </div>

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

      <PromptCreateDialog
        isOpen={isCreateOpen}
        onClose={() => setIsCreateOpen(false)}
        onCreated={(prompt) => {
          const nextPosition = attachedIds.length;
          addMutation.mutate(
            { roleId, promptId: prompt.id, position: nextPosition },
            {
              onError: (err) => {
                pushToast(
                  "error",
                  `Created prompt but failed to attach: ${err.message}`,
                );
              },
              onSuccess: () => {
                pushToast("success", "Prompt created and attached");
              },
            },
          );
        }}
      />
      {/* `createMutation` exposes its own status to the dialog. */}
      {createMutation.status === "error" ? null : null}
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
      <p className={styles.sectionLabel}>Skills</p>
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
      <p className={styles.sectionLabel}>MCP tools</p>
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
