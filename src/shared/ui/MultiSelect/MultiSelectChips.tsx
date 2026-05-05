/**
 * `MultiSelectChips` — chip rail rendered above/below a `<MultiSelect>`
 * field. Optionally drag-reorderable when wired with `@dnd-kit/react`.
 *
 * The chip primitive is a `<li>` carrying:
 *   - reorder handle (only when `reorderable` is true),
 *   - text label,
 *   - X-remove button (`aria-label="Remove <name>"`).
 */

import type { ReactElement } from "react";
import { DragDropProvider } from "@dnd-kit/react";
import { useSortable } from "@dnd-kit/react/sortable";
import { move } from "@dnd-kit/helpers";

import styles from "./MultiSelect.module.css";

export interface MultiSelectChip<T extends string> {
  id: T;
  name: string;
}

export interface MultiSelectChipsProps<T extends string> {
  items: ReadonlyArray<MultiSelectChip<T>>;
  onRemove: (id: T) => void;
  /** When true a drag-handle is rendered + dnd-kit reordering is wired. */
  reorderable: boolean;
  onReorder?: (nextIds: T[]) => void;
  /** Stable id used for `data-testid="<scope>-chip-<id>"`. */
  scope: string;
  /** dnd-kit group id — must match across drag sessions in one rail. */
  groupId: string;
}

export function MultiSelectChips<T extends string>({
  items,
  onRemove,
  reorderable,
  onReorder,
  scope,
  groupId,
}: MultiSelectChipsProps<T>): ReactElement | null {
  if (items.length === 0) return null;

  const list = (
    <ul className={styles.chips} data-testid={`${scope}-chips`}>
      {items.map((item, index) => (
        <ChipRow
          key={item.id}
          item={item}
          index={index}
          reorderable={reorderable}
          onRemove={onRemove}
          scope={scope}
          groupId={groupId}
        />
      ))}
    </ul>
  );

  if (!reorderable || onReorder === undefined) return list;

  return (
    <DragDropProvider
      onDragEnd={(event) => {
        if (event.canceled) return;
        const ids = items.map((it) => it.id);
        const bucket = { list: ids };
        const next = move(bucket, event);
        const nextIds = (next.list ?? ids) as T[];
        if (
          nextIds.length === ids.length &&
          nextIds.every((id, idx) => id === ids[idx])
        ) {
          return;
        }
        onReorder(nextIds);
      }}
    >
      {list}
    </DragDropProvider>
  );
}

interface ChipRowProps<T extends string> {
  item: MultiSelectChip<T>;
  index: number;
  reorderable: boolean;
  onRemove: (id: T) => void;
  scope: string;
  groupId: string;
}

function ChipRow<T extends string>({
  item,
  index,
  reorderable,
  onRemove,
  scope,
  groupId,
}: ChipRowProps<T>): ReactElement {
  const { ref, handleRef, isDragging } = useSortable({
    id: item.id,
    index,
    group: groupId,
    type: "multi-select-chip",
    accept: ["multi-select-chip"],
    disabled: !reorderable,
  });

  return (
    <li
      ref={(el) => ref(el)}
      className={[
        styles.chip,
        reorderable && isDragging ? styles.chipDragging : "",
      ]
        .filter(Boolean)
        .join(" ")}
      data-testid={`${scope}-chip-${item.id}`}
    >
      {reorderable ? (
        <button
          type="button"
          ref={(el) => handleRef(el)}
          className={styles.chipHandle}
          aria-label={`Reorder ${item.name}. Use drag or arrow keys.`}
          data-testid={`${scope}-chip-handle-${item.id}`}
        >
          <span aria-hidden="true">⋮⋮</span>
        </button>
      ) : null}
      <span className={styles.chipLabel}>{item.name}</span>
      <button
        type="button"
        className={styles.chipRemove}
        aria-label={`Remove ${item.name}`}
        onClick={() => onRemove(item.id)}
        data-testid={`${scope}-chip-remove-${item.id}`}
      >
        <span aria-hidden="true">×</span>
      </button>
    </li>
  );
}
