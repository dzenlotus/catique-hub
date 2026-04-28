import type { ReactElement } from "react";
import { useDroppable } from "@dnd-kit/core";

import { RoleCard, type RoleCardProps } from "@entities/role";
import { cn } from "@shared/lib";

import styles from "./PromptDropZoneRoleCard.module.css";

export interface PromptDropZoneRoleCardProps
  extends Omit<RoleCardProps, "className"> {
  /**
   * The role id — used as the droppable id and stored in the droppable
   * data payload so `PromptAttachmentBoundary.onDragEnd` can resolve the
   * target without consulting the DOM.
   */
  roleId: string;
  /** Optional extra class forwarded to the wrapper (not to RoleCard). */
  className?: string;
}

/**
 * `PromptDropZoneRoleCard` — wraps `RoleCard` with dnd-kit droppable.
 *
 * When a prompt-attach drag is active over this card, an overlay is
 * rendered with a dashed accent border + semi-transparent accent fill
 * to clearly communicate the drop target. The overlay is placed with
 * `position: absolute` over the card so the card's own layout and
 * content are untouched.
 *
 * The droppable data payload carries `{ kind: "role", roleId }` so the
 * boundary can discriminate this target from board/column targets.
 */
export function PromptDropZoneRoleCard({
  roleId,
  className,
  ...roleCardProps
}: PromptDropZoneRoleCardProps): ReactElement {
  const { setNodeRef, isOver } = useDroppable({
    id: `role-drop:${roleId}`,
    data: { kind: "role", roleId },
  });

  return (
    <div
      ref={setNodeRef}
      className={cn(styles.wrapper, isOver && styles.over, className)}
    >
      <RoleCard {...roleCardProps} />
      {isOver && <div className={styles.overlay} aria-hidden="true" />}
    </div>
  );
}
