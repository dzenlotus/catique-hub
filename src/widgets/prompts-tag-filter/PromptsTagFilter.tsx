/**
 * PromptsTagFilter — multi-select tag filter for the prompts grid.
 *
 * Round-19f: rebuilt on top of the shared `<MultiTagInput>` primitive
 * (react-aria TagGroup + ComboBox). Filter is read-only — no
 * `onCreate` callback, so the dropdown shows only existing tags.
 *
 * Filter semantics: a prompt passes when it carries EVERY selected
 * tag (intersection). Empty selection = "All" — same as before.
 */

import { useMemo, type ReactElement } from "react";

import { useTags } from "@entities/tag";
import { MultiTagInput, type MultiTagInputItem } from "@shared/ui";

export interface PromptsTagFilterProps {
  selectedTagIds: ReadonlyArray<string>;
  onChange: (next: ReadonlyArray<string>) => void;
}

export function PromptsTagFilter({
  selectedTagIds,
  onChange,
}: PromptsTagFilterProps): ReactElement {
  const tagsQuery = useTags();

  const items = useMemo<MultiTagInputItem[]>(
    () =>
      (tagsQuery.data ?? []).map((t) => ({
        id: t.id,
        label: t.name,
        color: t.color,
      })),
    [tagsQuery.data],
  );

  return (
    <MultiTagInput
      label="Filter prompts by tag"
      items={items}
      selectedIds={selectedTagIds}
      onChange={onChange}
      placeholder="Filter by tag…"
      data-testid="prompts-tag-filter"
    />
  );
}
