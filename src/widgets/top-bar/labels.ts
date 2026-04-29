/**
 * Nav-view label + icon map for the top bar breadcrumb.
 *
 * Копирует содержимое из main-pane-header/labels.ts — TopBar не импортирует
 * из удалённого виджета, чтобы избежать скрытой зависимости.
 */

import type { FC, SVGProps } from "react";

import {
  PixelCodingAppsWebsitesModule,
  PixelInterfaceEssentialMessage,
  PixelInterfaceEssentialList,
  PixelBusinessProductsNetworkUser,
  PixelBusinessProductPriceTag,
  PixelInterfaceEssentialPieChartPollReport1,
  PixelDesignMagicWand,
  PixelCodingAppsWebsitesDatabase,
  PixelInterfaceEssentialSettingCog,
} from "@shared/ui/Icon";

export interface NavLabel {
  label: string;
  Icon: FC<SVGProps<SVGSVGElement>>;
}

export const NAV_LABELS: Record<string, NavLabel> = {
  boards: { label: "Boards", Icon: PixelCodingAppsWebsitesModule },
  prompts: { label: "Prompts", Icon: PixelInterfaceEssentialMessage },
  "prompt-groups": { label: "Prompt Groups", Icon: PixelInterfaceEssentialList },
  roles: { label: "Roles", Icon: PixelBusinessProductsNetworkUser },
  tags: { label: "Tags", Icon: PixelBusinessProductPriceTag },
  reports: { label: "Reports", Icon: PixelInterfaceEssentialPieChartPollReport1 },
  skills: { label: "Skills", Icon: PixelDesignMagicWand },
  "mcp-tools": { label: "MCP Tools", Icon: PixelCodingAppsWebsitesDatabase },
  spaces: { label: "Spaces", Icon: PixelCodingAppsWebsitesModule },
  settings: { label: "Settings", Icon: PixelInterfaceEssentialSettingCog },
} as const;
