/**
 * VersionPane — right-side detail pane inside HistoryDialogBody.
 *
 * Renders the selected version's content (Markdown) above a line-diff
 * against the current entity content. Diff library is a small inline
 * LCS helper — see `./lineDiff.ts`.
 */

import { useMemo, type ReactElement } from "react";

import { Button, MarkdownPreview } from "@shared/ui";

import { lineDiff, type LineDiffKind } from "./lineDiff";

import styles from "./HistoryViewerButton.module.css";

export interface VersionPaneProps {
  /** Selected version's content (or "" while loading). */
  previewSource: string;
  /** Current entity content — right-hand side of the diff. */
  currentContent: string;
  testIdPrefix: string;
  onClose: () => void;
}

export function VersionPane({
  previewSource,
  currentContent,
  testIdPrefix,
  onClose,
}: VersionPaneProps): ReactElement {
  const diffEntries = useMemo(
    () => lineDiff(previewSource, currentContent),
    [previewSource, currentContent],
  );

  return (
    <div className={styles.pane}>
      <div className={styles.paneSection}>
        <p className={styles.paneLabel}>Version content</p>
        <div
          className={styles.previewSurface}
          data-testid={`${testIdPrefix}-preview`}
        >
          <MarkdownPreview source={previewSource} />
        </div>
      </div>
      <div className={styles.paneSection}>
        <p className={styles.paneLabel}>Diff vs. current content</p>
        <pre className={styles.diffPre} data-testid={`${testIdPrefix}-diff`}>
          {diffEntries.length === 0 ? (
            <span className={styles.diffLine} data-kind="context">
              (no changes)
            </span>
          ) : (
            diffEntries.map((entry, i) => (
              <span
                key={i}
                className={styles.diffLine}
                data-kind={entry.kind}
              >
                {prefixFor(entry.kind)}
                {entry.text}
                {"\n"}
              </span>
            ))
          )}
        </pre>
      </div>
      <div>
        <Button
          variant="ghost"
          size="sm"
          onPress={onClose}
          data-testid={`${testIdPrefix}-close`}
        >
          Close
        </Button>
      </div>
    </div>
  );
}

function prefixFor(kind: LineDiffKind): string {
  if (kind === "added") return "+ ";
  if (kind === "removed") return "- ";
  return "  ";
}
