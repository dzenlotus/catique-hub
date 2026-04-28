/**
 * CompletedStage — wizard step 4 (success path).
 *
 * Renders a green banner + a row-by-row summary of what was
 * imported. The single CTA closes the wizard and asks the host to
 * navigate the app to BoardsList. We DO NOT auto-close after a
 * timer — desktop UX should let the user read the report.
 */

import type { ReactElement } from "react";

import { Button } from "@shared/ui";
import type { ImportReport } from "@bindings/ImportReport";

import { strings } from "../../strings";
import { formatCount } from "../../format";
import styles from "../ImportWizard.module.css";

export interface CompletedStageProps {
  report: ImportReport;
  onOpenKanban: () => void;
}

export function CompletedStage({
  report,
  onOpenKanban,
}: CompletedStageProps): ReactElement {
  const summaryRows: Array<{ label: string; value: string }> = [
    {
      label: "spaces",
      value: formatCount(report.rowsImported["spaces"] ?? 0n),
    },
    {
      label: "boards",
      value: formatCount(report.rowsImported["boards"] ?? 0n),
    },
    {
      label: "tasks",
      value: formatCount(report.rowsImported["tasks"] ?? 0n),
    },
    {
      label: "prompts",
      value: formatCount(report.rowsImported["prompts"] ?? 0n),
    },
  ];

  return (
    <div className={styles.body} data-testid="import-stage-completed">
      <p
        className={`${styles.banner} ${styles.bannerSuccess}`}
        role="status"
      >
        ✓ {strings.importWizard.completed.titlePrefix}{" "}
        {Number(report.durationMs).toLocaleString("ru-RU")}{" "}
        {strings.importWizard.completed.titleSuffix}
      </p>

      <h3 style={{ margin: 0 }}>
        {strings.importWizard.completed.summaryHeader}
      </h3>
      <dl className={styles.kvTable}>
        {summaryRows.map((row) => (
          <RowEntry key={row.label} label={row.label} value={row.value} />
        ))}
      </dl>

      {report.commitPath ? (
        <dl className={styles.kvTable}>
          <dt className={styles.kvLabel}>
            {strings.importWizard.completed.backupLabel}
          </dt>
          <dd className={`${styles.kvValue} ${styles.kvMono}`}>
            {report.commitPath}
          </dd>
        </dl>
      ) : null}

      <div className={styles.actions}>
        <Button
          variant="primary"
          onPress={onOpenKanban}
          data-testid="completed-open-kanban"
        >
          {strings.importWizard.completed.openKanbanCta}
        </Button>
      </div>
    </div>
  );
}

function RowEntry({
  label,
  value,
}: {
  label: string;
  value: string;
}): ReactElement {
  return (
    <>
      <dt className={styles.kvLabel}>{label}</dt>
      <dd className={styles.kvValue}>{value}</dd>
    </>
  );
}
