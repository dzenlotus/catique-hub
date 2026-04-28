/**
 * ImportWizard — orchestrates the four-stage import flow.
 *
 * Stages: detection → preview → running → completed | failed.
 * Stage transitions are local component state; the wizard only
 * surfaces "completed" / "skipped" callbacks to its parent
 * (`FirstLaunchGate`), which handles the actual app navigation.
 *
 * Initial stage:
 *   - When the wizard is opened with `detected` (the default Promptery
 *     auto-discovery branch), we start at DetectionStage so the user
 *     can review the source DB before continuing.
 *   - When the wizard is opened with only `sourcePath` (the manual
 *     locate-Promptery path from WelcomeWidget), we skip detection
 *     and jump straight to PreviewStage — the user already chose
 *     this file, no need to re-confirm path/size.
 *
 * Esc key:
 *   - On safe stages (detection, preview, completed, failed) Esc
 *     triggers `onSkipped`, mirroring the brief's "Esc cancels at
 *     safe stages" requirement.
 *   - On running stage Esc is intercepted and ignored — atomic
 *     rename means there's nothing to cancel.
 *
 * TODO(E4.x): expose import in app menu — once Settings lives, add
 * a "Re-run import" entry that mounts this wizard programmatically.
 */

import { useEffect, useState, type ReactElement } from "react";

import type { ImportReport } from "@bindings/ImportReport";
import type { PreflightResults } from "@bindings/PreflightResults";
import type { PrompteryDbInfo } from "@bindings/PrompteryDbInfo";

import { strings } from "../strings";
import { DetectionStage } from "./stages/DetectionStage";
import { PreviewStage } from "./stages/PreviewStage";
import { RunningStage } from "./stages/RunningStage";
import { CompletedStage } from "./stages/CompletedStage";
import { FailedStage } from "./stages/FailedStage";

import styles from "./ImportWizard.module.css";

export interface ImportWizardProps {
  /** Detected info from `detect_promptery_db`. Optional when `sourcePath` is set. */
  detected?: PrompteryDbInfo;
  /** Manually-picked source path (Welcome → locate flow). */
  sourcePath?: string;
  /** Called once the import succeeds and the user opts to leave. */
  onCompleted: () => void;
  /** Called when the user skips out (any stage). */
  onSkipped: () => void;
  /**
   * Test-only: forces the initial stage. Lets the unit tests assert
   * each stage in isolation without orchestrating IPC. Production
   * callers leave this undefined.
   */
  initialStage?: WizardStage;
}

type WizardStage =
  | "detection"
  | "preview"
  | "running"
  | "completed"
  | "failed";

interface FailureState {
  kind: string;
  message: string;
  preflight?: PreflightResults;
}

/** Heuristic — schema mismatch trips when the schemaHash field is empty. */
function isSchemaMatch(info: PrompteryDbInfo | undefined): boolean {
  if (!info) return true;
  return info.schemaHash.length > 0;
}

export function ImportWizard({
  detected,
  sourcePath,
  onCompleted,
  onSkipped,
  initialStage,
}: ImportWizardProps): ReactElement {
  // Default initial stage: detection if we have detection info,
  // otherwise jump straight to preview (manual-locate path).
  const initial: WizardStage =
    initialStage ?? (detected ? "detection" : "preview");
  const [stage, setStage] = useState<WizardStage>(initial);
  const [report, setReport] = useState<ImportReport | null>(null);
  const [failure, setFailure] = useState<FailureState | null>(null);

  const safeForEscape =
    stage === "detection" ||
    stage === "preview" ||
    stage === "completed" ||
    stage === "failed";

  // Keyboard handling — Esc closes the wizard at safe stages. We
  // attach the listener to `document` because the wizard is a fixed
  // panel without a single focusable owner; Tab order is otherwise
  // managed by RAC inside each stage's buttons.
  useEffect(() => {
    if (!safeForEscape) return;
    const handler = (e: KeyboardEvent): void => {
      if (e.key !== "Escape") return;
      e.preventDefault();
      onSkipped();
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [safeForEscape, onSkipped]);

  return (
    <section
      className={styles.shell}
      role="region"
      aria-label={strings.importWizard.detection.title}
      data-testid="import-wizard"
      data-stage={stage}
    >
      {stage === "detection" && detected ? (
        <DetectionStage
          info={detected}
          schemaMatch={isSchemaMatch(detected)}
          onContinue={() => setStage("preview")}
          onSkip={onSkipped}
        />
      ) : null}

      {stage === "preview" ? (
        <PreviewStage
          {...(sourcePath !== undefined ? { sourcePath } : {})}
          onConfirm={() => setStage("running")}
          onBack={() => {
            // If we entered via manual-locate (no detection info),
            // there's no detection stage to go back to — fall through
            // to skip instead.
            if (detected) {
              setStage("detection");
            } else {
              onSkipped();
            }
          }}
          onSkip={onSkipped}
        />
      ) : null}

      {stage === "running" ? (
        <RunningStage
          {...(sourcePath !== undefined ? { sourcePath } : {})}
          onCompleted={(r) => {
            setReport(r);
            setStage("completed");
          }}
          onFailed={(kind, message) => {
            setFailure({ kind, message });
            setStage("failed");
          }}
        />
      ) : null}

      {stage === "completed" && report ? (
        <CompletedStage report={report} onOpenKanban={onCompleted} />
      ) : null}

      {stage === "failed" && failure ? (
        <FailedStage
          kind={failure.kind}
          message={failure.message}
          {...(failure.preflight ? { preflight: failure.preflight } : {})}
          onRetry={() => {
            setFailure(null);
            // Manual-locate flow has no detection stage; go to preview
            // to re-attempt the dry-run.
            setStage(detected ? "detection" : "preview");
          }}
          onSkip={onSkipped}
        />
      ) : null}
    </section>
  );
}

export type { WizardStage };
