/**
 * RoleSpacesSection — "Working in spaces" list for the agent editor.
 *
 * Per Project Map v3, the agent detail surfaces every space the agent
 * owns a board in. We compute the list client-side: pull every board,
 * filter by `roleId`, then pivot by `spaceId` so the user sees one
 * entry per space with its board names underneath.
 *
 * Phase 4 stub — read-only; the "Add to space" CTA + remove-from-space
 * controls ship alongside the full agent-page restructure.
 */
import { useMemo, type ReactElement } from "react";
import { useNavigate } from "@tanstack/react-router";

import { useBoards } from "@entities/board";
import type { Board } from "@entities/board";
import { useSpaces } from "@entities/space";
import type { Space } from "@entities/space";
import { spaceBoardPath, spacePath } from "@app/routes";

import styles from "./RoleSpacesSection.module.css";

export interface RoleSpacesSectionProps {
  roleId: string;
}

interface SpaceGroup {
  space: Space;
  boards: Board[];
}

function groupBySpace(boards: Board[], spaces: Space[]): SpaceGroup[] {
  const byId = new Map(spaces.map((s) => [s.id, s] as const));
  const groups = new Map<string, SpaceGroup>();

  for (const board of boards) {
    const space = byId.get(board.spaceId);
    if (space === undefined) continue;

    let group = groups.get(space.id);
    if (group === undefined) {
      group = { space, boards: [] };
      groups.set(space.id, group);
    }
    group.boards.push(board);
  }

  return [...groups.values()].sort((a, b) =>
    a.space.name.localeCompare(b.space.name),
  );
}

export function RoleSpacesSection(
  props: RoleSpacesSectionProps,
): ReactElement {
  const { roleId } = props;
  const navigate = useNavigate();
  const boardsQuery = useBoards();
  const spacesQuery = useSpaces();

  const groups = useMemo(() => {
    if (boardsQuery.status !== "success") return [];
    if (spacesQuery.status !== "success") return [];
    const owned = boardsQuery.data.filter((b) => b.roleId === roleId);
    return groupBySpace(owned, spacesQuery.data);
  }, [boardsQuery.status, boardsQuery.data, spacesQuery.status, spacesQuery.data, roleId]);

  return (
    <section className={styles.root} data-testid="role-spaces-section">
      <h3 className={styles.title}>Working in spaces</h3>
      {groups.length === 0 ? (
        <p className={styles.empty}>
          This agent isn&rsquo;t owning a board anywhere yet.
        </p>
      ) : (
        <ul className={styles.list}>
          {groups.map((group) => (
            <li key={group.space.id} className={styles.item}>
              <button
                type="button"
                className={styles.spaceLink}
                onClick={() => {
                  void navigate({ to: spacePath(group.space.id) });
                }}
                data-testid={`role-spaces-space-${group.space.id}`}
              >
                {group.space.name}
              </button>
              <ul className={styles.boardList}>
                {group.boards.map((board) => (
                  <li key={board.id}>
                    <button
                      type="button"
                      className={styles.boardLink}
                      onClick={() => {
                        void navigate({
                          to: spaceBoardPath(group.space.id, board.id),
                        });
                      }}
                      data-testid={`role-spaces-board-${board.id}`}
                    >
                      {board.name}
                    </button>
                  </li>
                ))}
              </ul>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
