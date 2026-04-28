import type { ReactNode } from "react";
import {
  Tab as AriaTab,
  TabList as AriaTabList,
  TabPanel as AriaTabPanel,
  Tabs as AriaTabs,
  type TabListProps as AriaTabListProps,
  type TabPanelProps as AriaTabPanelProps,
  type TabProps as AriaTabProps,
  type TabsProps as AriaTabsProps,
} from "react-aria-components";

import { cn } from "@shared/lib";

import styles from "./Tabs.module.css";

/**
 * Orientation of the tab strip.
 *
 * - `horizontal` — default, tabs above the panel (settings panes,
 *   TaskDialog sections: overview / prompts / attachments / events).
 * - `vertical` — tabs in a left rail; useful for dense settings or for
 *   prompt-editor sections where vertical real estate is cheap.
 */
export type TabsOrientation = "horizontal" | "vertical";

export interface TabsProps extends Omit<AriaTabsProps, "orientation"> {
  /** @default "horizontal" */
  orientation?: TabsOrientation;
  className?: string;
  children?: ReactNode;
}

/**
 * `Tabs` — root container wrapping `react-aria-components` `Tabs`.
 *
 * Pair with `TabList`, `Tab`, and `TabPanel` (re-exports below). RAC handles
 * roving tabindex, arrow-key navigation, Home/End shortcut, and roles
 * (tablist / tab / tabpanel).
 *
 * WCAG token-pair (active tab indicator):
 * - text on selected tab: `--color-text-default` on `--color-surface-canvas`
 *   (light: 15.7:1 → AAA; dark: 12.5:1 → AAA).
 * - selected indicator stripe: `--color-accent-bg` ≥ 3:1 against canvas
 *   (UI element contrast WCAG 1.4.11).
 */
export function Tabs({
  orientation = "horizontal",
  className,
  children,
  ...rest
}: TabsProps) {
  return (
    <AriaTabs
      {...rest}
      orientation={orientation}
      className={cn(styles.tabs, styles[orientation], className)}
    >
      {children}
    </AriaTabs>
  );
}

export interface TabListProps<T extends object>
  extends Omit<AriaTabListProps<T>, "className"> {
  className?: string;
}

/** `TabList` — strip of tab triggers (`role="tablist"`). */
export function TabList<T extends object>({
  className,
  ...rest
}: TabListProps<T>) {
  return <AriaTabList<T> {...rest} className={cn(styles.list, className)} />;
}

export interface TabProps extends Omit<AriaTabProps, "className" | "children"> {
  className?: string;
  children?: ReactNode;
}

/** `Tab` — individual tab trigger (`role="tab"`). */
export function Tab({ className, children, ...rest }: TabProps) {
  return (
    <AriaTab {...rest} className={cn(styles.tab, className)}>
      {children}
    </AriaTab>
  );
}

export interface TabPanelProps
  extends Omit<AriaTabPanelProps, "className" | "children"> {
  className?: string;
  children?: ReactNode;
}

/** `TabPanel` — content shown when its matching `Tab` is selected. */
export function TabPanel({ className, children, ...rest }: TabPanelProps) {
  return (
    <AriaTabPanel {...rest} className={cn(styles.panel, className)}>
      {children}
    </AriaTabPanel>
  );
}
