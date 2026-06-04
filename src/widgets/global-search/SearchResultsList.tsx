/**
 * `SearchResultsList` — grouped, keyboard-navigable result list for the
 * Cmd+K palette in search mode.
 *
 * Renders three optional groups (Prompts → Tasks → Agent reports) using a
 * single running `globalIndex` so `focusedIndex` / `aria-selected` stay
 * aligned with the flat list the keyboard-nav hook walks.
 */
import { type ReactElement } from "react";

import type { SearchResult } from "@bindings/SearchResult";

import { PaletteRow } from "./PaletteRow";
import {
  groupResults,
  type LocalResult,
  type PromptResult,
} from "./useGlobalSearchQuery";
import styles from "./GlobalSearch.module.css";

/** How many characters of prompt content to show as the row excerpt. */
const PROMPT_SNIPPET_CHARS = 60;

function promptExcerpt(content: string): string {
  const flat = content.replace(/\s+/gu, " ").trim();
  if (flat.length <= PROMPT_SNIPPET_CHARS) return flat;
  return `${flat.slice(0, PROMPT_SNIPPET_CHARS)}…`;
}

export interface SearchResultsListProps {
  flatResults: ReadonlyArray<LocalResult>;
  focusedIndex: number;
  onFocusIndex: (index: number) => void;
  onSelectPrompt: (result: PromptResult) => void;
  onSelectResult: (result: SearchResult) => void;
}

export function SearchResultsList({
  flatResults,
  focusedIndex,
  onFocusIndex,
  onSelectPrompt,
  onSelectResult,
}: SearchResultsListProps): ReactElement {
  const { prompts, tasks, agentReports } = groupResults(flatResults);
  // Single running index keeps aria-selected aligned with `flatResults`.
  let globalIndex = 0;

  return (
    <div role="listbox" aria-label="Search results">
      {prompts.length > 0 ? (
        <div>
          <div className={styles.groupHeader} aria-hidden="true">
            Prompts
          </div>
          {prompts.map((result) => {
            const idx = globalIndex++;
            return (
              <PaletteRow
                key={`prompt-${result.id}`}
                title={result.name}
                snippet={promptExcerpt(result.content)}
                isFocused={focusedIndex === idx}
                onSelect={() => onSelectPrompt(result)}
                onHover={() => onFocusIndex(idx)}
                testId={`global-search-result-${idx}`}
                dataAttrs={{
                  "data-result-kind": "prompt",
                  "data-prompt-id": result.id,
                }}
              />
            );
          })}
        </div>
      ) : null}

      {tasks.length > 0 ? (
        <div>
          <div className={styles.groupHeader} aria-hidden="true">
            Tasks
          </div>
          {tasks.map((row) => {
            const idx = globalIndex++;
            return (
              <PaletteRow
                key={row.data.id}
                title={row.data.title}
                snippet={row.data.snippet}
                isFocused={focusedIndex === idx}
                onSelect={() => onSelectResult(row.data)}
                onHover={() => onFocusIndex(idx)}
                testId={`global-search-result-${idx}`}
              />
            );
          })}
        </div>
      ) : null}

      {agentReports.length > 0 ? (
        <div>
          <div className={styles.groupHeader} aria-hidden="true">
            Agent reports
          </div>
          {agentReports.map((row) => {
            const idx = globalIndex++;
            return (
              <PaletteRow
                key={row.data.id}
                title={row.data.title}
                snippet={row.data.snippet}
                isFocused={focusedIndex === idx}
                onSelect={() => onSelectResult(row.data)}
                onHover={() => onFocusIndex(idx)}
                testId={`global-search-result-${idx}`}
              />
            );
          })}
        </div>
      ) : null}
    </div>
  );
}
