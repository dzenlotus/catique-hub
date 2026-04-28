/**
 * WelcomeWidget — shown when there's no local data and no Promptery
 * DB to import from. Hands the user two paths:
 *
 *   1. **Create your first space** — open a small dialog asking for
 *      `name` + 3-letter `prefix`, call `create_space`, and let the
 *      spaces query refetch (which exits the FirstLaunchGate
 *      naturally because the DB now has a space).
 *   2. **Locate Promptery DB** — open a small dialog asking the user
 *      to paste an absolute path. We DO NOT wire `tauri-plugin-dialog`
 *      here for E4.1 — the file-picker plugin would require Rust dep
 *      changes (Cargo.toml, capabilities/default.json, lib.rs); per
 *      the brief that's coordinated with Katya in a follow-up. The
 *      text-input stub is functionally equivalent for the rare case
 *      where Promptery lives outside `~/.promptery/db.sqlite`.
 *
 * The detect probe usually runs by default at `~/.promptery/db.sqlite`,
 * so the locate flow is for "atypical install" only — power users.
 */

import { useState, type FormEvent, type ReactElement } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";

import { invoke } from "@shared/api";
import { Button, Dialog, Input } from "@shared/ui";
import { spacesKeys } from "@shared/lib";

import { strings } from "../strings";

import styles from "./WelcomeWidget.module.css";

interface SpaceLike {
  id: string;
  name: string;
}

export interface WelcomeWidgetProps {
  /** Called once `create_space` succeeds (cache already invalidated). */
  onCreatedSpace?: () => void;
  /**
   * Called when the user successfully picks a Promptery DB path.
   * Caller is expected to switch to the import wizard with that path.
   */
  onLocatedPromptery?: (path: string) => void;
}

type ActiveDialog = "none" | "createSpace" | "locatePromptery";

/**
 * Welcome screen — `<h1>` + subtitle + two CTAs. The two dialog flows
 * are encoded as a discriminated `ActiveDialog` so we don't accidentally
 * render both at once.
 */
export function WelcomeWidget({
  onCreatedSpace,
  onLocatedPromptery,
}: WelcomeWidgetProps = {}): ReactElement {
  const [active, setActive] = useState<ActiveDialog>("none");

  return (
    <section
      className={styles.root}
      aria-labelledby="welcome-title"
      data-testid="welcome-widget"
    >
      <h2 id="welcome-title" className={styles.title}>
        {strings.welcome.title}
      </h2>
      <p className={styles.subtitle}>{strings.welcome.subtitle}</p>
      <div className={styles.actions}>
        <Button
          variant="primary"
          size="lg"
          onPress={() => setActive("createSpace")}
          data-testid="welcome-create-space"
        >
          {strings.welcome.createSpaceCta}
        </Button>
        <Button
          variant="secondary"
          size="lg"
          onPress={() => setActive("locatePromptery")}
          data-testid="welcome-locate-promptery"
        >
          {strings.welcome.locatePrompteryCta}
        </Button>
      </div>

      {active === "createSpace" ? (
        <CreateSpaceDialog
          onClose={() => setActive("none")}
          onCreated={() => {
            setActive("none");
            onCreatedSpace?.();
          }}
        />
      ) : null}

      {active === "locatePromptery" ? (
        <LocatePrompteryDialog
          onClose={() => setActive("none")}
          onPicked={(path) => {
            setActive("none");
            onLocatedPromptery?.(path);
          }}
        />
      ) : null}
    </section>
  );
}

// ─── Create-space dialog ────────────────────────────────────────────

interface CreateSpaceDialogProps {
  onClose: () => void;
  onCreated: () => void;
}

function CreateSpaceDialog({
  onClose,
  onCreated,
}: CreateSpaceDialogProps): ReactElement {
  const qc = useQueryClient();
  const [name, setName] = useState("");
  const [prefix, setPrefix] = useState("");
  const [submitError, setSubmitError] = useState<string | null>(null);

  const createSpace = useMutation<SpaceLike, Error, void>({
    mutationFn: async () => {
      return invoke<SpaceLike>("create_space", {
        name: name.trim(),
        prefix: prefix.trim().toLowerCase(),
        description: null,
        isDefault: true,
      });
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: spacesKeys.all });
      onCreated();
    },
    onError: (err) => setSubmitError(err.message),
  });

  const handleSubmit = (e: FormEvent<HTMLFormElement>): void => {
    e.preventDefault();
    const trimmedName = name.trim();
    const trimmedPrefix = prefix.trim();
    if (!trimmedName) {
      setSubmitError("Имя обязательно.");
      return;
    }
    if (!/^[a-zA-Zа-яА-Я]{3}$/.test(trimmedPrefix)) {
      setSubmitError("Префикс — ровно 3 буквы.");
      return;
    }
    setSubmitError(null);
    createSpace.mutate();
  };

  return (
    <Dialog
      title={strings.welcome.createSpaceDialogTitle}
      description={strings.welcome.createSpaceDialogDescription}
      isOpen
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <form
        className={styles.form}
        onSubmit={handleSubmit}
        noValidate
        data-testid="welcome-create-space-form"
      >
        <Input
          label={strings.welcome.createSpaceNameLabel}
          description={strings.welcome.createSpaceNameHint}
          value={name}
          onChange={setName}
          placeholder="Команда A"
          autoFocus
        />
        <Input
          label={strings.welcome.createSpacePrefixLabel}
          description={strings.welcome.createSpacePrefixHint}
          value={prefix}
          onChange={setPrefix}
          placeholder="abc"
        />
        {submitError ? (
          <p className={styles.formError} role="alert">
            {submitError}
          </p>
        ) : null}
        <div className={styles.formActions}>
          <Button variant="ghost" type="button" onPress={onClose}>
            {strings.welcome.createSpaceCancel}
          </Button>
          <Button
            variant="primary"
            type="submit"
            isPending={createSpace.isPending}
          >
            {strings.welcome.createSpaceSubmit}
          </Button>
        </div>
      </form>
    </Dialog>
  );
}

// ─── Locate-Promptery dialog ────────────────────────────────────────

interface LocatePrompteryDialogProps {
  onClose: () => void;
  onPicked: (path: string) => void;
}

/**
 * Stubbed file-picker — text input only. See module-level comment
 * for the rationale (avoid touching Rust deps in E4.1; revisit when
 * Katya wires `tauri-plugin-dialog`).
 *
 * TODO(coordinate-with-katya): tauri-plugin-dialog wiring would
 * replace this dialog body with `await open({ filters: [...] })`.
 */
function LocatePrompteryDialog({
  onClose,
  onPicked,
}: LocatePrompteryDialogProps): ReactElement {
  const [path, setPath] = useState("");
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = (e: FormEvent<HTMLFormElement>): void => {
    e.preventDefault();
    const trimmed = path.trim();
    if (!trimmed) {
      setError("Введи путь к файлу.");
      return;
    }
    setError(null);
    onPicked(trimmed);
  };

  return (
    <Dialog
      title={strings.welcome.locatePrompteryCta}
      isOpen
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <form
        className={styles.form}
        onSubmit={handleSubmit}
        noValidate
        data-testid="welcome-locate-form"
      >
        <Input
          label={strings.welcome.locateLabel}
          description={strings.welcome.locateHint}
          value={path}
          onChange={setPath}
          placeholder="/Users/me/.promptery/db.sqlite"
          autoFocus
          {...(error ? { errorMessage: error } : {})}
        />
        <p className={styles.locateHint}>
          {/* Reinforce stub note inline so a curious user knows why
              there's no native picker yet. */}
          Графический пикер появится в следующей итерации.
        </p>
        <div className={styles.formActions}>
          <Button variant="ghost" type="button" onPress={onClose}>
            {strings.welcome.locateCancel}
          </Button>
          <Button variant="primary" type="submit">
            {strings.welcome.locateSubmit}
          </Button>
        </div>
      </form>
    </Dialog>
  );
}
