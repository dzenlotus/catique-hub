/**
 * PromptTagsField — inline wrapping chip row for prompt-tag attachments.
 *
 * Round-19e: dropped the popover/select pattern. Every tag in the
 * system is rendered as a chip in a single wrap-line. Selected
 * (attached) chips get an active treatment with an in-pill `×` to
 * detach. Unattached chips look subdued; clicking them attaches.
 *
 * A trailing inline input lets the user type a new tag name; pressing
 * Enter creates the tag and auto-attaches it.
 *
 * Two operating modes:
 *
 *   - **persistent** (default): mutates the prompt's tag attachments
 *     live via `add_prompt_tag` / `remove_prompt_tag`. Used by
 *     `<PromptEditorPanel>` and `<PromptEditor>`.
 *
 *   - **draft**: no IPC; tracks the selected tag-id set via
 *     `value` + `onChange`. Used by `<PromptCreateDialog>` since the
 *     prompt doesn't exist yet — the parent applies the chosen tags
 *     after `create_prompt` succeeds.
 */

import { useMemo, useState, type ReactElement } from "react";

import {
  TagChip,
  useTags,
  useAddPromptTagMutation,
  useCreateTagMutation,
  useRemovePromptTagMutation,
} from "@entities/tag";
import type { Tag } from "@entities/tag";
import { usePromptTagsMap } from "@entities/prompt";
import { cn } from "@shared/lib";
import { useToast } from "@app/providers/ToastProvider";

import styles from "./PromptTagsField.module.css";

interface PromptTagsFieldPersistentProps {
  mode?: "persistent";
  /** The prompt whose tag set we're editing. */
  promptId: string;
}

interface PromptTagsFieldDraftProps {
  mode: "draft";
  /** Currently-selected tag ids (controlled). */
  value: ReadonlyArray<string>;
  /** Called with the next selected-id list. */
  onChange: (next: ReadonlyArray<string>) => void;
}

export type PromptTagsFieldProps =
  | PromptTagsFieldPersistentProps
  | PromptTagsFieldDraftProps;

export function PromptTagsField(props: PromptTagsFieldProps): ReactElement {
  if (props.mode === "draft") {
    return <DraftField value={props.value} onChange={props.onChange} />;
  }
  return <PersistentField promptId={props.promptId} />;
}

// ---------------------------------------------------------------------------
// Persistent — live IPC mutations against an existing prompt.
// ---------------------------------------------------------------------------

function PersistentField({ promptId }: { promptId: string }): ReactElement {
  const tagsQuery = useTags();
  const tagsMapQuery = usePromptTagsMap();
  const addMutation = useAddPromptTagMutation();
  const removeMutation = useRemovePromptTagMutation();
  const createMutation = useCreateTagMutation();
  const { pushToast } = useToast();

  const tags = tagsQuery.data ?? [];
  const tagMap = tagsMapQuery.data;

  const attachedIds = useMemo<ReadonlyArray<string>>(() => {
    if (!tagMap) return [];
    const entry = tagMap.find((e) => e.promptId === promptId);
    return entry?.tagIds ?? [];
  }, [tagMap, promptId]);

  const handleToggle = (tagId: string): void => {
    if (attachedIds.includes(tagId)) {
      removeMutation.mutate({ promptId, tagId });
    } else {
      addMutation.mutate({ promptId, tagId });
    }
  };

  const handleRemove = (tagId: string): void => {
    removeMutation.mutate({ promptId, tagId });
  };

  const handleCreate = (name: string): void => {
    createMutation.mutate(
      { name },
      {
        onSuccess: (tag) => {
          // Auto-attach the freshly-created tag to this prompt so the
          // user gets the round-trip outcome they expect.
          addMutation.mutate({ promptId, tagId: tag.id });
        },
        onError: (err) => {
          pushToast("error", `Failed to create tag: ${err.message}`);
        },
      },
    );
  };

  return (
    <ChipRow
      attachedIds={attachedIds}
      tags={tags}
      isLoading={
        tagsMapQuery.status === "pending" || tagsQuery.status === "pending"
      }
      onToggle={handleToggle}
      onRemove={handleRemove}
      onCreate={handleCreate}
    />
  );
}

// ---------------------------------------------------------------------------
// Draft — controlled local state, no IPC.
// ---------------------------------------------------------------------------

function DraftField({
  value,
  onChange,
}: {
  value: ReadonlyArray<string>;
  onChange: (next: ReadonlyArray<string>) => void;
}): ReactElement {
  const tagsQuery = useTags();
  const createMutation = useCreateTagMutation();
  const { pushToast } = useToast();
  const tags = tagsQuery.data ?? [];

  const handleToggle = (tagId: string): void => {
    if (value.includes(tagId)) {
      onChange(value.filter((id) => id !== tagId));
    } else {
      onChange([...value, tagId]);
    }
  };

  const handleRemove = (tagId: string): void => {
    onChange(value.filter((id) => id !== tagId));
  };

  const handleCreate = (name: string): void => {
    // Draft mode still creates the tag globally — there's no other
    // way to address a tag without an id. The freshly-minted id gets
    // pushed onto the local draft set so it lands on the prompt when
    // create_prompt resolves.
    createMutation.mutate(
      { name },
      {
        onSuccess: (tag) => {
          onChange([...value, tag.id]);
        },
        onError: (err) => {
          pushToast("error", `Failed to create tag: ${err.message}`);
        },
      },
    );
  };

  return (
    <ChipRow
      attachedIds={value}
      tags={tags}
      isLoading={tagsQuery.status === "pending"}
      onToggle={handleToggle}
      onRemove={handleRemove}
      onCreate={handleCreate}
    />
  );
}

// ---------------------------------------------------------------------------
// ChipRow — shared presentational shell.
// ---------------------------------------------------------------------------

interface ChipRowProps {
  attachedIds: ReadonlyArray<string>;
  tags: Tag[] | undefined;
  isLoading: boolean;
  onToggle: (tagId: string) => void;
  onRemove: (tagId: string) => void;
  /** Create a new tag with the given name, then attach it. */
  onCreate: (name: string) => void;
}

function ChipRow({
  attachedIds,
  tags,
  isLoading,
  onToggle,
  onRemove,
  onCreate,
}: ChipRowProps): ReactElement {
  const [draft, setDraft] = useState("");

  const allTags = tags ?? [];
  const trimmed = draft.trim();
  const exactMatch = allTags.some(
    (t) => t.name.toLowerCase() === trimmed.toLowerCase(),
  );
  const canCreate = trimmed.length > 0 && !exactMatch;

  const handleCreate = (): void => {
    if (!canCreate) return;
    onCreate(trimmed);
    setDraft("");
  };

  return (
    <div className={styles.root} data-testid="prompt-tags-field">
      <ul className={styles.chipRow} role="list">
        {isLoading && allTags.length === 0 ? (
          <li className={styles.empty}>Loading tags…</li>
        ) : null}
        {allTags.map((tag) => {
          const isAttached = attachedIds.includes(tag.id);
          return (
            <li key={tag.id} className={styles.chipItem}>
              {isAttached ? (
                <TagChip tag={tag} onRemove={onRemove} />
              ) : (
                <span
                  className={cn(styles.chipBtn, styles.chipBtnUnattached)}
                  data-testid={`prompt-tags-field-option-${tag.id}`}
                >
                  <button
                    type="button"
                    className={styles.chipBtnInner}
                    onClick={() => onToggle(tag.id)}
                    aria-pressed={false}
                  >
                    {tag.color !== null ? (
                      <span
                        className={styles.chipSwatch}
                        style={{ backgroundColor: tag.color }}
                        aria-hidden="true"
                      />
                    ) : null}
                    <span className={styles.chipName}>{tag.name}</span>
                  </button>
                </span>
              )}
            </li>
          );
        })}
        <li className={styles.createItem}>
          <input
            type="text"
            className={styles.createInput}
            placeholder="Add tag…"
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                handleCreate();
              } else if (e.key === "Escape") {
                e.preventDefault();
                setDraft("");
              }
            }}
            aria-label="Create a new tag"
            data-testid="prompt-tags-field-create-input"
          />
          {canCreate ? (
            <button
              type="button"
              className={styles.createBtn}
              onClick={handleCreate}
              aria-label={`Create tag ${trimmed}`}
              data-testid="prompt-tags-field-create"
            >
              + Create &ldquo;{trimmed}&rdquo;
            </button>
          ) : null}
        </li>
      </ul>
    </div>
  );
}
