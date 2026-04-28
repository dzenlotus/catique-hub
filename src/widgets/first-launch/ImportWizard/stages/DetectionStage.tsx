/**
 * DetectionStage — wizard step 1.
 *
 * Renders the metadata returned by Olga's `detect_promptery_db` IPC:
 * absolute path, file size, last-modified timestamp, tasks row-count
 * and a schema-match indicator. The schema indicator is the gate —
 * if Promptery's schema doesn't match what Olga's import code expects,
 * the user can't safely continue and we surface the warning + disable
 * the "Continue" button.
 *
 * The "tasksCount" field is `null` when the source DB is unreadable;
 * we render an em-dash in that branch.
 *
 * Props are explicit (no internal IPC) — the wizard host fetches
 * detection info once and passes it through. Keeps this stage pure
 * and trivially storyboardable.
 */

import type { ReactElement } from "react";

import { Button } from "@shared/ui";
import type { PrompteryDbInfo } from "@bindings/PrompteryDbInfo";

import { strings } from "../../strings";
import { formatBytes, formatTimestamp, formatCount } from "../../format";
import styles from "../ImportWizard.module.css";

export interface DetectionStageProps {
  /** Result of `detect_promptery_db` — never `null` here (host gates). */
  info: PrompteryDbInfo;
  /**
   * Whether the source schema matches the version Catique was built
   * against. Computed by the host from `EXPECTED_SOURCE_SCHEMA_HASH`
   * because the IPC doesn't expose the expected hash directly — for
   * E4.1 we trust the hash field length + downstream preflight to
   * surface drift. Defaults to `true`.
   */
  schemaMatch?: boolean;
  /** "Continue" — go to PreviewStage. */
  onContinue: () => void;
  /** "Skip" — close wizard, go to WelcomeWidget. */
  onSkip: () => void;
}

export function DetectionStage({
  info,
  schemaMatch = true,
  onContinue,
  onSkip,
}: DetectionStageProps): ReactElement {
  return (
    <div className={styles.body} data-testid="import-stage-detection">
      <div>
        <h2 className={styles.title}>{strings.importWizard.detection.title}</h2>
        <p className={styles.subtitle}>
          {strings.importWizard.detection.subtitle}
        </p>
      </div>

      <dl className={styles.kvTable}>
        <dt className={styles.kvLabel}>
          {strings.importWizard.detection.pathLabel}
        </dt>
        <dd className={`${styles.kvValue} ${styles.kvMono}`}>{info.path}</dd>

        <dt className={styles.kvLabel}>
          {strings.importWizard.detection.sizeLabel}
        </dt>
        <dd className={styles.kvValue}>{formatBytes(info.sizeBytes)}</dd>

        <dt className={styles.kvLabel}>
          {strings.importWizard.detection.lastModifiedLabel}
        </dt>
        <dd className={styles.kvValue}>{formatTimestamp(info.lastModifiedMs)}</dd>

        <dt className={styles.kvLabel}>
          {strings.importWizard.detection.tasksCountLabel}
        </dt>
        <dd className={styles.kvValue}>{formatCount(info.tasksCount)}</dd>
      </dl>

      {schemaMatch ? (
        <p className={styles.statusOk} role="status">
          ✓ {strings.importWizard.detection.schemaMatchOk}
        </p>
      ) : (
        <p className={styles.statusWarn} role="alert">
          ⚠ {strings.importWizard.detection.schemaMatchDrift}
        </p>
      )}

      <div className={styles.actions}>
        <Button variant="ghost" onPress={onSkip} data-testid="detection-skip">
          {strings.importWizard.detection.skipCta}
        </Button>
        <Button
          variant="primary"
          onPress={onContinue}
          isDisabled={!schemaMatch}
          data-testid="detection-continue"
        >
          {strings.importWizard.detection.continueCta}
        </Button>
      </div>
    </div>
  );
}
