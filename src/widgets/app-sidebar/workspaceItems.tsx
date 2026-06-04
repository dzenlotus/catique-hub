/**
 * Top-level nav items rendered below the Spaces tree in the unified
 * AppSidebar. Order is the order the user sees them.
 *
 * Identifiers mirror the legacy MainSidebar `NavView` literals so the
 * existing `pathForView` / `viewForPath` reverse-lookup keeps working
 * — but the displayed labels follow the v3 rename (`Roles → Agents`,
 * `MCP servers → Integrations`).
 */
import type { ReactElement } from "react";

import {
  PixelCodingAppsWebsitesDatabase,
  PixelDesignMagicWand,
  PixelInterfaceEssentialMessage,
  PixelInterfaceEssentialSettingCog,
  PixelPetAnimalsCat,
} from "@shared/ui/Icon";

import type { NavView } from "@widgets/main-sidebar";

export interface AppNavItem {
  view: NavView;
  label: string;
  icon: ReactElement;
}

/**
 * The five entries below the Spaces tree per Project Map v3. `boards`
 * is NOT here — Spaces tree already navigates to boards. `settings`
 * lives at the bottom in a separate footer-style row.
 */
export const TOP_LEVEL_NAV: AppNavItem[] = [
  {
    view: "agent-roles",
    label: "Agents",
    icon: <PixelPetAnimalsCat width={16} height={16} aria-hidden />,
  },
  {
    view: "prompts",
    label: "Prompts",
    icon: <PixelInterfaceEssentialMessage width={16} height={16} aria-hidden />,
  },
  {
    view: "skills",
    label: "Skills",
    icon: <PixelDesignMagicWand width={16} height={16} aria-hidden />,
  },
  {
    view: "mcp-servers",
    label: "Integrations",
    icon: (
      <PixelCodingAppsWebsitesDatabase width={16} height={16} aria-hidden />
    ),
  },
];

export const FOOTER_NAV: AppNavItem = {
  view: "settings",
  label: "Settings",
  icon: (
    <PixelInterfaceEssentialSettingCog width={16} height={16} aria-hidden />
  ),
};
