import { useState, type ReactElement } from "react";
import {
  Button as AriaButton,
  Dialog as AriaDialog,
  DialogTrigger,
  Popover,
} from "react-aria-components";

import {
  TagChip,
  useTags,
  useDeleteTagMutation,
  useUpdateTagMutation,
} from "@entities/tag";
import {
  PROMPT_TEMPLATE_STORAGE_KEY,
  promptTemplateCodec,
  type PromptTemplate,
} from "@entities/prompt";
import { useLocalStorage } from "@shared/storage";
import { useToast } from "@app/providers/ToastProvider";
import { PixelInterfaceEssentialSettingCog } from "@shared/ui/Icon";

import styles from "./PromptsSettingsButton.module.css";

/**
 * PromptsSettingsButton — settings trigger anchored next to the
 * filter trigger on the PROMPTS section label. The popover hosts:
 *
 *   - **Tags** — list of every tag with rename + delete affordances.
 *     Tag *creation* lives on the per-prompt `<PromptTagsField>` so
 *     the user mints tags in the place that's about to attach them.
 *
 *   - **New-prompt template** — defaults applied by `<PromptCreateDialog>`
 *     for a freshly-opened modal: short description, content body.
 *     Stored in localStorage via `useLocalStorage`.
 */
export function PromptsSettingsButton(): ReactElement {
  return (
    <DialogTrigger>
      <AriaButton
        className={styles.trigger}
        aria-label="Prompts settings"
        data-testid="prompts-sidebar-settings-trigger"
      >
        <PixelInterfaceEssentialSettingCog
          width={12}
          height={12}
          aria-hidden={true}
        />
      </AriaButton>
      <Popover className={styles.popover} placement="bottom end">
        <AriaDialog
          className={styles.dialog}
          aria-label="Prompts settings"
        >
          <TagsSection />
          <TemplateSection />
        </AriaDialog>
      </Popover>
    </DialogTrigger>
  );
}

// ---------------------------------------------------------------------------
// Tags section — rename + delete every tag in the system.
// ---------------------------------------------------------------------------

function TagsSection(): ReactElement {
  const tagsQuery = useTags();
  const updateMutation = useUpdateTagMutation();
  const deleteMutation = useDeleteTagMutation();
  const { pushToast } = useToast();

  const [editingId, setEditingId] = useState<string | null>(null);
  const [draftName, setDraftName] = useState("");

  const beginRename = (id: string, name: string): void => {
    setEditingId(id);
    setDraftName(name);
  };

  const commitRename = (id: string): void => {
    const trimmed = draftName.trim();
    if (trimmed.length === 0) {
      setEditingId(null);
      return;
    }
    updateMutation.mutate(
      { id, name: trimmed },
      {
        onSuccess: () => setEditingId(null),
        onError: (err) => {
          pushToast("error", `Failed to rename tag: ${err.message}`);
        },
      },
    );
  };

  const handleDelete = (id: string, name: string): void => {
    const ok = window.confirm(
      `Delete tag "${name}"? It will be removed from every prompt that carries it.`,
    );
    if (!ok) return;
    deleteMutation.mutate(id, {
      onError: (err) => {
        pushToast("error", `Failed to delete tag: ${err.message}`);
      },
    });
  };

  const tags = tagsQuery.data ?? [];

  return (
    <section className={styles.section}>
      <header className={styles.sectionHeader}>
        <h3 className={styles.sectionTitle}>Tags</h3>
        <span className={styles.sectionCount}>{tags.length}</span>
      </header>
      {tagsQuery.status === "pending" ? (
        <p className={styles.sectionEmpty}>Loading tags…</p>
      ) : tags.length === 0 ? (
        <p className={styles.sectionEmpty}>
          No tags yet. Create one from the prompt editor.
        </p>
      ) : (
        <ul className={styles.tagList} role="list">
          {tags.map((tag) => (
            <li key={tag.id} className={styles.tagRow}>
              {editingId === tag.id ? (
                <input
                  type="text"
                  className={styles.renameInput}
                  value={draftName}
                  onChange={(e) => setDraftName(e.target.value)}
                  onBlur={() => commitRename(tag.id)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      e.preventDefault();
                      commitRename(tag.id);
                    } else if (e.key === "Escape") {
                      e.preventDefault();
                      setEditingId(null);
                    }
                  }}
                  autoFocus
                  aria-label={`Rename tag ${tag.name}`}
                  data-testid={`prompts-settings-tag-rename-${tag.id}`}
                />
              ) : (
                <button
                  type="button"
                  className={styles.tagChipBtn}
                  onClick={() => beginRename(tag.id, tag.name)}
                  aria-label={`Rename tag ${tag.name}`}
                  data-testid={`prompts-settings-tag-edit-${tag.id}`}
                >
                  <TagChip tag={tag} />
                </button>
              )}
              <button
                type="button"
                className={styles.tagDeleteBtn}
                onClick={() => handleDelete(tag.id, tag.name)}
                aria-label={`Delete tag ${tag.name}`}
                data-testid={`prompts-settings-tag-delete-${tag.id}`}
              >
                <span aria-hidden="true">×</span>
              </button>
            </li>
          ))}
        </ul>
      )}
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
    <section className={styles.section}>
      <header className={styles.sectionHeader}>
        <h3 className={styles.sectionTitle}>New-prompt template</h3>
      </header>
      <p className={styles.sectionHint}>
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
          rows={4}
          data-testid="prompts-settings-template-content"
        />
      </label>
    </section>
  );
}
