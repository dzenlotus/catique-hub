/**
 * `useMultiSelectState` — controlled state helpers for `<MultiSelect>`.
 *
 * Owns the typed query string, derives the filtered option list, and
 * encapsulates add/remove transitions on the controlled `values` array.
 * Keeps `MultiSelect.tsx` focused on layout + a11y wiring.
 */

import { useCallback, useEffect, useMemo, useState } from "react";

export interface MultiSelectOption<T extends string> {
  id: T;
  name: string;
  description?: string;
}

export interface MultiSelectStateApi<T extends string> {
  /** Current text in the search input. */
  query: string;
  /** Setter for the search input. */
  setQuery: (next: string) => void;
  /** Selected items, in `values` order. */
  selected: ReadonlyArray<MultiSelectOption<T>>;
  /** Options not currently selected, filtered by `query`. */
  filtered: ReadonlyArray<MultiSelectOption<T>>;
  /** Append `id` to `values` (no-op when already present). */
  add: (id: T) => void;
  /** Drop `id` from `values` (no-op when absent). */
  remove: (id: T) => void;
  /** Pop the trailing chip (used by Backspace-on-empty-query). */
  popLast: () => void;
}

interface UseMultiSelectStateArgs<T extends string> {
  values: ReadonlyArray<T>;
  options: ReadonlyArray<MultiSelectOption<T>>;
  onChange: (next: T[]) => void;
}

export function useMultiSelectState<T extends string>({
  values,
  options,
  onChange,
}: UseMultiSelectStateArgs<T>): MultiSelectStateApi<T> {
  const [query, setQuery] = useState("");

  // Wipe the echoed query whenever `values` changes — react-aria's
  // ComboBox copies the picked option's text into the input right
  // before our handler runs, so this empties the input visibly.
  useEffect(() => {
    setQuery("");
  }, [values.length]);

  const optionById = useMemo(() => {
    const m = new Map<T, MultiSelectOption<T>>();
    for (const option of options) m.set(option.id, option);
    return m;
  }, [options]);

  const selected = useMemo<MultiSelectOption<T>[]>(() => {
    const out: MultiSelectOption<T>[] = [];
    for (const id of values) {
      const found = optionById.get(id);
      if (found !== undefined) out.push(found);
    }
    return out;
  }, [values, optionById]);

  const filtered = useMemo<MultiSelectOption<T>[]>(() => {
    const selectedSet = new Set<T>(values);
    const lower = query.trim().toLowerCase();
    return options.filter((option) => {
      if (selectedSet.has(option.id)) return false;
      if (lower.length === 0) return true;
      return option.name.toLowerCase().includes(lower);
    });
  }, [options, values, query]);

  const add = useCallback(
    (id: T) => {
      if (values.includes(id)) return;
      onChange([...values, id]);
    },
    [values, onChange],
  );

  const remove = useCallback(
    (id: T) => {
      if (!values.includes(id)) return;
      onChange(values.filter((v) => v !== id));
    },
    [values, onChange],
  );

  const popLast = useCallback(() => {
    if (values.length === 0) return;
    onChange(values.slice(0, -1));
  }, [values, onChange]);

  return { query, setQuery, selected, filtered, add, remove, popLast };
}
