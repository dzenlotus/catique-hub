/**
 * RunningStage — wizard step 3.
 *
 * Fires the real `import_from_promptery({ dryRun: false })` once on
 * mount and listens for `import.started` / `import.progress` /
 * `import.completed` / `import.failed` events through Katya's typed
 * `on()` wrapper. The IPC promise itself also resolves with the
 * `ImportReport`, but we additionally subscribe to events so the
 * progress bar can react to phase changes if Olga ever wires fine-
 * grained `import.progress` payloads (currently reserved for E5).
 *
 * The cancellation rule comes from D-027: the import flow ends with
 * an atomic file rename, so once it starts we cannot abort safely.
 * The UI hides the close affordance and shows a clear notice.
 */

import { useEffect, useRef, useState, type ReactElement } from "react";

import { invoke, on } from "@shared/api";
import type { AppEventPayload } from "@shared/api";
import type { ImportReport } from "@bindings/ImportReport";
import type { UnlistenFn } from "@tauri-apps/api/event";

import { strings } from "../../strings";
import styles from "../ImportWizard.module.css";

export interface RunningStageProps {
  /** Optional `source_path` override; `undefined` → default location. */
  sourcePath?: string;
  /** Called with the final report once the IPC resolves. */
  onCompleted: (report: ImportReport) => void;
  /** Called with the error once the IPC rejects. */
  onFailed: (kind: string, message: string) => void;
}

type Phase = AppEventPayload<"import.progress">["phase"] | null;

export function RunningStage({
  sourcePath,
  onCompleted,
  onFailed,
}: RunningStageProps): ReactElement {
  const [phase, setPhase] = useState<Phase>(null);
  const [percent, setPercent] = useState<number | null>(null);
  // Track whether we should honour reduced-motion. Computed once on
  // mount (the user's setting can flip mid-import in theory but the
  // window won't re-query it, and that's fine for a wizard).
  const reducedMotionRef = useRef<boolean>(
    typeof window !== "undefined" &&
      typeof window.matchMedia === "function" &&
      window.matchMedia("(prefers-reduced-motion: reduce)").matches,
  );

  useEffect(() => {
    const unlisteners: UnlistenFn[] = [];
    let cancelled = false;

    // Listener registration is async; if cleanup fires before the
    // promise resolves we mark the registration as `cancelled` and
    // call the unlistener as soon as it's available. Tracking each
    // pending promise's `.then` separately (vs. a shared `pending`
    // array) avoids the double-unlisten race we'd hit with a single
    // for-loop over `pending` after `unlisteners` was already drained.
    const collect = (p: Promise<UnlistenFn>): void => {
      p.then((fn) => {
        if (cancelled) {
          fn();
          return;
        }
        unlisteners.push(fn);
      }).catch(() => {
        // Listener registration failed — no-op; if Tauri is down,
        // the IPC invoke below will reject too and surface the error.
      });
    };

    collect(
      on("import.started", () => {
        if (cancelled) return;
        // Reset phase once the back-end confirms start so a stale
        // progress event from a previous run can't leak in.
        setPhase(null);
        setPercent(null);
      }),
    );

    collect(
      on("import.progress", (payload) => {
        if (cancelled) return;
        setPhase(payload.phase);
        // Clamp to [0, 100] defensively; the Rust side is supposed
        // to do this but trusting `unknown` floats is asking for it.
        const p = Math.max(0, Math.min(100, payload.percent));
        setPercent(p);
      }),
    );

    // Note: import.completed/failed are also emitted, but we rely on
    // the IPC promise's resolution / rejection as the source of truth
    // for advancing the wizard — the events here are just hints for
    // EventsProvider's cache invalidation.

    const args: Record<string, unknown> = {
      options: { dryRun: false, overwriteExisting: false },
    };
    if (sourcePath !== undefined) args["sourcePath"] = sourcePath;

    invoke<ImportReport>("import_from_promptery", args)
      .then((report) => {
        if (cancelled) return;
        if (report.error !== null) {
          onFailed("import", report.error);
          return;
        }
        onCompleted(report);
      })
      .catch((raw) => {
        if (cancelled) return;
        if (raw && typeof raw === "object" && "kind" in raw) {
          const kind = String((raw as { kind: unknown }).kind);
          // `AppError`-shaped rejection — the JSON has a `data` field
          // but the user-facing message lives at the top level
          // (Rust derives Display). Fall back to JSON.stringify so we
          // don't silently swallow context.
          const message =
            "data" in raw &&
            raw.data &&
            typeof raw.data === "object" &&
            "reason" in raw.data
              ? String((raw.data as { reason: unknown }).reason)
              : JSON.stringify(raw);
          onFailed(kind, message);
          return;
        }
        const message =
          raw instanceof Error
            ? raw.message
            : typeof raw === "string"
              ? raw
              : "Неизвестная ошибка импорта.";
        onFailed("unknown", message);
      });

    return () => {
      cancelled = true;
      for (const fn of unlisteners) fn();
    };
  }, [sourcePath, onCompleted, onFailed]);

  const isReducedMotion = reducedMotionRef.current;
  const determinate = percent !== null;

  return (
    <div className={styles.body} data-testid="import-stage-running">
      <div>
        <h2 className={styles.title}>{strings.importWizard.running.title}</h2>
        <p className={styles.subtitle}>
          {isReducedMotion
            ? strings.importWizard.running.hintReducedMotion
            : strings.importWizard.running.hint}
        </p>
      </div>

      <div
        className={styles.progress}
        role="progressbar"
        aria-busy="true"
        aria-valuemin={0}
        aria-valuemax={100}
        {...(determinate ? { "aria-valuenow": percent ?? 0 } : {})}
        {...(determinate
          ? {}
          : { "aria-label": strings.importWizard.running.progressFallback })}
        data-testid="import-progress-bar"
      >
        {determinate ? (
          <div
            className={styles.progressDeterminate}
            style={{ width: `${percent ?? 0}%` }}
          />
        ) : (
          <div className={styles.progressIndeterminate} />
        )}
      </div>

      <p className={styles.runningHint} aria-live="polite">
        {phase
          ? `${strings.importWizard.running.progressPhasePrefix} ${phase}`
          : strings.importWizard.running.progressFallback}
      </p>

      <p className={styles.preflightHint}>
        {strings.importWizard.running.noCancelHint}
      </p>
    </div>
  );
}
