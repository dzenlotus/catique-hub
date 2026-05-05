/**
 * PromptTagsField — chip-row + add-popover for managing the tags
 * attached to a single prompt.
 *
 * Two operating modes:
 *
 *   - **persistent** (default, `mode="persistent"`): mutates the
 *     prompt's tag attachments live via `add_prompt_tag` /
 *     `remove_prompt_tag`. Used by `<PromptEditorPanel>` and
 *     `<PromptEditor>` where the prompt already exists.
 *
 *   - **draft** (`mode="draft"`): no IPC; tracks the selected tag-id
 *     set in component state via `value` + `onChange`. Used by
 *     `<PromptCreateDialog>` where the prompt isn't created yet — the
 *     parent applies the chosen tags after `create_prompt` succeeds.
 *
 * Layout matches the etalon used by `<TagsFilterButton>`: a horizontal
 * row of `<TagChip>`s with a leading "+ Add tag" trigger that opens
 * a popover with a multi-select tag list. Removing a chip detaches the
 * tag (or removes it from the draft set).
 */

import { useMemo, useState, type ReactElement } from "react";
import {
  Button as AriaButton,
  Dialog as AriaDialog,
  DialogTrigger,
  Popover,
} from "react-aria-components";

import {
  TagChip,
  useTags,
  useAddPromptTagMutation,
  useCreateTagMutation,
  useRemovePromptTagMutation,
} from "@entities/tag";
import { usePromptTagsMap } from "@entities/prompt";
import { cn } from "@shared/lib";
import { PixelInterfaceEssentialPlus } from "@shared/ui/Icon";
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
          // user gets the round-trip outcome they expect from the
          // "Create + add" affordance.
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
      isLoading={tagsMapQuery.status === "pending" || tagsQuery.status === "pending"}
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
  tags: ReturnType<typeof useTags>["data"];
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
  const [query, setQuery] = useState("");

  const tagById = useMemo(() => {
    const map = new Map<string, NonNullable<typeof tags>[number]>();
    for (const t of tags ?? []) map.set(t.id, t);
    return map;
  }, [tags]);

  const attachedTags = attachedIds
    .map((id) => tagById.get(id))
    .filter((t): t is NonNullable<typeof tags>[number] => t !== undefined);

  const trimmedQuery = query.trim();
  const lowerQuery = trimmedQuery.toLowerCase();
  const filteredTags = useMemo(() => {
    if (lowerQuery.length === 0) return tags ?? [];
    return (tags ?? []).filter((t) =>
      t.name.toLowerCase().includes(lowerQuery),
    );
  }, [tags, lowerQuery]);

  // Show the "Create '<query>'" affordance only when the user typed
  // something that doesn't already match a tag name exactly. Substring
  // matches don't block creation — the user's query may be a more
  // specific tag they want to add alongside an existing fuzzy match.
  const exactMatch = (tags ?? []).some(
    (t) => t.name.toLowerCase() === lowerQuery,
  );
  const canCreate = trimmedQuery.length > 0 && !exactMatch;

  const handleCreate = (): void => {
    if (!canCreate) return;
    onCreate(trimmedQuery);
    setQuery("");
  };

  return (
    <div className={styles.root} data-testid="prompt-tags-field">
      <ul className={styles.chipRow} role="list">
        {attachedTags.map((tag) => (
          <li key={tag.id} className={styles.chipItem}>
            <TagChip tag={tag} />
            <button
              type="button"
              className={styles.removeBtn}
              onClick={() => onRemove(tag.id)}
              aria-label={`Remove tag ${tag.name}`}
              data-testid={`prompt-tags-field-remove-${tag.id}`}
            >
              <span aria-hidden="true">×</span>
            </button>
          </li>
        ))}
        <li className={styles.addItem}>
          <DialogTrigger>
            <AriaButton
              className={styles.addBtn}
              aria-label="Add tag"
              data-testid="prompt-tags-field-add-trigger"
            >
              <PixelInterfaceEssentialPlus
                width={10}
                height={10}
                aria-hidden={true}
              />
              <span>Add tag</span>
            </AriaButton>
            <Popover className={styles.popover} placement="bottom start">
              <AriaDialog
                className={styles.popoverDialog}
                aria-label="Pick tags to attach"
              >
                <input
                  type="text"
                  className={styles.searchInput}
                  placeholder="Search or type a new tag…"
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && canCreate) {
                      e.preventDefault();
                      handleCreate();
                    }
                  }}
                  aria-label="Search tags"
                  data-testid="prompt-tags-field-search"
                />

                {isLoading ? (
                  <div className={styles.empty}>Loading tags…</div>
                ) : filteredTags.length === 0 && !canCreate ? (
                  <div className={styles.empty}>
                    {(tags ?? []).length === 0
                      ? "No tags yet."
                      : `No tags match “${trimmedQuery}”.`}
                  </div>
                ) : (
                  <ul className={styles.optionList} role="list">
                    {filteredTags.map((tag) => {
                      const checked = attachedIds.includes(tag.id);
                      return (
                        <li key={tag.id}>
                          <button
                            type="button"
                            className={cn(
                              styles.optionRow,
                              checked && styles.optionRowChecked,
                            )}
                            onClick={() => onToggle(tag.id)}
                            aria-pressed={checked}
                            data-testid={`prompt-tags-field-option-${tag.id}`}
                          >
                            <span
                              className={styles.optionSwatch}
                              style={
                                tag.color !== null
                                  ? { backgroundColor: tag.color }
                                  : undefined
                              }
                              aria-hidden="true"
                            />
                            <span className={styles.optionName}>
                              {tag.name}
                            </span>
                            {checked ? (
                              <span
                                className={styles.optionCheck}
                                aria-hidden="true"
                              >
                                ✓
                              </span>
                            ) : null}
                          </button>
                        </li>
                      );
                    })}
                    {canCreate ? (
                      <li>
                        <button
                          type="button"
                          className={cn(styles.optionRow, styles.optionCreate)}
                          onClick={handleCreate}
                          data-testid="prompt-tags-field-create"
                        >
                          <span
                            className={styles.optionPlus}
                            aria-hidden="true"
                          >
                            +
                          </span>
                          <span className={styles.optionName}>
                            Create &ldquo;{trimmedQuery}&rdquo;
                          </span>
                        </button>
                      </li>
                    ) : null}
                  </ul>
                )}
              </AriaDialog>
            </Popover>
          </DialogTrigger>
        </li>
      </ul>
    </div>
  );
}
