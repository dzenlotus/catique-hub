import type { ReactElement } from "react";
import {
  PixelCodingAppsWebsitesModule,
  PixelInterfaceEssentialMessage,
  PixelDesignMagicWand,
  PixelCodingAppsWebsitesDatabase,
  PixelInterfaceEssentialSettingCog,
  PixelBusinessProductsNetworkUser,
} from "@shared/ui/Icon";

import type { NavView } from "./MainSidebar";

// ---------------------------------------------------------------------------
// Static list of the 7 navigable top-level views shown as nav rows in the
// main sidebar. Order here is the order the user sees.
// ---------------------------------------------------------------------------

export interface WorkspaceItem {
  view: NavView;
  label: string;
  icon: ReactElement;
}

export const WORKSPACE_ITEMS: WorkspaceItem[] = [
  {
    view: "boards",
    label: "Boards",
    icon: <PixelCodingAppsWebsitesModule width={18} height={18} aria-hidden />,
  },
  {
    view: "agent-roles",
    label: "Agent roles",
    icon: <PixelBusinessProductsNetworkUser width={18} height={18} aria-hidden />,
  },
  {
    view: "prompts",
    label: "Prompts",
    icon: <PixelInterfaceEssentialMessage width={18} height={18} aria-hidden />,
  },
  {
    view: "skills",
    label: "Skills",
    icon: <PixelDesignMagicWand width={18} height={18} aria-hidden />,
  },
  {
    view: "mcp-servers",
    label: "MCP servers",
    icon: <PixelCodingAppsWebsitesDatabase width={18} height={18} aria-hidden />,
  },
  {
    view: "settings",
    label: "Settings",
    icon: <PixelInterfaceEssentialSettingCog width={18} height={18} aria-hidden />,
  },
];
