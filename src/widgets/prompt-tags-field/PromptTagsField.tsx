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

import { useMemo, type ReactElement } from "react";
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
  useRemovePromptTagMutation,
} from "@entities/tag";
import { usePromptTagsMap } from "@entities/prompt";
import { cn } from "@shared/lib";
import { PixelInterfaceEssentialPlus } from "@shared/ui/Icon";

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

  return (
    <ChipRow
      attachedIds={attachedIds}
      tags={tags}
      isLoading={tagsMapQuery.status === "pending" || tagsQuery.status === "pending"}
      onToggle={handleToggle}
      onRemove={handleRemove}
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

  return (
    <ChipRow
      attachedIds={value}
      tags={tags}
      isLoading={tagsQuery.status === "pending"}
      onToggle={handleToggle}
      onRemove={handleRemove}
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
}

function ChipRow({
  attachedIds,
  tags,
  isLoading,
  onToggle,
  onRemove,
}: ChipRowProps): ReactElement {
  const tagById = useMemo(() => {
    const map = new Map<string, NonNullable<typeof tags>[number]>();
    for (const t of tags ?? []) map.set(t.id, t);
    return map;
  }, [tags]);

  const attachedTags = attachedIds
    .map((id) => tagById.get(id))
    .filter((t): t is NonNullable<typeof tags>[number] => t !== undefined);

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
                {isLoading ? (
                  <div className={styles.empty}>Loading tags…</div>
                ) : (tags ?? []).length === 0 ? (
                  <div className={styles.empty}>No tags yet.</div>
                ) : (
                  <ul className={styles.optionList} role="list">
                    {(tags ?? []).map((tag) => {
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
