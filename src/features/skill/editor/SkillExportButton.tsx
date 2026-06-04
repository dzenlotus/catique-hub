/**
 * SkillExportButton — copy the skill's markdown body to the clipboard.
 *
 * v3 ships an asymmetric pair to the existing `<SkillImportButton/>`:
 *   - **Copy as markdown** — Stream J / v3 Wave 4 delivers the canonical
 *     Markdown via the Rust-side `export_skill_as_markdown` IPC. The
 *     local `serialiseSkill` helper stays as a graceful fallback when
 *     the IPC is unavailable (Storybook / dev without Rust running) so
 *     the button keeps working in headless environments.
 *   - **Share via git URL** — needs the new `export_skill_share_url`
 *     IPC (Project Map open issue) and lands when backend ships;
 *     button disabled here with a tooltip.
 *
 * The markdown serialisation is intentionally simple: title (`# name`)
 * followed by overview, then one section per step. It mirrors the
 * format that `import_skill_from_url` accepts so import/export
 * round-trips without surprises.
 */
import { useEffect, useState, type ReactElement } from "react";

import { useSkill, useSkillSteps } from "@entities/skill";
import { Button, Dialog, TextArea } from "@shared/ui";
import { invoke } from "@shared/api";
import { useToast } from "@shared/lib";

import styles from "./SkillImportButton.module.css";

export interface SkillExportButtonProps {
  skillId: string;
}

function serialiseSkill(args: {
  name: string;
  overview: string;
  steps: ReadonlyArray<{
    title: string;
    body: string;
    expectedOutcome: string | null;
  }>;
}): string {
  const parts: string[] = [`# ${args.name}`];
  if (args.overview.trim().length > 0) {
    parts.push("", args.overview.trim());
  }
  for (let i = 0; i < args.steps.length; i += 1) {
    const step = args.steps[i];
    if (step === undefined) continue;
    parts.push("", `## Step ${String(i + 1)} — ${step.title}`);
    if (step.body.trim().length > 0) {
      parts.push("", step.body.trim());
    }
    if (step.expectedOutcome !== null && step.expectedOutcome.trim().length > 0) {
      parts.push("", `**Expected outcome.** ${step.expectedOutcome.trim()}`);
    }
  }
  return parts.join("\n");
}

export function SkillExportButton({
  skillId,
}: SkillExportButtonProps): ReactElement {
  const [isOpen, setIsOpen] = useState(false);

  return (
    <>
      <Button
        variant="secondary"
        size="sm"
        onPress={() => setIsOpen(true)}
        data-testid="skill-export-trigger"
      >
        + Export
      </Button>
      <Dialog
        title="Export skill"
        description="Copy the markdown representation; sharing via signed git URL ships with the backend export endpoint."
        isOpen={isOpen}
        onOpenChange={(open) => {
          if (!open) setIsOpen(false);
        }}
        isDismissable
        className={styles.body}
        data-testid="skill-export-dialog"
      >
        {() => (
          <SkillExportDialogContent
            skillId={skillId}
            onClose={() => setIsOpen(false)}
          />
        )}
      </Dialog>
    </>
  );
}

interface SkillExportDialogContentProps {
  skillId: string;
  onClose: () => void;
}

function SkillExportDialogContent({
  skillId,
  onClose,
}: SkillExportDialogContentProps): ReactElement {
  const skillQuery = useSkill(skillId);
  const stepsQuery = useSkillSteps(skillId);
  const { pushToast } = useToast();
  const [markdown, setMarkdown] = useState("");

  // Resolve the markdown body. Preferred path is the canonical
  // Rust-side IPC (`export_skill_as_markdown`); we fall back to the
  // in-browser serialiser when the IPC is unavailable (Storybook,
  // `pnpm dev` without `pnpm tauri:dev`, or when the user blew up
  // their dev DB and the skill row is missing). Two-step resolution
  // keeps the button useful for every dev workflow without a flicker
  // on the happy path.
  useEffect(() => {
    let cancelled = false;
    async function load(): Promise<void> {
      try {
        const fromIpc = await invoke<string>("export_skill_as_markdown", {
          skillId,
        });
        if (!cancelled) setMarkdown(fromIpc);
      } catch {
        // Fallback path — IPC unavailable (dev / Storybook) or the
        // skill was deleted between open and resolve. Mirror the
        // same shape the backend would produce.
        if (
          cancelled ||
          skillQuery.data === undefined ||
          stepsQuery.data === undefined
        ) {
          return;
        }
        const fallback = serialiseSkill({
          name: skillQuery.data.name,
          overview: skillQuery.data.description ?? "",
          steps: stepsQuery.data.map((s) => ({
            title: s.title,
            body: s.body,
            expectedOutcome: s.expectedOutcome,
          })),
        });
        setMarkdown(fallback);
      }
    }
    void load();
    return () => {
      cancelled = true;
    };
  }, [skillId, skillQuery.data, stepsQuery.data]);

  function handleCopy(): void {
    if (markdown.length === 0) {
      pushToast("error", "Skill markdown not loaded yet — try again");
      return;
    }
    try {
      void navigator.clipboard.writeText(markdown);
      pushToast("success", "Markdown copied to clipboard");
    } catch {
      pushToast("error", "Clipboard write failed — copy from the dialog");
    }
  }

  return (
    <div data-testid="skill-export-dialog-body">
      <TextArea
        label="Skill markdown"
        value={markdown}
        onChange={() => {
          /* read-only — value is regenerated on every open */
        }}
        rows={14}
        isReadOnly
        data-skill-id={skillId}
      />
      <div style={{ display: "flex", gap: 8, marginTop: 12 }}>
        <Button
          variant="primary"
          size="sm"
          onPress={() => {
            handleCopy();
            onClose();
          }}
          data-testid="skill-export-copy"
        >
          Copy to clipboard
        </Button>
        <Button
          variant="secondary"
          size="sm"
          isDisabled
          data-testid="skill-export-share-url"
        >
          <span title="Ships when the export backend lands">
            Share via git URL
          </span>
        </Button>
        <Button
          variant="ghost"
          size="sm"
          onPress={onClose}
          data-testid="skill-export-cancel"
        >
          Close
        </Button>
      </div>
    </div>
  );
}
