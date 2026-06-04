/**
 * PromptEditorPanel — inline (non-modal) prompt editor.
 *
 * Renders the same form as `<PromptEditor>` but as an in-page panel
 * rather than a Dialog. Used by `<PromptsPage>` (round-19d) so picking a
 * prompt in the sidebar opens its editor in the right pane instead of
 * popping a modal.
 *
 * Props:
 *   - `promptId` — the prompt to edit (required; caller renders nothing
 *     when no prompt is selected).
 *   - `onClose`  — called on Cancel or successful Save.
 */

import { useEffect, type ReactElement } from "react";
import {
  useForm,
  useFieldArray,
  useWatch,
  Controller,
} from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";

import { usePrompt, useUpdatePromptMutation } from "@entities/prompt";
import {
  Button,
  EntityTitle,
  Input,
  MarkdownField,
  Scrollable,
} from "@shared/ui";
import { PixelInterfaceEssentialBin } from "@shared/ui/Icon";
import { cn } from "@shared/lib";
import { useToast } from "@shared/lib";
import { PromptTagsField } from "@features/prompt-tags/field";
import { HistoryViewerButton } from "@features/version-history";

import styles from "./PromptEditorPanel.module.css";

// Name + content are required (trimmed); short description is optional
// ("" → null on update). Examples are an ordered list of markdown bodies
// (trimmed + empties dropped on save). Icon/color drive the EntityTitle
// appearance picker.
const promptPanelFormSchema = z.object({
  name: z.string().trim().min(1, "Name cannot be empty."),
  shortDescription: z.string(),
  content: z.string().trim().min(1, "Content cannot be empty."),
  color: z.string(),
  icon: z.string().nullable(),
  examples: z.array(z.object({ value: z.string() })),
});

type PromptPanelFormValues = z.infer<typeof promptPanelFormSchema>;

export interface PromptEditorPanelProps {
  /** Prompt to edit. */
  promptId: string;
  /** Called on cancel or successful save. */
  onClose: () => void;
  /**
   * When provided, a "← Back" button is rendered in the header that
   * invokes this callback. Omit to hide the button — for entry points
   * with no meaningful "back" target (e.g. the sidebar's PROMPTS list,
   * which closes the panel via its own selection state).
   */
  onBack?: () => void;
}

export function PromptEditorPanel({
  promptId,
  onClose,
  onBack,
}: PromptEditorPanelProps): ReactElement {
  const query = usePrompt(promptId);
  const updateMutation = useUpdatePromptMutation();
  const { pushToast } = useToast();

  const {
    control,
    handleSubmit,
    reset,
    setValue,
    setError,
    clearErrors,
    formState: { errors },
  } = useForm<PromptPanelFormValues>({
    resolver: zodResolver(promptPanelFormSchema),
    defaultValues: {
      name: "",
      shortDescription: "",
      content: "",
      color: "",
      icon: null,
      examples: [],
    },
    mode: "onChange",
  });

  const { fields, append, remove } = useFieldArray({
    control,
    name: "examples",
  });

  // EntityTitle's appearance picker drives icon + color together; read
  // them back via `useWatch` for the picker `value` prop.
  const watchedColor = useWatch({ control, name: "color" });
  const watchedIcon = useWatch({ control, name: "icon" });

  // Repopulate when prompt data loads or promptId changes.
  const prompt = query.data;
  useEffect(() => {
    if (prompt) {
      reset({
        name: prompt.name,
        shortDescription: prompt.shortDescription ?? "",
        content: prompt.content,
        color: prompt.color ?? "",
        icon: prompt.icon ?? null,
        examples: prompt.examples.map((value) => ({ value })),
      });
      clearErrors("root.serverError");
    }
  }, [prompt, reset, clearErrors]);

  // ── Pending ────────────────────────────────────────────────────────

  if (query.status === "pending") {
    return (
      <section
        className={styles.root}
        aria-label="Prompt editor"
        data-testid="prompt-editor-panel"
      >
        <div className={styles.scrollArea}>
          <Scrollable axis="y" className={styles.scrollableHost}>
            <div className={styles.scrollAreaInner}>
              <div className={styles.section}>
                <div className={cn(styles.skeletonRow, styles.skeletonRowNarrow)} />
                <div className={cn(styles.skeletonRow, styles.skeletonRowWide)} />
              </div>
              <div className={styles.section}>
                <div className={cn(styles.skeletonRow, styles.skeletonRowMedium)} />
                <div className={styles.skeletonBlock} />
              </div>
            </div>
          </Scrollable>
        </div>
        <div className={styles.footer}>
          <Button
            variant="ghost"
            size="md"
            isDisabled
            data-testid="prompt-editor-panel-cancel"
          >
            Cancel
          </Button>
          <Button
            variant="primary"
            size="md"
            isDisabled
            data-testid="prompt-editor-panel-save"
          >
            Save
          </Button>
        </div>
      </section>
    );
  }

  // ── Error ──────────────────────────────────────────────────────────

  if (query.status === "error") {
    return (
      <section
        className={styles.root}
        aria-label="Prompt editor"
        data-testid="prompt-editor-panel"
      >
        <div
          className={styles.errorBanner}
          role="alert"
          data-testid="prompt-editor-panel-fetch-error"
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
        <div className={styles.footer}>
          <Button
            variant="ghost"
            size="md"
            onPress={onClose}
            data-testid="prompt-editor-panel-cancel"
          >
            Close
          </Button>
        </div>
      </section>
    );
  }

  // ── Not found ─────────────────────────────────────────────────────

  if (!query.data) {
    return (
      <section
        className={styles.root}
        aria-label="Prompt editor"
        data-testid="prompt-editor-panel"
      >
        <div
          className={styles.notFoundBanner}
          role="alert"
          data-testid="prompt-editor-panel-not-found"
        >
          <p className={styles.notFoundBannerMessage}>Prompt not found.</p>
        </div>
        <div className={styles.footer}>
          <Button
            variant="ghost"
            size="md"
            onPress={onClose}
            data-testid="prompt-editor-panel-cancel"
          >
            Close
          </Button>
        </div>
      </section>
    );
  }

  // ── Loaded ─────────────────────────────────────────────────────────

  // Narrowed non-null after the !query.data guard above.
  const loadedPrompt = query.data;

  const onValid = handleSubmit((values) => {
    const trimmedName = values.name.trim();
    const trimmedContent = values.content.trim();
    const resolvedShortDescription =
      values.shortDescription.trim() === ""
        ? null
        : values.shortDescription.trim();
    const resolvedColor = values.color === "" ? null : values.color;

    type MutationArgs = Parameters<typeof updateMutation.mutate>[0];
    const mutationArgs: MutationArgs = { id: loadedPrompt.id };

    if (trimmedName !== loadedPrompt.name) {
      mutationArgs.name = trimmedName;
    }
    if (trimmedContent !== loadedPrompt.content) {
      mutationArgs.content = trimmedContent;
    }
    if (resolvedShortDescription !== loadedPrompt.shortDescription) {
      mutationArgs.shortDescription = resolvedShortDescription;
    }
    if (resolvedColor !== loadedPrompt.color) {
      mutationArgs.color = resolvedColor;
    }
    if (values.icon !== (loadedPrompt.icon ?? null)) {
      mutationArgs.icon = values.icon;
    }
    // Examples diff: trim each + drop empties, then array-equal compare
    // against the loaded value.
    const trimmedExamples = values.examples
      .map((e) => e.value.trim())
      .filter((e) => e.length > 0);
    const sameExamples =
      trimmedExamples.length === loadedPrompt.examples.length &&
      trimmedExamples.every((e, i) => e === loadedPrompt.examples[i]);
    if (!sameExamples) {
      mutationArgs.examples = trimmedExamples;
    }

    updateMutation.mutate(mutationArgs, {
      onSuccess: () => {
        // Stay on the editor — query invalidation refreshes `query.data`
        // which re-seeds the form via the reset effect. The user keeps
        // their place; close is now opt-in via Cancel / Back.
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
    reset({
      name: loadedPrompt.name,
      shortDescription: loadedPrompt.shortDescription ?? "",
      content: loadedPrompt.content,
      color: loadedPrompt.color ?? "",
      icon: loadedPrompt.icon ?? null,
      examples: loadedPrompt.examples.map((value) => ({ value })),
    });
    clearErrors("root.serverError");
    onClose();
  };

  const addExample = (): void => {
    append({ value: "" });
  };

  const saveError = errors.root?.serverError?.message;

  return (
    <section
      className={styles.root}
      aria-label="Prompt editor"
      data-testid="prompt-editor-panel"
    >
      {onBack !== undefined ? (
        <div className={styles.backRow}>
          <Button
            variant="ghost"
            size="sm"
            onPress={onBack}
            data-testid="prompt-editor-panel-back"
          >
            ← Back
          </Button>
        </div>
      ) : null}
      <header className={styles.header}>
        <Controller
          control={control}
          name="name"
          render={({ field }) => (
            <EntityTitle
              size="lg"
              editable
              name={field.value}
              onNameChange={field.onChange}
              editTestId="prompt-editor-panel-name-inline"
              value={{
                icon: watchedIcon,
                color: watchedColor === "" ? null : watchedColor,
              }}
              onAppearanceChange={(next) => {
                setValue("icon", next.icon, { shouldDirty: true });
                setValue("color", next.color ?? "", { shouldDirty: true });
              }}
              pickerAriaLabel="Prompt icon and color"
              pickerTestId="prompt-editor-panel-appearance-picker"
              actions={
                <HistoryViewerButton
                  title="Prompt content history"
                  kind="prompt"
                  sourceId={loadedPrompt.id}
                  currentContent={loadedPrompt.content}
                  data-testid="prompt-editor-panel-history"
                />
              }
            />
          )}
        />
      </header>
      <div className={styles.scrollArea}>
      <Scrollable axis="y" className={styles.scrollableHost}>
        <div className={styles.scrollAreaInner}>
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
                data-testid="prompt-editor-panel-name-input"
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
                data-testid="prompt-editor-panel-shortdesc-input"
              />
            )}
          />
        </div>

        {/* Tags — live-mutating (no draft state). The IPC writes through
            on each toggle; the prompts→tags map invalidation refreshes
            the chip row + sidebar filter together. */}
        <div className={styles.section}>
          <p className={styles.sectionLabel}>Tags</p>
          <PromptTagsField promptId={loadedPrompt.id} />
        </div>

        {/* Content */}
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
                data-testid="prompt-editor-panel-content-textarea"
              />
            )}
          />
        </div>

        {/* Examples — optional ordered list. Each renders as `<example>`
            inside the prompt's task XML envelope. */}
        <div className={styles.section}>
          <div className={styles.sectionHeader}>
            <p className={styles.sectionLabel}>Examples</p>
            <Button
              variant="ghost"
              size="sm"
              onPress={addExample}
              data-testid="prompt-editor-panel-add-example"
            >
              + Add example
            </Button>
          </div>
          {fields.length === 0 ? (
            <p className={styles.exampleHint}>
              No examples yet. Examples render as `&lt;example&gt;` children
              inside the prompt's task XML.
            </p>
          ) : (
            <ol className={styles.exampleList}>
              {fields.map((exampleField, index) => (
                <li key={exampleField.id} className={styles.exampleItem}>
                  <span className={styles.exampleIndex}>#{index}</span>
                  <Controller
                    control={control}
                    name={`examples.${index}.value` as const}
                    render={({ field }) => (
                      <MarkdownField
                        value={field.value}
                        onChange={field.onChange}
                        placeholder="Example body (Markdown)…"
                        ariaLabel={`Example ${index}`}
                        rows={4}
                        data-testid={`prompt-editor-panel-example-${index}`}
                      />
                    )}
                  />
                  <Button
                    variant="ghost"
                    size="sm"
                    onPress={() => remove(index)}
                    aria-label={`Remove example ${index}`}
                    data-testid={`prompt-editor-panel-example-remove-${index}`}
                  >
                    <PixelInterfaceEssentialBin
                      width={14}
                      height={14}
                      aria-hidden="true"
                    />
                  </Button>
                </li>
              ))}
            </ol>
          )}
        </div>

        </div>
      </Scrollable>
      </div>

      <div className={styles.footer}>
        {/* Token count — auto-recomputed on save. Lives inline on the
            footer's left edge so the action buttons stay right-aligned
            (audit-3). */}
        <div
          className={styles.tokenRow}
          data-testid="prompt-editor-panel-token-row"
        >
          <span className={styles.tokenLabel}>
            {loadedPrompt.tokenCount !== null && loadedPrompt.tokenCount > 0n
              ? `Current count: ≈${loadedPrompt.tokenCount.toString()} tokens`
              : "Current count: not computed"}
          </span>
        </div>
        {saveError !== undefined ? (
          <p
            className={styles.saveError}
            role="alert"
            data-testid="prompt-editor-panel-save-error"
          >
            {saveError}
          </p>
        ) : null}
        <Button
          variant="ghost"
          size="md"
          onPress={handleCancel}
          data-testid="prompt-editor-panel-cancel"
        >
          Cancel
        </Button>
        <Button
          variant="primary"
          size="md"
          isPending={updateMutation.status === "pending"}
          onPress={handleSavePress}
          data-testid="prompt-editor-panel-save"
        >
          Save
        </Button>
      </div>
    </section>
  );
}
