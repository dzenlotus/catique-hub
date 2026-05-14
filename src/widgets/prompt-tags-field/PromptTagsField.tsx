/**
 * PromptTagsField — react-aria multi-select tag input for prompts.
 *
 * Round-19f: rebuilt on top of the shared `<MultiTagInput>` primitive
 * (which uses react-aria's `<TagGroup>` + `<ComboBox>` underneath).
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

import { useMemo, type ReactElement } from "react";

import {
  useAddPromptTagMutation,
  useCreateTagMutation,
  useRemovePromptTagMutation,
  useTags,
} from "@entities/tag";
import { usePromptTagsMap } from "@entities/prompt";
import { MultiTagInput, type MultiTagInputItem } from "@shared/ui";
import { useToast } from "@app/providers/ToastProvider";

interface PromptTagsFieldPersistentProps {
  mode?: "persistent";
  promptId: string;
}

interface PromptTagsFieldDraftProps {
  mode: "draft";
  value: ReadonlyArray<string>;
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

  const items = useMemo<MultiTagInputItem[]>(
    () =>
      (tagsQuery.data ?? []).map((t) => ({
        id: t.id,
        label: t.name,
        color: t.color,
      })),
    [tagsQuery.data],
  );

  const attachedIds = useMemo<ReadonlyArray<string>>(() => {
    const tagMap = tagsMapQuery.data;
    if (!tagMap) return [];
    const entry = tagMap.find((e) => e.promptId === promptId);
    return entry?.tagIds ?? [];
  }, [tagsMapQuery.data, promptId]);

  const handleChange = (next: ReadonlyArray<string>): void => {
    // Diff against current attachedIds and fire add/remove per delta.
    const before = new Set(attachedIds);
    const after = new Set(next);
    for (const id of after) {
      if (!before.has(id)) addMutation.mutate({ promptId, tagId: id });
    }
    for (const id of before) {
      if (!after.has(id)) removeMutation.mutate({ promptId, tagId: id });
    }
  };

  const handleCreate = (name: string): void => {
    createMutation.mutate(
      { name },
      {
        onSuccess: (tag) => {
          addMutation.mutate({ promptId, tagId: tag.id });
        },
        onError: (err) => {
          pushToast("error", `Failed to create tag: ${err.message}`);
        },
      },
    );
  };

  return (
    <MultiTagInput
      label="Tags"
      items={items}
      selectedIds={attachedIds}
      onChange={handleChange}
      onCreate={handleCreate}
      placeholder="Search or create a tag…"
      data-testid="prompt-tags-field"
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

  const items = useMemo<MultiTagInputItem[]>(
    () =>
      (tagsQuery.data ?? []).map((t) => ({
        id: t.id,
        label: t.name,
        color: t.color,
      })),
    [tagsQuery.data],
  );

  const handleCreate = (name: string): void => {
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
    <MultiTagInput
      label="Tags"
      items={items}
      selectedIds={value}
      onChange={onChange}
      onCreate={handleCreate}
      placeholder="Search or create a tag…"
      data-testid="prompt-tags-field"
    />
  );
}
