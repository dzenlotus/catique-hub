/**
 * useGroupedPromptSelect — adapter that lets a single `<SelectTag>` pick
 * BOTH individual prompts AND prompt groups.
 *
 * Group options are namespaced (`group:<id>`) inside the SelectTag value
 * list so the one `onChange` can be demultiplexed into two backend
 * mutations: `set_*_prompts` (plain ids) and `set_*_prompt_groups`
 * (stripped ids). Prompts already covered by an attached group are hidden
 * from the option list (the group represents them), except when the
 * prompt is ALSO directly attached — then its chip stays visible.
 *
 * Lives in `entities/prompt-group` (composes `@entities/prompt` via the
 * sanctioned cross-entity public API) so the Task / Role / Board pickers
 * can all share it without a cross-feature import.
 */

import { useCallback, useMemo } from "react";

import { usePrompts } from "@entities/prompt";
import type { SelectTagOption } from "@shared/ui";

import { usePromptGroups, usePromptGroupMembersMap } from "../model";

/** Prefix marking a SelectTag value/option as a prompt GROUP, not a prompt. */
export const GROUP_VALUE_PREFIX = "group:";

export interface GroupedPromptSelectArgs {
  /** Individually-attached prompt ids (chips), in order. */
  attachedPromptIds: readonly string[];
  /** Attached prompt-group ids (chips), in order. */
  attachedGroupIds: readonly string[];
  /** Fired when the individual-prompt selection changes. */
  onChangePrompts: (next: string[]) => void;
  /** Fired when the attached-group selection changes. */
  onChangeGroups: (next: string[]) => void;
}

export interface GroupedPromptSelectResult {
  options: SelectTagOption[];
  values: string[];
  onChange: (next: ReadonlyArray<string>) => void;
}

/** Order-sensitive array equality. */
function sameOrder(a: readonly string[], b: readonly string[]): boolean {
  return a.length === b.length && a.every((v, i) => v === b[i]);
}

export function useGroupedPromptSelect(
  args: GroupedPromptSelectArgs,
): GroupedPromptSelectResult {
  const { attachedPromptIds, attachedGroupIds, onChangePrompts, onChangeGroups } =
    args;

  const promptsQuery = usePrompts();
  const groupsQuery = usePromptGroups();
  const membersMap = usePromptGroupMembersMap(attachedGroupIds);

  // Prompts covered by an attached group — hidden from the list so the
  // user doesn't double-add. A prompt that is ALSO directly attached
  // stays visible so its chip keeps a matching option.
  const hiddenPromptIds = useMemo(() => {
    const directly = new Set(attachedPromptIds);
    const hidden = new Set<string>();
    for (const gid of attachedGroupIds) {
      for (const pid of membersMap[gid] ?? []) {
        if (!directly.has(pid)) hidden.add(pid);
      }
    }
    return hidden;
  }, [attachedGroupIds, attachedPromptIds, membersMap]);

  const options = useMemo<SelectTagOption[]>(() => {
    const groupOpts: SelectTagOption[] = (groupsQuery.data ?? []).map((g) => ({
      id: `${GROUP_VALUE_PREFIX}${g.id}`,
      label: g.name,
      color: g.color,
      description: "Group",
    }));
    const promptOpts: SelectTagOption[] = (promptsQuery.data ?? [])
      .filter((p) => !hiddenPromptIds.has(p.id))
      .map((p) =>
        p.shortDescription != null && p.shortDescription.length > 0
          ? { id: p.id, label: p.name, description: p.shortDescription }
          : { id: p.id, label: p.name },
      );
    return [...groupOpts, ...promptOpts];
  }, [groupsQuery.data, promptsQuery.data, hiddenPromptIds]);

  const values = useMemo(
    () => [
      ...attachedGroupIds.map((g) => `${GROUP_VALUE_PREFIX}${g}`),
      ...attachedPromptIds,
    ],
    [attachedGroupIds, attachedPromptIds],
  );

  const onChange = useCallback(
    (next: ReadonlyArray<string>): void => {
      const nextGroups: string[] = [];
      const nextPrompts: string[] = [];
      for (const v of next) {
        if (v.startsWith(GROUP_VALUE_PREFIX)) {
          nextGroups.push(v.slice(GROUP_VALUE_PREFIX.length));
        } else {
          nextPrompts.push(v);
        }
      }
      // Route only the side that actually changed so we don't fire a
      // redundant mutation (and event) for the untouched dimension.
      if (!sameOrder(nextGroups, attachedGroupIds)) onChangeGroups(nextGroups);
      if (!sameOrder(nextPrompts, attachedPromptIds)) onChangePrompts(nextPrompts);
    },
    [attachedGroupIds, attachedPromptIds, onChangeGroups, onChangePrompts],
  );

  return { options, values, onChange };
}
