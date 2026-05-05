import type { ReactElement } from "react";
import {
  PixelCodingAppsWebsitesModule,
  PixelInterfaceEssentialMessage,
  PixelDesignMagicWand,
  PixelCodingAppsWebsitesDatabase,
  PixelInterfaceEssentialSettingCog,
  PixelPetAnimalsCat,
  PixelBusinessProductPriceTag,
  PixelInterfaceEssentialPieChartPollReport1,
} from "@shared/ui/Icon";

import type { NavView } from "./MainSidebar";

// ---------------------------------------------------------------------------
// Static list of the navigable top-level views shown as nav rows in the
// main sidebar. Order here is the order the user sees.
//
// Audit-#20: Reports and Tags added to the workspace nav. Both pages
// were routable but invisible in the sidebar — orphan dead-ends. Tags
// are already used by the prompts surface; Reports is the cat-as-agent
// activity log. Both are now first-class workspace tabs.
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
    label: "Roles",
    icon: <PixelPetAnimalsCat width={18} height={18} aria-hidden />,
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
    view: "tags",
    label: "Tags",
    icon: <PixelBusinessProductPriceTag width={18} height={18} aria-hidden />,
  },
  {
    view: "reports",
    label: "Reports",
    icon: (
      <PixelInterfaceEssentialPieChartPollReport1
        width={18}
        height={18}
        aria-hidden
      />
    ),
  },
  {
    view: "settings",
    label: "Settings",
    icon: <PixelInterfaceEssentialSettingCog width={18} height={18} aria-hidden />,
  },
];
