/**
 * Nav-view label + icon map for the top bar breadcrumb.
 *
 * Копирует содержимое из main-pane-header/labels.ts — TopBar не импортирует
 * из удалённого виджета, чтобы избежать скрытой зависимости.
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
  Icon: FC<{ size?: number; "aria-hidden"?: boolean | "true" | "false"; className?: string }>;
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
