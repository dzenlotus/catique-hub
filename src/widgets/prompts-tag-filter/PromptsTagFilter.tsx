/**
 * PromptsTagFilter — multi-select tag filter for the prompts grid.
 *
 * audit-C: migrated from `<MultiTagInput>` to the canonical
 * `<MultiSelect>` primitive. The single-select-feeling list is gone;
 * users add multiple tag chips via combobox + dropdown, and the parent
 * filters prompts in OR-mode (audit-C: AND-mode toggle is a separate
 * audit item, out of scope here).
 */

import { useMemo, type ReactElement } from "react";

import { useTags } from "@entities/tag";
import { MultiSelect, type MultiSelectOption } from "@shared/ui";

export interface PromptsTagFilterProps {
  selectedTagIds: ReadonlyArray<string>;
  onChange: (next: ReadonlyArray<string>) => void;
}

export function PromptsTagFilter({
  selectedTagIds,
  onChange,
}: PromptsTagFilterProps): ReactElement {
  const tagsQuery = useTags();

  const options = useMemo<MultiSelectOption<string>[]>(
    () =>
      (tagsQuery.data ?? []).map((t) => ({
        id: t.id,
        name: t.name,
      })),
    [tagsQuery.data],
  );

  return (
    <MultiSelect<string>
      label="Filter prompts by tag"
      values={selectedTagIds}
      options={options}
      onChange={(next) => onChange(next)}
      placeholder="Filter by tag…"
      testId="prompts-tag-filter"
    />
  );
}
