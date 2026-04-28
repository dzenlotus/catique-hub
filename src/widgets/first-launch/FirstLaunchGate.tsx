/**
 * FirstLaunchGate — wraps the rest of the app and decides between
 * three render branches per `useFirstLaunchCheck`:
 *
 *   1. loading    → skeleton/spinner shell.
 *   2. has data   → render `children` (BoardsList / Kanban etc).
 *   3. no data + Promptery DB found → render `<ImportWizard />`. The
 *      `children` tree stays mounted-but-hidden via `display: none`
 *      so closing the wizard returns the user to existing react-query
 *      state without remounting widgets and refetching.
 *   4. no data + no Promptery       → render `<WelcomeWidget />`.
 *
 * The Welcome flow can re-route into the wizard with an explicit
 * `source_path` arg (e.g. user manually located their Promptery DB).
 * That hand-off is mediated by local state (`manualSource`) so we
 * stay inside this component instead of round-tripping through
 * react-query — the Welcome widget's "Locate Promptery DB" CTA
 * unconditionally lands us in the wizard's RunningStage with the
 * picked path.
 */

import { useState, type PropsWithChildren, type ReactElement } from "react";

import { useFirstLaunchCheck } from "@shared/lib";
import { useQueryClient } from "@tanstack/react-query";

import { ImportWizard } from "./ImportWizard";
import { WelcomeWidget } from "./WelcomeWidget";
import { strings } from "./strings";
import { spacesKeys, prompteryDetectKeys } from "@shared/lib";

import styles from "./FirstLaunchGate.module.css";

interface Props extends PropsWithChildren {
  /**
   * Override flag — when set the gate skips its own check entirely
   * and renders the children. Useful in Storybook / tests where we
   * don't want IPC to gate on every render.
   */
  bypass?: boolean;
}

/**
 * Top-level branch component. See module-level doc.
 */
export function FirstLaunchGate({
  children,
  bypass = false,
}: Props): ReactElement {
  // Short-circuit BEFORE any hook runs — `useFirstLaunchCheck` would
  // fire `list_spaces` on mount regardless of whether we render its
  // result, defeating the bypass flag. Returning early here is the
  // simplest way; the hook order is stable because the caller always
  // passes the same boolean (bypass is configuration, not state).
  if (bypass) return <>{children}</>;

  return <FirstLaunchGateBody>{children}</FirstLaunchGateBody>;
}

function FirstLaunchGateBody({
  children,
}: PropsWithChildren): ReactElement {
  const check = useFirstLaunchCheck();
  const qc = useQueryClient();

  // Manual override: when the user picks a Promptery file from the
  // Welcome screen, we drop them straight into the wizard with the
  // explicit path. Cleared once they finish or skip.
  const [manualSource, setManualSource] = useState<string | null>(null);

  const handleImportFinished = async (): Promise<void> => {
    setManualSource(null);
    // The data underneath us has just been swapped — explicitly
    // refetch so the gate transitions to "has data" without waiting
    // for the import.completed event-handler in EventsProvider.
    await qc.invalidateQueries({ queryKey: spacesKeys.all });
    await qc.invalidateQueries({ queryKey: prompteryDetectKeys.all });
    await check.refetch();
  };

  const handleImportSkipped = async (): Promise<void> => {
    setManualSource(null);
    // Re-detect — user may have removed/moved the source DB during
    // the wizard's lifetime; nothing to lose by refreshing.
    await check.refetch();
  };

  if (check.error) {
    return (
      <div className={styles.shell}>
        <div className={styles.errorPanel} role="alert">
          <p className={styles.errorMessage}>
            Catique HUB не смог проверить состояние базы:{" "}
            {check.error.message}
          </p>
        </div>
      </div>
    );
  }

  if (check.isLoading) {
    return (
      <div className={styles.shell}>
        <div className={styles.loading} aria-busy="true">
          <div className={styles.spinner} aria-hidden="true" />
          <h2 className={styles.loadingTitle}>{strings.gate.loadingTitle}</h2>
          <p className={styles.loadingHint}>{strings.gate.loadingHint}</p>
        </div>
      </div>
    );
  }

  // Returning user — has data. Render children unmodified.
  if (!check.isFirstLaunch) {
    return <>{children}</>;
  }

  // First-launch: decide between import wizard and welcome screen.
  const showWizard =
    manualSource !== null ||
    (check.prompteryDb !== null && check.prompteryDb !== undefined);

  if (showWizard) {
    return (
      <div className={styles.shell}>
        {/* Children stay mounted-but-hidden so react-query state is
            preserved when the wizard closes. */}
        <div className={styles.childrenHidden} aria-hidden="true">
          {children}
        </div>
        <ImportWizard
          {...(check.prompteryDb ? { detected: check.prompteryDb } : {})}
          {...(manualSource ? { sourcePath: manualSource } : {})}
          onCompleted={() => {
            void handleImportFinished();
          }}
          onSkipped={() => {
            void handleImportSkipped();
          }}
        />
      </div>
    );
  }

  // No Promptery DB found — welcome screen.
  return (
    <div className={styles.shell}>
      <div className={styles.childrenHidden} aria-hidden="true">
        {children}
      </div>
      <WelcomeWidget
        onCreatedSpace={() => {
          void check.refetch();
        }}
        onLocatedPromptery={(path) => {
          setManualSource(path);
        }}
      />
    </div>
  );
}
