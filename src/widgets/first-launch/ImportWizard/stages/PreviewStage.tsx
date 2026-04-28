/**
 * PreviewStage — wizard step 2.
 *
 * Runs `import_from_promptery({ dryRun: true })` on mount and shows
 * the resulting `ImportReport` so the user can audit what would
 * happen. Three render branches:
 *
 *   - In flight → spinner + "Анализирую данные…".
 *   - Success   → row-count + attachment summary + per-PF table.
 *   - Failure   → red banner + (when available) per-PF reasons.
 *
 * The dry-run is destructive only inside `.import-tmp/`; preflight
 * results carry over from this run to the real import via the host
 * (the host requests a fresh dry-run anyway when re-entering the
 * stage, so we don't try to share state between runs).
 */

import { useEffect, useState, type ReactElement } from "react";

import { Button } from "@shared/ui";
import { invoke } from "@shared/api";
import type { ImportReport } from "@bindings/ImportReport";
import type { PreflightResults } from "@bindings/PreflightResults";

import { strings } from "../../strings";
import { formatBytes, formatCount } from "../../format";
import styles from "../ImportWizard.module.css";

export interface PreviewStageProps {
  /** Source path or `undefined` to use the default `~/.promptery/db.sqlite`. */
  sourcePath?: string;
  /** "Run import for real" → host advances to RunningStage. */
  onConfirm: (dryRunReport: ImportReport) => void;
  /** "Cancel" — host moves back to DetectionStage. */
  onBack: () => void;
}

type DryRunState =
  | { status: "running" }
  | { status: "ok"; report: ImportReport }
  | { status: "error"; message: string; partialReport?: ImportReport };

export function PreviewStage({
  sourcePath,
  onConfirm,
  onBack,
}: PreviewStageProps): ReactElement {
  const [state, setState] = useState<DryRunState>({ status: "running" });

  useEffect(() => {
    let cancelled = false;
    const args: Record<string, unknown> = {
      options: { dryRun: true, overwriteExisting: false },
    };
    if (sourcePath !== undefined) args["sourcePath"] = sourcePath;

    (async () => {
      try {
        const report = await invoke<ImportReport>(
          "import_from_promptery",
          args,
        );
        if (cancelled) return;
        if (report.error !== null) {
          setState({
            status: "error",
            message: report.error,
            partialReport: report,
          });
          return;
        }
        setState({ status: "ok", report });
      } catch (raw) {
        if (cancelled) return;
        const message =
          raw instanceof Error
            ? raw.message
            : typeof raw === "string"
              ? raw
              : "Неизвестная ошибка предпросмотра.";
        setState({ status: "error", message });
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [sourcePath]);

  return (
    <div className={styles.body} data-testid="import-stage-preview">
      <div>
        <h2 className={styles.title}>{strings.importWizard.preview.title}</h2>
      </div>

      {state.status === "running" ? (
        <p className={styles.runningHint} aria-live="polite">
          {strings.importWizard.preview.analyzing}
        </p>
      ) : null}

      {state.status === "ok" ? (
        <ReportSummary report={state.report} />
      ) : null}

      {state.status === "error" ? (
        <div
          className={`${styles.banner} ${styles.bannerError}`}
          role="alert"
        >
          <div>
            <strong>{strings.importWizard.preview.failureTitle}</strong>
            <div>{state.message}</div>
            {state.partialReport ? (
              <PreflightTable preflight={state.partialReport.preflight} />
            ) : null}
          </div>
        </div>
      ) : null}

      <div className={styles.actions}>
        <Button variant="ghost" onPress={onBack} data-testid="preview-back">
          {strings.importWizard.preview.backCta}
        </Button>
        <Button
          variant="primary"
          isDisabled={state.status !== "ok"}
          onPress={() => {
            if (state.status === "ok") onConfirm(state.report);
          }}
          data-testid="preview-confirm"
        >
          {strings.importWizard.preview.runImportCta}
        </Button>
      </div>
    </div>
  );
}

interface ReportSummaryProps {
  report: ImportReport;
}

/**
 * Per-table row counts + attachments summary + preflight table.
 * Pure presentational — exported only inline as it's not reused.
 */
function ReportSummary({ report }: ReportSummaryProps): ReactElement {
  // BTreeMap from Rust → JS object preserves insertion order; the
  // Rust side sorts the keys alphabetically before serialising.
  const rows = Object.entries(report.rowsImported);

  return (
    <div className={styles.body}>
      <h3 style={{ margin: 0 }}>{strings.importWizard.preview.analyzedTitle}</h3>
      <dl className={styles.kvTable}>
        {rows.map(([table, count]) => (
          <RowEntry key={table} label={table} value={formatCount(count)} />
        ))}
        <RowEntry
          label={strings.importWizard.preview.attachmentsLabel}
          value={formatCount(report.attachmentsCopied)}
        />
        <RowEntry
          label={strings.importWizard.preview.attachmentsTotalLabel}
          value={formatBytes(report.attachmentsTotalBytes)}
        />
      </dl>

      <PreflightTable preflight={report.preflight} />
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

interface PreflightTableProps {
  preflight: PreflightResults;
}

/**
 * Per-PF row table. The PF result struct ships ten boolean fields and
 * a `messages` map keyed by `"PF-1"`..`"PF-10"`. We render them in
 * order with the matching message (if any) — failed rows show in red.
 */
function PreflightTable({ preflight }: PreflightTableProps): ReactElement {
  const order: Array<{
    key: string;
    field: keyof PreflightResults;
    label: string;
  }> = [
    { key: "PF-1", field: "pf1SourceExists", label: "Source DB readable" },
    { key: "PF-2", field: "pf2IntegrityOk", label: "Integrity check" },
    { key: "PF-3", field: "pf3QuickCheckOk", label: "Quick check + FTS" },
    { key: "PF-4", field: "pf4SchemaHashOk", label: "Schema hash matches" },
    { key: "PF-5", field: "pf5TargetWritable", label: "Target writable" },
    { key: "PF-6", field: "pf6DiskSpaceOk", label: "Disk space ≥ 2× source" },
    { key: "PF-7", field: "pf7SourceLockOk", label: "Source lock acquired" },
    { key: "PF-8", field: "pf8ForeignKeysOn", label: "Foreign keys enabled" },
    {
      key: "PF-9",
      field: "pf9TargetEmptyOrOverwrite",
      label: "Target empty or overwrite",
    },
    {
      key: "PF-10",
      field: "pf10AttachmentsReadable",
      label: "Attachments readable",
    },
  ];

  const allOk = order.every((row) => preflight[row.field] === true);

  return (
    <div>
      <h3 style={{ margin: "var(--space-12) 0 var(--space-4)" }}>
        {strings.importWizard.preview.preflightTitle}
      </h3>
      <p
        className={
          allOk ? styles.statusOk : styles.statusFail
        }
        role="status"
      >
        {allOk
          ? `✓ ${strings.importWizard.preview.preflightOk}`
          : `⨯ ${strings.importWizard.preview.preflightFailed}`}
      </p>
      <ul className={styles.checkList}>
        {order.map(({ key, field, label }) => {
          const ok = preflight[field] === true;
          const message = preflight.messages[key] ?? "";
          return (
            <li
              key={key}
              className={styles.checkItem}
              data-state={ok ? "ok" : "fail"}
            >
              <span className={styles.checkLabel}>
                {key} — {label}
              </span>
              {message ? (
                <span className={styles.checkMessage}>({message})</span>
              ) : null}
            </li>
          );
        })}
      </ul>
    </div>
  );
}
