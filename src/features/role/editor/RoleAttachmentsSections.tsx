/**
 * `RoleAttachmentsSections` — three composed sections rendered inside
 * `RoleEditor`: attached prompts, skills, MCP tools.
 *
 * Each section is a single `<SelectTag>` chip field whose own label
 * doubles as the section header. The Prompts row keeps the chip
 * reordering UX via `reorderable` — order matters for prompt attachments
 * and is preserved end-to-end via `useSetRolePromptsMutation`.
 */

import { useCallback, useMemo, type ReactElement } from "react";

import { OriginBadge, SelectTag, type SelectTagOption } from "@shared/ui";
import { useToast } from "@shared/lib";
import {
  useRolePrompts,
  useRoleSkills,
  useRoleMcpTools,
  useSetRolePromptsMutation,
  useSetRoleSkillsMutation,
  useSetRoleMcpToolsMutation,
} from "@entities/role";
import {
  useRolePromptGroups,
  useSetRolePromptGroupsMutation,
  useGroupedPromptSelect,
} from "@entities/prompt-group";
import {
  useRoleMcpToolGroups,
  useSetRoleMcpToolGroupsMutation,
  useGroupedMcpToolSelect,
} from "@entities/mcp-tool-group";
import {
  useRoleMcpServers,
  useSetRoleMcpServersMutation,
} from "@entities/mcp-server";
import { useSkills, type Skill } from "@entities/skill";

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
  const groupsQuery = useRolePromptGroups(roleId);
  const setMutation = useSetRolePromptsMutation();
  const setGroupsMutation = useSetRolePromptGroupsMutation();
  const { pushToast } = useToast();

  const attachedIds = useMemo(
    () => (attachedQuery.data ?? []).map((p) => p.id),
    [attachedQuery.data],
  );
  const attachedGroupIds = useMemo(
    () => groupsQuery.data ?? [],
    [groupsQuery.data],
  );

  const handleChangePrompts = useCallback(
    (next: string[]): void => {
      setMutation.mutate(
        { roleId, promptIds: next },
        {
          onError: (err) => {
            pushToast("error", `Failed to update prompts: ${err.message}`);
          },
        },
      );
    },
    [setMutation, roleId, pushToast],
  );

  const handleChangeGroups = useCallback(
    (next: string[]): void => {
      setGroupsMutation.mutate(
        { id: roleId, groupIds: next },
        {
          onError: (err) => {
            pushToast("error", `Failed to update prompt groups: ${err.message}`);
          },
        },
      );
    },
    [setGroupsMutation, roleId, pushToast],
  );

  const { options, values, onChange } = useGroupedPromptSelect({
    attachedPromptIds: attachedIds,
    attachedGroupIds,
    onChangePrompts: handleChangePrompts,
    onChangeGroups: handleChangeGroups,
  });

  return (
    <section
      className={styles.section}
      data-testid="role-editor-prompts-section"
    >
      <AttachmentScopeHeader
        roleId={roleId}
        testId="role-editor-prompts-scope"
      />
      <SelectTag
        label="Prompts"
        values={values}
        options={options}
        onChange={onChange}
        reorderable
        placeholder="Search prompts or groups…"
        data-testid="role-editor-prompts-select"
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

  const handleChange = (next: ReadonlyArray<string>): void => {
    setMutation.mutate(
      { roleId, previous: attachedIds, next: [...next] },
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
      <AttachmentScopeHeader
        roleId={roleId}
        testId="role-editor-skills-scope"
      />
      <SelectTag
        label="Skills"
        values={attachedIds}
        options={options}
        onChange={handleChange}
        placeholder="Search skills…"
        data-testid="role-editor-skills-select"
      />
    </section>
  );
}

// ─── MCP tools section ───────────────────────────────────────────────────────

function RoleMcpToolsSection({ roleId }: SectionProps): ReactElement {
  const attachedQuery = useRoleMcpTools(roleId);
  const groupsQuery = useRoleMcpToolGroups(roleId);
  const serversQuery = useRoleMcpServers(roleId);
  const setMutation = useSetRoleMcpToolsMutation();
  const setGroupsMutation = useSetRoleMcpToolGroupsMutation();
  const setServersMutation = useSetRoleMcpServersMutation();
  const { pushToast } = useToast();

  const attachedIds = useMemo(
    () => (attachedQuery.data ?? []).map((t) => t.id),
    [attachedQuery.data],
  );
  const attachedGroupIds = useMemo(
    () => groupsQuery.data ?? [],
    [groupsQuery.data],
  );
  const attachedServerIds = useMemo(
    () => serversQuery.data ?? [],
    [serversQuery.data],
  );

  const handleChangeTools = useCallback(
    (next: string[]): void => {
      setMutation.mutate(
        { roleId, previous: attachedIds, next },
        {
          onError: (err) => {
            pushToast("error", `Failed to update MCP tools: ${err.message}`);
          },
        },
      );
    },
    [setMutation, roleId, attachedIds, pushToast],
  );

  const handleChangeGroups = useCallback(
    (next: string[]): void => {
      setGroupsMutation.mutate(
        { id: roleId, groupIds: next },
        {
          onError: (err) => {
            pushToast(
              "error",
              `Failed to update MCP tool groups: ${err.message}`,
            );
          },
        },
      );
    },
    [setGroupsMutation, roleId, pushToast],
  );

  const handleChangeServers = useCallback(
    (next: string[]): void => {
      setServersMutation.mutate(
        { id: roleId, serverIds: next },
        {
          onError: (err) => {
            pushToast("error", `Failed to update MCP servers: ${err.message}`);
          },
        },
      );
    },
    [setServersMutation, roleId, pushToast],
  );

  const { options, values, onChange } = useGroupedMcpToolSelect({
    attachedToolIds: attachedIds,
    attachedGroupIds,
    attachedServerIds,
    onChangeTools: handleChangeTools,
    onChangeGroups: handleChangeGroups,
    onChangeServers: handleChangeServers,
  });

  return (
    <section
      className={styles.section}
      data-testid="role-editor-mcp-tools-section"
    >
      <AttachmentScopeHeader
        roleId={roleId}
        testId="role-editor-mcp-tools-scope"
      />
      <SelectTag
        label="MCP tools"
        values={values}
        options={options}
        onChange={onChange}
        placeholder="Search MCP tools or groups…"
        data-testid="role-editor-mcp-tools-select"
      />
    </section>
  );
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

/**
 * `AttachmentScopeHeader` — small caption rendered above each
 * attachment chip row. Surfaces the inheritance origin (always
 * `{ kind: "role" }` here) so the user understands every chip in the
 * row anchors at the agent scope and cascades into tasks on this
 * agent's boards.
 *
 * Renders as a flex row so the badge sits next to the muted hint and
 * the row stays compact even on narrow viewports.
 */
function AttachmentScopeHeader({
  roleId,
  testId,
}: {
  roleId: string;
  testId: string;
}): ReactElement {
  return (
    <div className={styles.attachmentScopeHeader} data-testid={testId}>
      <span className={styles.attachmentScopeHint}>
        Anchored to this agent — cascades to every task on its boards.
      </span>
      <OriginBadge
        origin={{ kind: "role", id: roleId }}
        data-testid={`${testId}-badge`}
      />
    </div>
  );
}

/**
 * Adapt entity rows (`{ id, name, description? }`) to SelectTag's option
 * shape (`{ id, label, description? }`). Prompts / skills / MCP tools
 * carry no colour on this surface, so `color` is intentionally omitted.
 */
function toOptions<T extends { id: string; name: string }>(
  items: ReadonlyArray<T>,
  getDescription: (item: T) => string | null | undefined,
): SelectTagOption[] {
  return items.map((item) => {
    const description = getDescription(item);
    return description != null && description.length > 0
      ? { id: item.id, label: item.name, description }
      : { id: item.id, label: item.name };
  });
}
