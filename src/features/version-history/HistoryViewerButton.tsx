/**
 * HistoryViewerButton — version-history viewer for role / prompt
 * content. Replaces the previous `HistoryStubButton` placeholder.
 *
 * Mounts a ghost button next to the editor title; clicking opens a
 * 2-column dialog (timeline + selected version + diff vs. current).
 * The body is split into `HistoryDialogBody` so this component stays
 * focused on the trigger + dialog mount.
 *
 * Props:
 *   - `title` — dialog heading ("Role content history" /
 *     "Prompt content history").
 *   - `kind`  — selects the entity slice that owns versions.
 *   - `sourceId` — the role / prompt id whose versions to load.
 *   - `currentContent` — current content for the right-pane diff.
 *   - `data-testid` — optional override for the trigger button id.
 */

import { useState, type ReactElement } from "react";

import { Button, Dialog } from "@shared/ui";

import { HistoryDialogBody } from "./HistoryDialogBody";
import type { HistoryKind } from "./useVersionHistory";

export interface HistoryViewerButtonProps {
  /** Dialog heading. Required so the surface scope is unambiguous. */
  title: string;
  /** Which entity slice owns the versions for `sourceId`. */
  kind: HistoryKind;
  /** Role id (kind="role") or prompt id (kind="prompt"). */
  sourceId: string;
  /**
   * Current entity content. The dialog diffs the selected version
   * against this value. Caller is responsible for passing the same
   * string the entity's `.content` field holds — the local-edit
   * buffer is irrelevant here because the diff target is the saved
   * state, not the unsaved draft.
   */
  currentContent: string;
  /** Optional override for the button test id. */
  "data-testid"?: string;
}

export function HistoryViewerButton({
  title,
  kind,
  sourceId,
  currentContent,
  "data-testid": dataTestId = "history-viewer-button",
}: HistoryViewerButtonProps): ReactElement {
  const [isOpen, setIsOpen] = useState(false);

  return (
    <>
      <Button
        variant="ghost"
        size="sm"
        onPress={() => setIsOpen(true)}
        aria-label={`Open ${title}`}
        data-testid={dataTestId}
      >
        History
      </Button>
      <Dialog
        title={title}
        isOpen={isOpen}
        onOpenChange={setIsOpen}
        isDismissable
        data-testid={`${dataTestId}-dialog`}
      >
        {(close) =>
          isOpen ? (
            <HistoryDialogBody
              kind={kind}
              sourceId={sourceId}
              currentContent={currentContent}
              testIdPrefix={dataTestId}
              onClose={close}
            />
          ) : null
        }
      </Dialog>
    </>
  );
}
