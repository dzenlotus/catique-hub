/**
 * PromptsSettings — standalone settings page for the Prompts surface.
 *
 * Round-19e: replaces the popover that used to live behind the
 * `prompts-sidebar-settings-trigger`. UX rule: every "edit / settings"
 * surface is a route with a `← Back` button, never a modal or popover.
 *
 * Structure:
 *   - Tags editor — rename inline, delete with confirm. Tag *creation*
 *     stays on the per-prompt `<PromptTagsField>` since that's where
 *     the user mints the tag they're about to attach.
 *   - New-prompt template — localStorage-backed defaults applied by
 *     `<PromptCreateDialog>` on open (short description + body).
 */

import { type ReactElement } from "react";

import { useTags } from "@entities/tag";
import {
  PROMPT_TEMPLATE_STORAGE_KEY,
  promptTemplateCodec,
  type PromptTemplate,
} from "@entities/prompt";
import { useLocalStorage } from "@shared/storage";
import { Button } from "@shared/ui";
import { TagsLibraryEditor } from "@widgets/tags-library-editor";

import styles from "./PromptsSettings.module.css";

export interface PromptsSettingsProps {
  /** Called when the user picks "Back" — parent restores prior view. */
  onBack: () => void;
}

export function PromptsSettings({
  onBack,
}: PromptsSettingsProps): ReactElement {
  return (
    <div className={styles.root} data-testid="prompts-settings">
      <div className={styles.backRow}>
        <Button
          variant="ghost"
          size="sm"
          onPress={onBack}
          data-testid="prompts-settings-back"
        >
          ← Back
        </Button>
      </div>

      <header className={styles.pageHeader}>
        <h2 className={styles.pageTitle}>Prompts settings</h2>
        <p className={styles.pageDescription}>
          Manage your tag library and the defaults applied when you
          create a new prompt.
        </p>
      </header>

      <TagsSection />
      <TemplateSection />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Tags section — delegates to the shared <TagsLibraryEditor> so the
// chip layout matches the prompt editor's wrapping row exactly.
// ---------------------------------------------------------------------------

function TagsSection(): ReactElement {
  const tagsQuery = useTags();
  const tags = tagsQuery.data ?? [];
  return (
    <section className={styles.card} aria-labelledby="prompts-settings-tags">
      <h3 id="prompts-settings-tags" className={styles.cardHeading}>
        Tags
        <span className={styles.cardCount}>{tags.length}</span>
      </h3>
      <p className={styles.cardHint}>
        Tags created from the prompt editor land here. Click a chip to
        rename it; press Enter to save or Escape to cancel. The pill&rsquo;s
        inline &times; detaches the tag from every prompt that carries it.
      </p>
      <TagsLibraryEditor />
    </section>
  );
}

// ---------------------------------------------------------------------------
// Template section — defaults applied on `<PromptCreateDialog>` open.
// ---------------------------------------------------------------------------

function TemplateSection(): ReactElement {
  const [template, setTemplate] = useLocalStorage<PromptTemplate>(
    PROMPT_TEMPLATE_STORAGE_KEY,
    promptTemplateCodec,
    { shortDescription: "", content: "" },
  );

  return (
    <section
      className={styles.card}
      aria-labelledby="prompts-settings-template"
    >
      <h3 id="prompts-settings-template" className={styles.cardHeading}>
        New-prompt template
      </h3>
      <p className={styles.cardHint}>
        Pre-fills the &ldquo;Add prompt&rdquo; modal so you don&rsquo;t
        retype boilerplate. Leave a field blank to skip it.
      </p>

      <label className={styles.fieldLabel}>
        <span className={styles.fieldLabelText}>Short description</span>
        <input
          type="text"
          className={styles.fieldInput}
          value={template.shortDescription}
          onChange={(e) =>
            setTemplate({ ...template, shortDescription: e.target.value })
          }
          placeholder="Optional default…"
          data-testid="prompts-settings-template-shortdesc"
        />
      </label>

      <label className={styles.fieldLabel}>
        <span className={styles.fieldLabelText}>Content</span>
        <textarea
          className={styles.fieldTextarea}
          value={template.content}
          onChange={(e) =>
            setTemplate({ ...template, content: e.target.value })
          }
          placeholder="Optional default content (Markdown)…"
          rows={6}
          data-testid="prompts-settings-template-content"
        />
      </label>
    </section>
  );
}
