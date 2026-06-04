/**
 * EntityTitle — canonical heading block for one entity (board, role,
 * prompt, prompt-group, skill, space, MCP server, …). Composes a
 * leading slot (icon-color picker, status dot, heuristic icon) with
 * a heading, an optional description, optional trailing actions, and
 * an optional inline rename affordance.
 *
 * Replaces the older `BoardTitle` — same visual rhythm, but generic
 * enough to fit every page header in the app and to support inline
 * rename without a modal.
 *
 *   // Read-only board header
 *   <EntityTitle
 *     size="lg"
 *     name={board.name}
 *     description={board.description}
 *     value={{ icon: board.icon, color: board.color }}
 *     onAppearanceChange={(next) => updateBoard.mutate({ id, ...next })}
 *   />
 *
 *   // Inline-editable role title
 *   <EntityTitle
 *     editable
 *     name={role.name}
 *     onNameChange={(next) => updateRole.mutate({ id: role.id, name: next })}
 *     value={{ icon: role.icon, color: role.color }}
 *     onAppearanceChange={…}
 *   />
 *
 *   // Custom leading slot — column header with heuristic glyph and
 *   // task-count badge as trailing actions
 *   <EntityTitle
 *     size="sm"
 *     leadingSlot={<ColumnIcon name={column.name} />}
 *     name={column.name}
 *     actions={<TaskCountBadge value={taskCount} />}
 *   />
 */

import {
  useEffect,
  useRef,
  useState,
  type KeyboardEvent,
  type ReactElement,
  type ReactNode,
} from "react";

import { cn } from "@shared/lib";

import { IconRenderer } from "../IconPicker";
import { IconColorPicker, type IconColorValue } from "../IconColorPicker";

import styles from "./EntityTitle.module.css";

export type EntityTitleSize = "sm" | "md" | "lg";

export interface EntityTitleProps {
  /** Title text. */
  name: string;
  /** Optional secondary line displayed inline after the title. */
  description?: string | null;
  /** Typography scale. Default `"md"`. */
  size?: EntityTitleSize;
  /** Optional class merged onto the root flex container. */
  className?: string;

  // -------- Inline rename --------

  /**
   * When `true`, the heading becomes a click-to-edit affordance: hover
   * reveals a pencil hint, click swaps to an `<input>`, Enter / blur
   * commit via `onNameChange`, Escape cancels.
   */
  editable?: boolean;
  /** Called with the trimmed new name on commit. Skipped if empty or unchanged. */
  onNameChange?: (next: string) => void;
  /** Placeholder shown in the inline editor when the name is empty. */
  editPlaceholder?: string;
  /** Optional test-id stamped on the inline editor input. */
  editTestId?: string;

  // -------- Leading slot --------

  /**
   * Custom leading content (status dot, heuristic glyph, anything).
   * Mutually exclusive with `value` + `onAppearanceChange` — pick the
   * picker pattern OR the custom slot, not both.
   */
  leadingSlot?: ReactNode;

  // -------- Built-in IconColorPicker pattern --------

  /** Icon-color pair for the built-in picker. */
  value?: IconColorValue;
  /**
   * Callback for the built-in picker. When provided, the leading slot
   * renders an `<IconColorPicker/>` so the user can change icon + color
   * from the title itself. Omit for a read-only static icon.
   */
  onAppearanceChange?: (next: IconColorValue) => void;
  /** Fallback icon registry name shown when `value.icon` is `null`. */
  defaultIcon?: string;
  /** Optional aria-label override for the appearance picker. */
  pickerAriaLabel?: string;
  /** Optional test-id stamped on the appearance picker. */
  pickerTestId?: string;

  // -------- Trailing actions --------

  /** Trailing slot for action buttons, menu triggers, badges, … */
  actions?: ReactNode;
}

const DEFAULT_ICON = "PixelDesignDrawingBoard";

const ICON_SIZE: Record<EntityTitleSize, number> = {
  sm: 16,
  md: 18,
  lg: 22,
};

function resolveAppearance(
  value: IconColorValue | undefined,
  defaultIcon: string,
): IconColorValue {
  return {
    icon: value?.icon ?? defaultIcon,
    color: value?.color ?? null,
  };
}

export function EntityTitle({
  name,
  description,
  size = "md",
  className,
  editable = false,
  onNameChange,
  editPlaceholder,
  editTestId,
  leadingSlot,
  value,
  onAppearanceChange,
  defaultIcon = DEFAULT_ICON,
  pickerAriaLabel,
  pickerTestId,
  actions,
}: EntityTitleProps): ReactElement {
  const [isEditing, setIsEditing] = useState(false);
  const [draft, setDraft] = useState(name);
  const inputRef = useRef<HTMLInputElement | null>(null);

  // Keep `draft` in sync if the parent updates `name` while we're not editing.
  useEffect(() => {
    if (!isEditing) {
      setDraft(name);
    }
  }, [name, isEditing]);

  // Auto-focus + select-all when entering edit mode.
  useEffect(() => {
    if (isEditing && inputRef.current !== null) {
      inputRef.current.focus();
      inputRef.current.select();
    }
  }, [isEditing]);

  const startEdit = (): void => {
    if (!editable) return;
    setDraft(name);
    setIsEditing(true);
  };

  const commitEdit = (): void => {
    const trimmed = draft.trim();
    setIsEditing(false);
    if (trimmed.length === 0 || trimmed === name) return;
    onNameChange?.(trimmed);
  };

  const cancelEdit = (): void => {
    setDraft(name);
    setIsEditing(false);
  };

  const onEditorKey = (e: KeyboardEvent<HTMLInputElement>): void => {
    if (e.key === "Enter") {
      e.preventDefault();
      commitEdit();
    } else if (e.key === "Escape") {
      e.preventDefault();
      cancelEdit();
    }
  };

  const sizeClass = styles[`size${size.toUpperCase()}`] ?? styles.sizeMD;

  const leading = (() => {
    if (leadingSlot !== undefined) {
      return <span className={styles.leading}>{leadingSlot}</span>;
    }
    const resolved = resolveAppearance(value, defaultIcon);
    if (onAppearanceChange !== undefined) {
      return (
        <IconColorPicker
          value={resolved}
          onChange={onAppearanceChange}
          {...(pickerAriaLabel !== undefined
            ? { ariaLabel: pickerAriaLabel }
            : {})}
          {...(pickerTestId !== undefined
            ? { "data-testid": pickerTestId }
            : {})}
        />
      );
    }
    if (value === undefined) {
      // No appearance metadata at all — nothing to render in the leading slot.
      return null;
    }
    return (
      <IconRenderer
        name={resolved.icon ?? defaultIcon}
        width={ICON_SIZE[size]}
        height={ICON_SIZE[size]}
        className={styles.staticIcon}
        {...(resolved.color !== null
          ? { style: { color: resolved.color } }
          : {})}
        aria-hidden
      />
    );
  })();

  return (
    <div className={cn(styles.root, sizeClass, className)}>
      {leading}
      <div className={styles.body}>
        {editable && isEditing ? (
          <input
            ref={inputRef}
            className={styles.editor}
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onBlur={commitEdit}
            onKeyDown={onEditorKey}
            placeholder={editPlaceholder ?? ""}
            aria-label="Rename"
            {...(editTestId !== undefined ? { "data-testid": editTestId } : {})}
          />
        ) : editable ? (
          <button
            type="button"
            className={styles.editableTrigger}
            onClick={startEdit}
            aria-label={`Rename ${name}`}
            {...(editTestId !== undefined
              ? { "data-testid": `${editTestId}-trigger` }
              : {})}
          >
            <h1 className={styles.heading}>{name}</h1>
          </button>
        ) : (
          <h1 className={styles.heading}>{name}</h1>
        )}
        {description !== undefined && description !== null && description !== ""
          ? <p className={styles.description}>{description}</p>
          : null}
      </div>
      {actions !== undefined ? (
        <span className={styles.actions}>{actions}</span>
      ) : null}
    </div>
  );
}
