import { useEffect, type ReactElement } from "react";
import { useLocation } from "wouter";

import { useActiveSpace } from "@app/providers/ActiveSpaceProvider";
import { useBoards } from "@entities/board";
import { boardPath, routes } from "@app/routes";
import { PixelPetAnimalsCat } from "@shared/ui/Icon";
import { lastBoardStore } from "@shared/storage";

import styles from "./BoardHome.module.css";

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
 *
 * Round-19c bug fix: BoardHome is also rendered as a *backdrop* behind
 * `<TaskDialog>` on the `/tasks/:taskId` route. Without a path guard,
 * the redirect inside the useEffect fires while the dialog is opening
 * and immediately yanks the user back to `/boards/:id`, unmounting
 * the dialog before they see it. Gate the redirect on the actual home
 * path so it only triggers when the user is genuinely at `/`.
 */
export function BoardHome(): ReactElement {
  const { activeSpaceId } = useActiveSpace();
  const boardsQuery = useBoards();
  const [location, setLocation] = useLocation();

  useEffect(() => {
    // Only redirect from the actual home path. When BoardHome renders
    // as a backdrop under `/tasks/:taskId`, the dialog is in charge and
    // we must not navigate away from underneath it.
    if (location !== routes.boards) return;
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
  }, [
    location,
    activeSpaceId,
    boardsQuery.status,
    boardsQuery.data,
    setLocation,
  ]);

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
          All quiet here
        </h2>
        <p className={styles.caption}>
          All set up. Open a board from the sidebar to get going.
        </p>
      </div>
    </section>
  );
}
