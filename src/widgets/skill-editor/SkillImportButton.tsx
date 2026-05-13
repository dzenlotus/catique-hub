/**
 * SkillImportButton — opens a dialog that imports skill content from a
 * git URL.
 *
 * Flow (per SKILL-V2-B):
 *   1. User clicks `[+ Git import]` next to the steps header.
 *   2. Dialog opens with a URL input + an explainer. The user pastes
 *      a link to a markdown file on github.com / gitlab.com / a
 *      gist, then picks one of two commit buttons:
 *      - **Append steps** — keeps existing steps, appends parsed
 *        steps after them.
 *      - **Replace steps** — deletes existing steps before append.
 *   3. The wrapper fires `import_skill_from_url`. On success it
 *      surfaces a toast carrying the `stepsAdded` count and closes
 *      the dialog; on rejection (typed `AppError` from the backend)
 *      the inline error banner shows the formatted message.
 *
 * The "+ Git reference" attachment (static metadata) lives in the
 * adjacent `SkillAttachmentsSection` — this button is the FETCH +
 * PARSE flow and is deliberately distinct.
 */

import { useState, type ReactElement } from "react";

import { useImportSkillFromUrlMutation } from "@entities/skill";
import { Button, Dialog, Input } from "@shared/ui";
import { useToast } from "@app/providers/ToastProvider";

import styles from "./SkillImportButton.module.css";

export interface SkillImportButtonProps {
  skillId: string;
}

/** `SkillImportButton` — trigger + dialog for git-URL skill imports. */
export function SkillImportButton({
  skillId,
}: SkillImportButtonProps): ReactElement {
  const [isOpen, setIsOpen] = useState(false);

  return (
    <>
      <Button
        variant="secondary"
        size="sm"
        onPress={() => setIsOpen(true)}
        data-testid="skill-import-trigger"
      >
        + Git import
      </Button>
      <Dialog
        title="Import skill from git"
        isOpen={isOpen}
        onOpenChange={(open) => {
          if (!open) setIsOpen(false);
        }}
        isDismissable
        className={styles.body}
        data-testid="skill-import-dialog"
      >
        {() => (
          <SkillImportDialogContent
            skillId={skillId}
            onClose={() => setIsOpen(false)}
          />
        )}
      </Dialog>
    </>
  );
}

// ─────────────────────────────────────────────────────────────────────────────

interface SkillImportDialogContentProps {
  skillId: string;
  onClose: () => void;
}

function SkillImportDialogContent({
  skillId,
  onClose,
}: SkillImportDialogContentProps): ReactElement {
  const [url, setUrl] = useState("");
  const [validationError, setValidationError] = useState<string | null>(null);
  const importMutation = useImportSkillFromUrlMutation();
  const { pushToast } = useToast();

  const submit = (replaceSteps: boolean): void => {
    const trimmed = url.trim();
    if (trimmed === "") {
      setValidationError("URL is required.");
      return;
    }
    setValidationError(null);
    importMutation.mutate(
      { url: trimmed, targetSkillId: skillId, replaceSteps },
      {
        onSuccess: (report) => {
          pushToast(
            "success",
            `Imported ${report.stepsAdded} step${report.stepsAdded === 1 ? "" : "s"} from URL.`,
          );
          onClose();
        },
        onError: (err) => {
          pushToast("error", `Failed to import: ${err.message}`);
        },
      },
    );
  };

  const isPending = importMutation.status === "pending";
  const mutationErrorMessage =
    importMutation.status === "error"
      ? importMutation.error.message
      : null;

  return (
    <>
      <p className={styles.explainer}>
        Imports a public markdown file from GitHub, GitLab, or a gist. The
        first heading and intro become the overview; each <code>## Heading</code>
        block becomes a step.
      </p>
      <Input
        label="URL"
        value={url}
        onChange={(next) => {
          setUrl(next);
          if (validationError !== null) setValidationError(null);
        }}
        placeholder="https://github.com/owner/repo/blob/main/SKILL.md"
        className={styles.fullWidth}
        data-testid="skill-import-url-input"
      />
      {validationError !== null ? (
        <p
          className={styles.error}
          role="alert"
          data-testid="skill-import-validation-error"
        >
          {validationError}
        </p>
      ) : null}
      {mutationErrorMessage !== null && validationError === null ? (
        <p
          className={styles.error}
          role="alert"
          data-testid="skill-import-mutation-error"
        >
          {mutationErrorMessage}
        </p>
      ) : null}
      <div className={styles.actions}>
        <Button
          variant="ghost"
          size="sm"
          onPress={onClose}
          data-testid="skill-import-cancel"
        >
          Cancel
        </Button>
        <span className={styles.spacer} aria-hidden="true" />
        <Button
          variant="secondary"
          size="sm"
          isPending={isPending}
          onPress={() => submit(true)}
          data-testid="skill-import-replace"
        >
          Replace steps
        </Button>
        <Button
          variant="primary"
          size="sm"
          isPending={isPending}
          onPress={() => submit(false)}
          data-testid="skill-import-append"
        >
          Append steps
        </Button>
      </div>
    </>
  );
}
