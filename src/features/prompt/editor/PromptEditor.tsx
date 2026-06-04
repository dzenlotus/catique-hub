/**
 * PromptEditor — prompt detail / edit modal.
 *
 * Props:
 *   - `promptId` — null → dialog closed; string → dialog open for that prompt.
 *   - `onClose`  — called on Cancel, successful Save, or Esc (via RAC).
 */

import { useEffect, useState, type ReactElement } from "react";
import { useForm, Controller } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";

import { usePrompt, useUpdatePromptMutation } from "@entities/prompt";
import {
  Dialog,
  EditorShell,
  Button,
  Input,
  MarkdownField,
  IconColorPicker,
} from "@shared/ui";
import { cn } from "@shared/lib";
import { useToast } from "@shared/lib";
import { PromptTagsField } from "@features/prompt-tags/field";

import styles from "./PromptEditor.module.css";

// Name + content are required (trimmed); short description is optional
// ("" → null on update). Icon/color live outside the form (driven by
// the dialog-header picker), matching the SpaceCreateDialog split.
const promptFormSchema = z.object({
  name: z.string().trim().min(1, "Name cannot be empty."),
  shortDescription: z.string(),
  content: z.string().trim().min(1, "Content cannot be empty."),
});

type PromptFormValues = z.infer<typeof promptFormSchema>;

export interface PromptEditorProps {
  /** null = closed, string = open for this prompt id */
  promptId: string | null;
  /** Called on cancel, successful save, or Esc. */
  onClose: () => void;
}

/**
 * `PromptEditor` — modal for viewing and editing a prompt's name, content,
 * color and short description.
 *
 * Delegates open/close tracking to `promptId` — when null the `<Dialog>`
 * `isOpen` prop is false, so RAC handles exit animations and focus restoration.
 *
 * The IconColorPicker lives in the dialog's `titleLeading` slot —
 * matching `<PromptEditorPanel>` so appearance always sits to the
 * LEFT of the title.
 */
export function PromptEditor({ promptId, onClose }: PromptEditorProps): ReactElement {
  const isOpen = promptId !== null;

  // Icon/color state is lifted here so the dialog header (rendered
  // outside `DialogContent`) can drive the same draft the body reads
  // back. `<PromptEditorContent>` seeds these on promptId change.
  const [icon, setIcon] = useState<string | null>(null);
  const [color, setColor] = useState<string>("");

  return (
    <Dialog
      title="Prompt"
      titleLeading={
        promptId !== null ? (
          <IconColorPicker
            value={{ icon, color: color === "" ? null : color }}
            onChange={(next) => {
              setIcon(next.icon);
              setColor(next.color ?? "");
            }}
            ariaLabel="Prompt icon and color"
            data-testid="prompt-editor-appearance-picker"
          />
        ) : undefined
      }
      isOpen={isOpen}
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
      isDismissable
      className={styles.body}
      data-testid="prompt-editor"
    >
      {() =>
        promptId !== null ? (
          <PromptEditorContent
            promptId={promptId}
            icon={icon}
            color={color}
            setIcon={setIcon}
            setColor={setColor}
            onClose={onClose}
          />
        ) : null
      }
    </Dialog>
  );
}

// ─────────────────────────────────────────────────────────────────────────────

interface PromptEditorContentProps {
  promptId: string;
  /** Lifted icon state (shared with the dialog header picker). */
  icon: string | null;
  /** Lifted color state (shared with the dialog header picker). */
  color: string;
  setIcon: (next: string | null) => void;
  setColor: (next: string) => void;
  onClose: () => void;
}

function PromptEditorContent({
  promptId,
  icon: localIcon,
  color: localColor,
  setIcon: setLocalIcon,
  setColor: setLocalColor,
  onClose,
}: PromptEditorContentProps): ReactElement {
  const query = usePrompt(promptId);
  const updateMutation = useUpdatePromptMutation();
  const { pushToast } = useToast();

  // Name / short description / content live in react-hook-form. Icon and
  // color are owned by the parent so the dialog-header picker can drive
  // them (they sit outside `DialogContent`); the reset effect below
  // re-seeds both surfaces when the loaded prompt changes.
  const {
    control,
    handleSubmit,
    reset,
    setError,
    clearErrors,
    formState: { errors },
  } = useForm<PromptFormValues>({
    resolver: zodResolver(promptFormSchema),
    defaultValues: { name: "", shortDescription: "", content: "" },
    mode: "onChange",
  });

  // Repopulate when prompt data loads or promptId changes. `reset`
  // re-seeds the form; the lifted icon/color follow the same source.
  const prompt = query.data;
  useEffect(() => {
    if (prompt) {
      reset({
        name: prompt.name,
        shortDescription: prompt.shortDescription ?? "",
        content: prompt.content,
      });
      setLocalColor(prompt.color ?? "");
      setLocalIcon(prompt.icon ?? null);
      clearErrors("root.serverError");
    }
  }, [prompt, reset, clearErrors, setLocalColor, setLocalIcon]);

  // ── Pending ────────────────────────────────────────────────────────

  if (query.status === "pending") {
    return (
      <>
        <div className={styles.section}>
          <div className={cn(styles.skeletonRow, styles.skeletonRowNarrow)} />
          <div className={cn(styles.skeletonRow, styles.skeletonRowWide)} />
        </div>
        <div className={styles.section}>
          <div className={cn(styles.skeletonRow, styles.skeletonRowMedium)} />
          <div className={styles.skeletonBlock} />
        </div>
        <EditorShell.Footer className={styles.footer}>
          <Button
            variant="ghost"
            size="md"
            isDisabled
            data-testid="prompt-editor-cancel"
          >
            Cancel
          </Button>
          <Button
            variant="primary"
            size="md"
            isDisabled
            data-testid="prompt-editor-save"
          >
            Save
          </Button>
        </EditorShell.Footer>
      </>
    );
  }

  // ── Error ──────────────────────────────────────────────────────────

  if (query.status === "error") {
    return (
      <>
        <div
          className={styles.errorBanner}
          role="alert"
          data-testid="prompt-editor-fetch-error"
        >
          <p className={styles.errorBannerMessage}>
            Failed to load prompt: {query.error.message}
          </p>
          <Button
            variant="secondary"
            size="sm"
            onPress={() => void query.refetch()}
          >
            Retry
          </Button>
        </div>
        <EditorShell.Footer className={styles.footer}>
          <Button
            variant="ghost"
            size="md"
            onPress={onClose}
            data-testid="prompt-editor-cancel"
          >
            Close
          </Button>
        </EditorShell.Footer>
      </>
    );
  }

  // ── Not found ─────────────────────────────────────────────────────

  if (!query.data) {
    return (
      <>
        <div
          className={styles.notFoundBanner}
          role="alert"
          data-testid="prompt-editor-not-found"
        >
          <p className={styles.notFoundBannerMessage}>
            Prompt not found.
          </p>
        </div>
        <EditorShell.Footer className={styles.footer}>
          <Button
            variant="ghost"
            size="md"
            onPress={onClose}
            data-testid="prompt-editor-cancel"
          >
            Close
          </Button>
        </EditorShell.Footer>
      </>
    );
  }

  // ── Loaded ─────────────────────────────────────────────────────────

  // Narrowed non-null after the !query.data guard above.
  const loadedPrompt = query.data;

  const onValid = handleSubmit((values) => {
    const trimmedName = values.name.trim();
    const trimmedContent = values.content.trim();
    // Empty string → clear to null; non-empty → use trimmed value.
    const resolvedShortDescription =
      values.shortDescription.trim() === ""
        ? null
        : values.shortDescription.trim();
    // Empty string → clear to null; non-empty → use value as-is.
    const resolvedColor = localColor === "" ? null : localColor;

    type MutationArgs = Parameters<typeof updateMutation.mutate>[0];
    const mutationArgs: MutationArgs = { id: loadedPrompt.id };

    if (trimmedName !== loadedPrompt.name) {
      mutationArgs.name = trimmedName;
    }
    if (trimmedContent !== loadedPrompt.content) {
      mutationArgs.content = trimmedContent;
    }
    // For nullable fields: only include when the resolved value differs from stored.
    if (resolvedShortDescription !== loadedPrompt.shortDescription) {
      mutationArgs.shortDescription = resolvedShortDescription;
    }
    if (resolvedColor !== loadedPrompt.color) {
      mutationArgs.color = resolvedColor;
    }
    // Icon: null clears, string sets, omitted when unchanged.
    if (localIcon !== (loadedPrompt.icon ?? null)) {
      mutationArgs.icon = localIcon;
    }

    updateMutation.mutate(mutationArgs, {
      onSuccess: () => {
        // Stay open — let the user keep editing. Close is now opt-in
        // via Cancel / Esc / scrim click.
        pushToast("success", "Prompt saved");
      },
      onError: (err) => {
        pushToast("error", `Failed to save prompt: ${err.message}`);
        setError("root.serverError", {
          message: `Failed to save: ${err.message}`,
        });
      },
    });
  });

  const handleSavePress = (): void => {
    void onValid();
  };

  const handleCancel = (): void => {
    // Reset form + lifted picker state back to prompt values before closing.
    reset({
      name: loadedPrompt.name,
      shortDescription: loadedPrompt.shortDescription ?? "",
      content: loadedPrompt.content,
    });
    setLocalColor(loadedPrompt.color ?? "");
    setLocalIcon(loadedPrompt.icon ?? null);
    clearErrors("root.serverError");
    onClose();
  };

  const saveError = errors.root?.serverError?.message;

  return (
    <>
      {/* Name */}
      <div className={styles.section}>
        <Controller
          control={control}
          name="name"
          render={({ field }) => (
            <Input
              label="Name"
              value={field.value}
              onChange={field.onChange}
              placeholder="Prompt name"
              className={styles.fullWidthInput}
              data-testid="prompt-editor-name-input"
            />
          )}
        />
      </div>

      {/* Short description */}
      <div className={styles.section}>
        <Controller
          control={control}
          name="shortDescription"
          render={({ field }) => (
            <Input
              label="Short description"
              value={field.value}
              onChange={field.onChange}
              placeholder="Optional short description…"
              className={styles.fullWidthInput}
              data-testid="prompt-editor-shortdesc-input"
            />
          )}
        />
      </div>

      {/* Appearance picker now lives in the dialog's `titleLeading`
          slot, not the body — same pattern as `<PromptEditorPanel>`. */}

      {/* Tags — live mutations against the existing prompt. */}
      <div className={styles.section}>
        <p className={styles.sectionLabel}>Tags</p>
        <PromptTagsField promptId={loadedPrompt.id} />
      </div>

      {/* Content — implicit view ⇄ edit toggle via MarkdownField (ctq-76 #11). */}
      <div className={styles.section}>
        <p className={styles.sectionLabel}>Content</p>
        <Controller
          control={control}
          name="content"
          render={({ field }) => (
            <MarkdownField
              value={field.value}
              onChange={field.onChange}
              placeholder="Prompt content (Markdown)…"
              ariaLabel="Content"
              data-testid="prompt-editor-content-textarea"
            />
          )}
        />
      </div>

      {/* Token count — auto-recomputed on save (round-19d). */}
      <div className={styles.tokenRow} data-testid="prompt-editor-token-row">
        <span className={styles.tokenLabel}>
          {loadedPrompt.tokenCount !== null && loadedPrompt.tokenCount > 0n
            ? `Current count: ≈${loadedPrompt.tokenCount.toString()} tokens`
            : "Current count: not computed"}
        </span>
      </div>

      {/* Footer */}
      <EditorShell.Footer className={styles.footer}>
        {saveError !== undefined ? (
          <p
            className={styles.saveError}
            role="alert"
            data-testid="prompt-editor-save-error"
          >
            {saveError}
          </p>
        ) : null}
        <Button
          variant="ghost"
          size="md"
          onPress={handleCancel}
          data-testid="prompt-editor-cancel"
        >
          Cancel
        </Button>
        <Button
          variant="primary"
          size="md"
          isPending={updateMutation.status === "pending"}
          onPress={handleSavePress}
          data-testid="prompt-editor-save"
        >
          Save
        </Button>
      </EditorShell.Footer>
    </>
  );
}
