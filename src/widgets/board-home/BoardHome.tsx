import { useEffect, type ReactElement } from "react";
import { useLocation } from "wouter";

import { useActiveSpace } from "@app/providers/ActiveSpaceProvider";
import { useBoards } from "@entities/board";
import { boardPath } from "@app/routes";
import { PixelPetAnimalsCat } from "@shared/ui/Icon";
import { LocalStorageStore, stringCodec } from "@shared/storage";

import styles from "./BoardHome.module.css";

/**
 * Last-opened-board key per space — read by BoardHome on mount and written
 * by KanbanBoard once a board renders.
 */
export function lastBoardKey(spaceId: string): string {
  return `catique:lastBoardId:${spaceId}`;
}

/**
 * Shared store factory for the per-space "last opened board" pointer.
 * `BoardHome` reads it once on mount and `KanbanBoard` writes to it.
 * Lives in the board-home barrel so both call-sites import the same
 * function (single source of truth for the key + codec).
 */
export function lastBoardStore(spaceId: string): LocalStorageStore<string> {
  return new LocalStorageStore<string>({
    key: lastBoardKey(spaceId),
    codec: stringCodec,
  });
}

function readLastBoardId(spaceId: string | null): string | null {
  if (spaceId === null) return null;
  return lastBoardStore(spaceId).get();
}

/**
 * BoardHome — landing for `/`.
 *
 * Redirect rules:
 *   1. If active space has a remembered last-opened board still present
 *      in the boards list → navigate to /boards/<id>.
 *   2. Otherwise render the cat placeholder with a friendly caption.
 *
 * The boards-list browse page was removed (Round 19) — boards are reached
 * exclusively via the SPACES tree in the sidebar.
 */
export function BoardHome(): ReactElement {
  const { activeSpaceId } = useActiveSpace();
  const boardsQuery = useBoards();
  const [, setLocation] = useLocation();

  useEffect(() => {
    if (activeSpaceId === null) return;
    if (boardsQuery.status !== "success") return;

    const lastId = readLastBoardId(activeSpaceId);
    if (lastId === null) return;

    const stillExists = boardsQuery.data.some(
      (b) => b.id === lastId && b.spaceId === activeSpaceId,
    );
    if (stillExists) {
      setLocation(boardPath(lastId));
    }
  }, [activeSpaceId, boardsQuery.status, boardsQuery.data, setLocation]);

  return (
    <section className={styles.root} aria-labelledby="board-home-heading">
      <div className={styles.center}>
        <PixelPetAnimalsCat
          width={96}
          height={96}
          aria-hidden="true"
          className={styles.cat}
        />
        <h2 id="board-home-heading" className={styles.title}>
          Тут пока тихо
        </h2>
        <p className={styles.caption}>
          Котик уже устроился. Открой доску в сайдбаре — и поехали.
        </p>
      </div>
    </section>
  );
}
