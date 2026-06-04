/**
 * PromptsTagFilter — multi-select tag filter for the prompts grid.
 *
 * Built on the canonical `<SelectTag>` primitive (no create row —
 * `onCreate` omitted). Users add multiple tag chips via combobox + dropdown,
 * and the parent filters prompts in OR-mode (AND-mode toggle is a
 * separate audit item, out of scope here). Each chip carries the tag's
 * colour swatch.
 */

import { useMemo, type ReactElement } from "react";

import { useTags } from "@entities/tag";
import { SelectTag, type SelectTagOption } from "@shared/ui";

export interface PromptsTagFilterProps {
  selectedTagIds: ReadonlyArray<string>;
  onChange: (next: ReadonlyArray<string>) => void;
}

export function PromptsTagFilter({
  selectedTagIds,
  onChange,
}: PromptsTagFilterProps): ReactElement {
  const tagsQuery = useTags();

  const options = useMemo<SelectTagOption[]>(
    () =>
      (tagsQuery.data ?? []).map((t) => ({
        id: t.id,
        label: t.name,
        color: t.color,
      })),
    [tagsQuery.data],
  );

  return (
    <SelectTag
      label="Filter prompts by tag"
      values={selectedTagIds}
      options={options}
      onChange={(next) => onChange(next)}
      placeholder="Filter by tag…"
      data-testid="prompts-tag-filter"
    />
  );
}
