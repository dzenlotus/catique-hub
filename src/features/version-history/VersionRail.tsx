/**
 * VersionRail — left-side timeline list inside HistoryDialogBody.
 *
 * Stays a presentation component: receives the resolved rows + the
 * current selection + callbacks for click / revert. No data fetching
 * happens here.
 */

import type { ReactElement } from "react";

import { EntityActionMenu } from "@shared/ui";

import { formatRelativeTime } from "./relativeTime";
import type { VersionHistoryRow } from "./useVersionHistory";

import styles from "./HistoryViewerButton.module.css";

export interface VersionRailProps {
  rows: ReadonlyArray<VersionHistoryRow>;
  selectedId: string;
  onSelect: (id: string) => void;
  onRevertRequest: (id: string) => void;
  testIdPrefix: string;
}

export function VersionRail({
  rows,
  selectedId,
  onSelect,
  onRevertRequest,
  testIdPrefix,
}: VersionRailProps): ReactElement {
  return (
    <ul className={styles.rail} aria-label="Version timeline">
      {rows.map((v) => (
        <li key={v.id}>
          <button
            type="button"
            className={styles.railRow}
            data-active={selectedId === v.id ? "true" : "false"}
            data-testid={`${testIdPrefix}-row-${v.id}`}
            onClick={() => onSelect(v.id)}
          >
            <span className={styles.railRowMain}>
              <span className={styles.railRowTime}>
                {formatRelativeTime(v.createdAt)}
              </span>
              <span className={styles.railRowPreview}>
                {firstLine(v.content) || "(empty)"}
              </span>
            </span>
            <span
              className={styles.railRowMenu}
              onClick={(e) => e.stopPropagation()}
              onKeyDown={(e) => e.stopPropagation()}
              role="presentation"
            >
              <EntityActionMenu
                triggerAriaLabel={`Actions for version saved ${formatRelativeTime(v.createdAt)}`}
                triggerTestId={`${testIdPrefix}-row-${v.id}-menu`}
                items={[
                  {
                    id: "revert",
                    label: "Revert to this version",
                    onAction: () => onRevertRequest(v.id),
                  },
                ]}
              />
            </span>
          </button>
        </li>
      ))}
    </ul>
  );
}

function firstLine(content: string): string {
  const idx = content.indexOf("\n");
  return idx === -1 ? content : content.slice(0, idx);
}
