import { type ReactElement } from "react";
import { useDroppable } from "@dnd-kit/react";

import { cn } from "@shared/lib";
import {
  Button,
  IconRenderer,
  Menu,
  MenuItem,
  MenuTrigger,
} from "@shared/ui";
import type { PromptGroup } from "@entities/prompt-group";

import { KebabIcon } from "./KebabIcon";
import styles from "./PromptsSidebar.module.css";

// ---------------------------------------------------------------------------
// GroupRow — single group entry in the top section of the prompts sidebar.
// ---------------------------------------------------------------------------

export interface GroupRowProps {
  group: PromptGroup;
  isActive: boolean;
  onSelect: (id: string) => void;
  onRename: (id: string) => void;
  onSettings: (id: string) => void;
  onDelete: (id: string) => void;
}

/**
 * One group entry. Acts as a droppable target so prompts can be moved
 * between groups by dragging onto the group row. The body of the row is
 * a plain `<button>` for keyboard activation.
 */
export function GroupRow({
  group,
  isActive,
  onSelect,
  onRename,
  onSettings,
  onDelete,
}: GroupRowProps): ReactElement {
  // Each group accepts prompts from any other group. The droppable id is
  // `group:<id>` so the drop handler in `PromptsSidebar` can disambiguate
  // group-targets from intra-list reorder targets.
  const { ref, isDropTarget } = useDroppable({
    id: `group:${group.id}`,
    type: "group",
    accept: ["prompt"],
  });

  return (
    <li className={styles.groupItem}>
      <div
        ref={(element) => ref(element)}
        className={cn(styles.groupRow, isActive && styles.groupRowActive)}
        data-drop-target={isDropTarget ? "true" : undefined}
        data-testid={`prompts-sidebar-group-row-${group.id}`}
      >
        {isActive && (
          <span className={styles.groupActiveStrip} aria-hidden="true" />
        )}
        <span className={styles.groupIndicator} aria-hidden="true">
          {group.icon !== null ? (
            <IconRenderer
              name={group.icon}
              width={14}
              height={14}
              {...(group.color !== null
                ? { style: { color: group.color } }
                : {})}
            />
          ) : group.color !== null ? (
            <span
              className={styles.groupSwatch}
              style={{ backgroundColor: group.color }}
            />
          ) : null}
        </span>
        <button
          type="button"
          className={styles.groupName}
          onClick={() => onSelect(group.id)}
          aria-current={isActive ? "page" : undefined}
          aria-label={`${group.name}${isActive ? " (active group)" : ""}`}
          data-testid={`prompts-sidebar-group-select-${group.id}`}
        >
          {group.name}
        </button>

        <MenuTrigger>
          <Button
            variant="ghost"
            className={styles.groupKebabBtn}
            aria-label={`Actions for group ${group.name}`}
            data-testid={`prompts-sidebar-group-kebab-${group.id}`}
          >
            <KebabIcon />
          </Button>
          <Menu
            onAction={(key) => {
              if (key === "rename") onRename(group.id);
              else if (key === "settings") onSettings(group.id);
              else if (key === "delete") onDelete(group.id);
            }}
          >
            <MenuItem id="rename">Rename</MenuItem>
            <MenuItem id="settings">Settings</MenuItem>
            <MenuItem id="delete">Delete</MenuItem>
          </Menu>
        </MenuTrigger>
      </div>
    </li>
  );
}
