/**
 * `ActionsList` — command-mode (`>` prefix) result list for the Cmd+K
 * palette. Renders filtered `QuickAction`s through the shared
 * `PaletteRow`, keeping `cmdk-action-<id>` testids stable.
 */
import { type ReactElement } from "react";

import { PaletteRow } from "./PaletteRow";
import type { QuickAction } from "./actions";
import styles from "./GlobalSearch.module.css";

export interface ActionsListProps {
  actions: ReadonlyArray<QuickAction>;
  focusedIndex: number;
  onFocusIndex: (index: number) => void;
  onSelect: (action: QuickAction) => void;
}

export function ActionsList({
  actions,
  focusedIndex,
  onFocusIndex,
  onSelect,
}: ActionsListProps): ReactElement {
  return (
    <div role="listbox" aria-label="Quick actions">
      <div className={styles.groupHeader} aria-hidden="true">
        Actions
      </div>
      {actions.map((action, idx) => (
        <PaletteRow
          key={action.id}
          title={action.title}
          {...(action.hint !== undefined ? { snippet: action.hint } : {})}
          isFocused={focusedIndex === idx}
          onSelect={() => onSelect(action)}
          onHover={() => onFocusIndex(idx)}
          testId={`cmdk-action-${action.id}`}
        />
      ))}
    </div>
  );
}
