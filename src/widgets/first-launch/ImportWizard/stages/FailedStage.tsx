/**
 * FailedStage — wizard step 4 (error path).
 *
 * Surfaces the error kind + message returned by the IPC. When a
 * partial report is available, we render the per-PF table so the
 * user can see exactly which preflight check tripped.
 *
 * Two CTAs: "Retry" (back to DetectionStage) and "Skip — start fresh"
 * (close wizard, the host falls through to WelcomeWidget).
 */

import type { ReactElement } from "react";
import { RefreshCw, X } from "lucide-react";

import { Button } from "@shared/ui";
import type { PreflightResults } from "@bindings/PreflightResults";

import { strings } from "../../strings";
import styles from "../ImportWizard.module.css";

export interface FailedStageProps {
  /** AppError discriminator (e.g. "validation", "dbBusy"). */
  kind: string;
  /** Human-readable error text. */
  message: string;
  /** Optional preflight results (when the failure had one). */
  preflight?: PreflightResults;
  /** "Retry" — host advances back to DetectionStage. */
  onRetry: () => void;
  /** "Skip — start fresh" — close wizard. */
  onSkip: () => void;
}

export function FailedStage({
  kind,
  message,
  preflight,
  onRetry,
  onSkip,
}: FailedStageProps): ReactElement {
  return (
    <div className={styles.body} data-testid="import-stage-failed">
      <p className={`${styles.banner} ${styles.bannerError}`} role="alert">
        ⚠ {strings.importWizard.failed.title}
      </p>

      <dl className={styles.kvTable}>
        <dt className={styles.kvLabel}>
          {strings.importWizard.failed.kindLabel}
        </dt>
        <dd className={styles.kvValue}>{kind}</dd>
        <dt className={styles.kvLabel}>
          {strings.importWizard.failed.messageLabel}
        </dt>
        <dd className={styles.kvValue}>{message}</dd>
      </dl>

      {preflight ? <PreflightSnapshot preflight={preflight} /> : null}

      <div className={styles.actions}>
        <Button variant="ghost" onPress={onSkip} data-testid="failed-skip">
          <span style={{ display: "inline-flex", alignItems: "center", gap: "var(--space-6)" }}>
            <X size={14} aria-hidden="true" />
            {strings.importWizard.failed.skipCta}
          </span>
        </Button>
        <Button
          variant="primary"
          onPress={onRetry}
          data-testid="failed-retry"
        >
          <span style={{ display: "inline-flex", alignItems: "center", gap: "var(--space-6)" }}>
            <RefreshCw size={14} aria-hidden="true" />
            {strings.importWizard.failed.retryCta}
          </span>
        </Button>
      </div>
    </div>
  );
}

interface PreflightSnapshotProps {
  preflight: PreflightResults;
}

function PreflightSnapshot({ preflight }: PreflightSnapshotProps): ReactElement {
  const order: Array<{ key: string; field: keyof PreflightResults }> = [
    { key: "PF-1", field: "pf1SourceExists" },
    { key: "PF-2", field: "pf2IntegrityOk" },
    { key: "PF-3", field: "pf3QuickCheckOk" },
    { key: "PF-4", field: "pf4SchemaHashOk" },
    { key: "PF-5", field: "pf5TargetWritable" },
    { key: "PF-6", field: "pf6DiskSpaceOk" },
    { key: "PF-7", field: "pf7SourceLockOk" },
    { key: "PF-8", field: "pf8ForeignKeysOn" },
    { key: "PF-9", field: "pf9TargetEmptyOrOverwrite" },
    { key: "PF-10", field: "pf10AttachmentsReadable" },
  ];
  return (
    <div>
      <h3 style={{ margin: "var(--space-12) 0 var(--space-4)" }}>
        {strings.importWizard.failed.preflightHeader}
      </h3>
      <ul className={styles.checkList}>
        {order.map(({ key, field }) => {
          const ok = preflight[field] === true;
          const message = preflight.messages[key] ?? "";
          return (
            <li
              key={key}
              className={styles.checkItem}
              data-state={ok ? "ok" : "fail"}
            >
              <span className={styles.checkLabel}>{key}</span>
              {message ? (
                <span className={styles.checkMessage}>{message}</span>
              ) : null}
            </li>
          );
        })}
      </ul>
    </div>
  );
}
