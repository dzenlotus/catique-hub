/**
 * GroupButton — segmented toggle-button group built on
 * `react-aria-components`'s `ToggleButtonGroup` + `ToggleButton`.
 *
 * Use it where the UI presents a small, mutually-exclusive (or
 * multi-select) cluster of choices — theme picker, density toggle,
 * board-view mode, etc.
 *
 *   <GroupButton
 *     selectionMode="single"
 *     selectedKey={activeTheme}
 *     onSelectionChange={setActiveTheme}
 *     orientation="horizontal"
 *     size="sm"
 *     ariaLabel="Theme"
 *   >
 *     <GroupButton.Item id="light">Light</GroupButton.Item>
 *     <GroupButton.Item id="dark">Dark</GroupButton.Item>
 *   </GroupButton>
 *
 * `selectionMode="single"` works with `selectedKey` / `defaultSelectedKey`;
 * `selectionMode="multiple"` works with `selectedKeys` / `defaultSelectedKeys`.
 * Both forms are passed through to RAC's `selectedKeys` Set — the helpers
 * exist purely for the single-select ergonomics so consumers don't have to
 * remember the Set + Iterable shape RAC expects natively.
 */

import { type ReactElement, type ReactNode } from "react";
import type { Key, Selection } from "react-aria-components";
import {
  ToggleButton,
  ToggleButtonGroup,
} from "react-aria-components";

import { cn } from "@shared/lib";

import styles from "./GroupButton.module.css";

export type GroupButtonSize = "sm" | "md" | "lg";
export type GroupButtonOrientation = "horizontal" | "vertical";

interface GroupButtonCommonProps {
  /**
   * Orientation drives both the layout (flex row vs column) and the
   * `data-orientation` attribute RAC stamps on the root.
   * @default "horizontal"
   */
  orientation?: GroupButtonOrientation;
  /**
   * Size scale — applied to every nested `<GroupButton.Item>`:
   *   - `sm`: 28 px row height, body-sm typography.
   *   - `md`: 32 px row height, body typography.
   *   - `lg`: 40 px row height, body-lg typography.
   * @default "md"
   */
  size?: GroupButtonSize;
  /** Disable the entire group. */
  isDisabled?: boolean;
  /** Group aria-label — required when there's no visible label nearby. */
  ariaLabel?: string;
  /** Stable test id on the group root. */
  testId?: string;
  /** Optional class merged onto the root. */
  className?: string;
  /** `<GroupButton.Item>` children. */
  children: ReactNode;
}

interface SingleSelectProps extends GroupButtonCommonProps {
  selectionMode: "single";
  selectedKey?: Key | null;
  defaultSelectedKey?: Key | null;
  onSelectionChange?: (key: Key) => void;
}

interface MultiSelectProps extends GroupButtonCommonProps {
  selectionMode: "multiple";
  selectedKeys?: ReadonlySet<Key>;
  defaultSelectedKeys?: ReadonlySet<Key>;
  onSelectionChange?: (keys: ReadonlySet<Key>) => void;
}

export type GroupButtonProps = SingleSelectProps | MultiSelectProps;

/** Convert RAC's `Selection` (all | Set) into a plain Set for the API. */
function selectionToSet(selection: Selection): ReadonlySet<Key> {
  if (selection === "all") return new Set();
  return selection;
}

export function GroupButton(props: GroupButtonProps): ReactElement {
  const {
    orientation = "horizontal",
    size = "md",
    isDisabled = false,
    ariaLabel,
    testId,
    className,
    children,
  } = props;

  // Translate the ergonomic single/multi props into RAC's Set-based shape.
  const racSelectedKeys: Iterable<Key> | undefined = (() => {
    if (props.selectionMode === "single") {
      if (props.selectedKey === undefined) return undefined;
      return props.selectedKey === null ? [] : [props.selectedKey];
    }
    return props.selectedKeys;
  })();

  const racDefaultSelectedKeys: Iterable<Key> | undefined = (() => {
    if (props.selectionMode === "single") {
      if (props.defaultSelectedKey === undefined) return undefined;
      return props.defaultSelectedKey === null ? [] : [props.defaultSelectedKey];
    }
    return props.defaultSelectedKeys;
  })();

  const handleSelectionChange = (selection: Selection): void => {
    const set = selectionToSet(selection);
    if (props.selectionMode === "single") {
      const next = set.values().next().value;
      if (next !== undefined && props.onSelectionChange !== undefined) {
        props.onSelectionChange(next);
      }
      return;
    }
    props.onSelectionChange?.(set);
  };

  return (
    <ToggleButtonGroup
      selectionMode={props.selectionMode}
      {...(racSelectedKeys !== undefined ? { selectedKeys: racSelectedKeys } : {})}
      {...(racDefaultSelectedKeys !== undefined
        ? { defaultSelectedKeys: racDefaultSelectedKeys }
        : {})}
      onSelectionChange={handleSelectionChange}
      isDisabled={isDisabled}
      orientation={orientation}
      {...(ariaLabel !== undefined ? { "aria-label": ariaLabel } : {})}
      {...(testId !== undefined ? { "data-testid": testId } : {})}
      data-size={size}
      className={cn(
        styles.group,
        orientation === "vertical" ? styles.vertical : styles.horizontal,
        className,
      )}
    >
      {children}
    </ToggleButtonGroup>
  );
}

export interface GroupButtonItemProps {
  /** Stable id — matches RAC's `Key` selection contract. */
  id: Key;
  /** Visible label text or arbitrary node. */
  children: ReactNode;
  /** Disable this single item even if the group is enabled. */
  isDisabled?: boolean;
  /** Stable test id stamped on the toggle button. */
  testId?: string;
  /** aria-label override (defaults to the visible label). */
  ariaLabel?: string;
}

function GroupButtonItem({
  id,
  children,
  isDisabled = false,
  testId,
  ariaLabel,
}: GroupButtonItemProps): ReactElement {
  return (
    <ToggleButton
      id={id}
      isDisabled={isDisabled}
      {...(testId !== undefined ? { "data-testid": testId } : {})}
      {...(ariaLabel !== undefined ? { "aria-label": ariaLabel } : {})}
      className={styles.item}
    >
      {children}
    </ToggleButton>
  );
}

GroupButton.Item = GroupButtonItem;
