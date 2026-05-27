/**
 * BoardTitle — canonical page-header title for boards and similar
 * single-entity surfaces (role editor, prompt-group view, board
 * settings, …). Bundles the appearance picker + heading + optional
 * description into one layout-aware primitive so consumers stop
 * re-deriving the same flex + typography rhythm.
 *
 *   <BoardTitle
 *     size="lg"
 *     name={board.name}
 *     description={board.description}
 *     value={{ icon: board.icon, color: board.color }}
 *     onAppearanceChange={(next) => updateBoard.mutate({ id, ...next })}
 *   />
 *
 * Read-only callers omit `onAppearanceChange` — the icon then renders
 * as a static glyph instead of an `<IconColorPicker/>` trigger.
 *
 * Default icon: every render of `BoardTitle` shows SOMETHING in the
 * leading slot — when `value.icon` is null the component falls back to
 * `defaultIcon` (the design-drawing-board glyph by default) so a
 * brand-new board doesn't read as "broken icon".
 */

import { useMemo, type ReactElement } from "react";

import { cn } from "@shared/lib";

import { IconRenderer } from "../IconPicker";
import { IconColorPicker, type IconColorValue } from "../IconColorPicker";

import styles from "./BoardTitle.module.css";

export type BoardTitleSize = "sm" | "md" | "lg";

export interface BoardTitleProps {
  /** Title text. */
  name: string;
  /** Optional secondary line displayed inline after the title. */
  description?: string | null;
  /** Icon-color pair. Both fields may be `null` for a fresh entity. */
  value?: IconColorValue;
  /**
   * Editable callback. When provided, the leading slot renders an
   * `<IconColorPicker/>` so the user can change icon + color from the
   * title itself. Omit for a read-only title.
   */
  onAppearanceChange?: (next: IconColorValue) => void;
  /**
   * Typography scale. Default `"md"`. Sizes map to:
   *   - `sm`: 16 px heading, 16 px icon
   *   - `md`: 18 px heading, 18 px icon
   *   - `lg`: 22 px heading, 22 px icon (canonical page-header size)
   */
  size?: BoardTitleSize;
  /**
   * Fallback icon registry name shown when `value.icon` is `null`.
   * Defaults to `PixelDesignDrawingBoard`. Pass a different glyph for
   * non-board surfaces (e.g. a role page might prefer the maintainer
   * pixel glyph instead).
   */
  defaultIcon?: string;
  /** Optional aria-label override for the appearance picker. */
  pickerAriaLabel?: string;
  /** Optional test-id stamped on the appearance picker. */
  pickerTestId?: string;
  /** Optional class merged onto the root flex container. */
  className?: string;
}

const DEFAULT_ICON = "PixelDesignDrawingBoard";

const ICON_SIZE: Record<BoardTitleSize, number> = {
  sm: 16,
  md: 18,
  lg: 22,
};

export function BoardTitle({
  name,
  description,
  value,
  onAppearanceChange,
  size = "md",
  defaultIcon = DEFAULT_ICON,
  pickerAriaLabel,
  pickerTestId,
  className,
}: BoardTitleProps): ReactElement {
  // Effective leading glyph — the consumer's icon if set, otherwise the
  // fallback so the title never reads as "missing icon". Color is
  // preserved when only the icon was unset.
  const resolved: IconColorValue = useMemo(
    () => ({
      icon: value?.icon ?? defaultIcon,
      color: value?.color ?? null,
    }),
    [value?.icon, value?.color, defaultIcon],
  );

  const sizeClass = styles[`size${size.toUpperCase()}`] ?? styles.sizeMD;

  return (
    <div className={cn(styles.root, sizeClass, className)}>
      {onAppearanceChange !== undefined ? (
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
      ) : (
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
      )}
      <h1 className={styles.heading}>{name}</h1>
      {description !== undefined && description !== null && description !== "" ? (
        <p className={styles.description}>{description}</p>
      ) : null}
    </div>
  );
}
