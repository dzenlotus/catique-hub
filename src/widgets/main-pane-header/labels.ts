/**
 * Shared nav-view label + icon map for the main pane header.
 *
 * Mirrors the `NAV_ITEMS` array in `Sidebar.tsx` exactly so both surfaces
 * stay in sync without importing internal sidebar internals.
 */

import {
  LayoutGrid,
  FileText,
  FolderTree,
  UserCircle2,
  Tag,
  FileBarChart,
  Wrench,
  Cog,
  Globe,
  Settings,
} from "lucide-react";
import type { FC } from "react";

export interface NavLabel {
  label: string;
  Icon: FC<{ size?: number; "aria-hidden"?: boolean | "true" | "false" }>;
}

export const NAV_LABELS: Record<string, NavLabel> = {
  boards: { label: "Boards", Icon: LayoutGrid },
  prompts: { label: "Prompts", Icon: FileText },
  "prompt-groups": { label: "Prompt Groups", Icon: FolderTree },
  roles: { label: "Roles", Icon: UserCircle2 },
  tags: { label: "Tags", Icon: Tag },
  reports: { label: "Reports", Icon: FileBarChart },
  skills: { label: "Skills", Icon: Wrench },
  "mcp-tools": { label: "MCP Tools", Icon: Cog },
  spaces: { label: "Spaces", Icon: Globe },
  settings: { label: "Settings", Icon: Settings },
} as const;
