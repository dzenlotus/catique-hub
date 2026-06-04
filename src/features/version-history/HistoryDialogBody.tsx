/**
 * HistoryDialogBody — interior of the version-history dialog.
 *
 * Owns selection state (which version is active in the right pane) and
 * the revert-confirm flow. Rail + pane rendering is delegated to
 * `VersionRail` / `VersionPane` so this file stays under the 150-line
 * frontend guideline.
 */

import { useEffect, useState, type ReactElement } from "react";

import { ConfirmDialog } from "@shared/ui";
import { useToast } from "@shared/lib";

import {
  useRevertVersion,
  useVersionHistoryDetail,
  useVersionHistoryList,
  type HistoryKind,
} from "./useVersionHistory";
import { VersionPane } from "./VersionPane";
import { VersionRail } from "./VersionRail";

import styles from "./HistoryViewerButton.module.css";

export interface HistoryDialogBodyProps {
  kind: HistoryKind;
  sourceId: string;
  /** Current entity content used for the right-pane diff. */
  currentContent: string;
  /** Stable testid prefix from the trigger button. */
  testIdPrefix: string;
  /** Closes the dialog (e.g. after a successful revert). */
  onClose: () => void;
}

export function HistoryDialogBody({
  kind,
  sourceId,
  currentContent,
  testIdPrefix,
  onClose,
}: HistoryDialogBodyProps): ReactElement {
  const list = useVersionHistoryList(kind, sourceId);
  const { pushToast } = useToast();
  const [selectedId, setSelectedId] = useState<string>("");
  const [pendingRevertId, setPendingRevertId] = useState<string | null>(null);

  // Pick the newest row by default once the list resolves. Effect (not
  // inline state-write) keeps the render pass pure.
  useEffect(() => {
    if (
      selectedId === "" &&
      list.status === "success" &&
      list.data !== undefined &&
      list.data.length > 0
    ) {
      setSelectedId(list.data[0].id);
    }
  }, [list.status, list.data, selectedId]);

  const detail = useVersionHistoryDetail(kind, selectedId);
  const revert = useRevertVersion(kind, sourceId, {
    onSuccess: () => {
      pushToast("success", "Reverted to selected version");
      setPendingRevertId(null);
      onClose();
    },
    onError: (err) =>
      pushToast("error", `Revert failed: ${err.message}`),
  });

  if (list.status === "pending") {
    return (
      <div
        className={styles.skeletonList}
        data-testid={`${testIdPrefix}-loading`}
      >
        <div className={styles.skeletonRow} />
        <div className={styles.skeletonRow} />
        <div className={styles.skeletonRow} />
      </div>
    );
  }

  if (list.status === "error") {
    return (
      <div
        className={styles.emptyState}
        role="alert"
        data-testid={`${testIdPrefix}-error`}
      >
        <p>Failed to load version history.</p>
        <p>{list.error?.message ?? "Unknown error"}</p>
      </div>
    );
  }

  const versions = list.data ?? [];
  if (versions.length === 0) {
    return (
      <div
        className={styles.emptyState}
        data-testid={`${testIdPrefix}-empty`}
      >
        <p>No version history yet.</p>
        <p>Edits to this content will appear here once you save them.</p>
      </div>
    );
  }

  // Fall back to the row content while detail loads — no flash-of-pending.
  const previewSource: string =
    detail.status === "success" && detail.data !== undefined
      ? detail.data.content
      : (versions.find((v) => v.id === selectedId)?.content ?? "");

  return (
    <>
      <div className={styles.layout} data-testid={`${testIdPrefix}-layout`}>
        <VersionRail
          rows={versions}
          selectedId={selectedId}
          onSelect={setSelectedId}
          onRevertRequest={setPendingRevertId}
          testIdPrefix={testIdPrefix}
        />
        <VersionPane
          previewSource={previewSource}
          currentContent={currentContent}
          testIdPrefix={testIdPrefix}
          onClose={onClose}
        />
      </div>
      <ConfirmDialog
        isOpen={pendingRevertId !== null}
        title="Revert to this version?"
        description="The current content will be snapshotted before the revert, so you can undo it from this same history."
        confirmLabel="Revert"
        onCancel={() => setPendingRevertId(null)}
        onConfirm={() => {
          if (pendingRevertId !== null) revert.trigger(pendingRevertId);
        }}
        isPending={revert.isPending}
        data-testid={`${testIdPrefix}-revert-confirm`}
      />
    </>
  );
}
