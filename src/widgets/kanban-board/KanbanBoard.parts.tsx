/**
 * KanbanBoard.parts — small inline components extracted from KanbanBoard.tsx
 * to stay below the 30 LOC inlining threshold.
 */

import type { ReactElement } from "react";
import { ChevronDown } from "lucide-react";

import { Menu, MenuItem, MenuTrigger, Button } from "@shared/ui";

import type { GroupingMode } from "./KanbanBoard";
import styles from "./KanbanBoard.module.css";

const GROUPING_LABELS: Record<GroupingMode, string> = {
  status: "Status",
  role: "Role",
  none: "None",
};

export interface GroupingMenuProps {
  value: GroupingMode;
  onChange: (mode: GroupingMode) => void;
}

/**
 * `GroupingMenu` — the "Group by:" pill that opens a Menu popover with
 * three grouping mode options (Status / Role / None).
 *
 * Uses the shared `Menu` / `MenuTrigger` from `@shared/ui` so focus
 * management, keyboard navigation, and overlay positioning are handled
 * by react-aria-components.
 */
export function GroupingMenu({
  value,
  onChange,
}: GroupingMenuProps): ReactElement {
  const handleAction = (key: React.Key): void => {
    if (key === "status" || key === "role" || key === "none") {
      onChange(key);
    }
  };

  return (
    <MenuTrigger>
      <Button
        variant="ghost"
        size="sm"
        className={styles.groupByButton}
        aria-label="Group by"
        data-testid="kanban-grouping-trigger"
      >
        <span className={styles.groupByLabel}>Group by:</span>
        <span className={styles.groupByValue}>{GROUPING_LABELS[value]}</span>
        <ChevronDown size={12} aria-hidden="true" />
      </Button>
      <Menu<{ id: GroupingMode; name: string }>
        onAction={handleAction}
        placement="bottom end"
        aria-label="Grouping mode"
        data-testid="kanban-grouping-menu"
      >
        <MenuItem id="status" data-testid="kanban-grouping-option-status">
          Status
        </MenuItem>
        <MenuItem id="role" data-testid="kanban-grouping-option-role">
          Role
        </MenuItem>
        <MenuItem id="none" data-testid="kanban-grouping-option-none">
          None
        </MenuItem>
      </Menu>
    </MenuTrigger>
  );
}
