/**
 * LegacyBoardRedirect — rewrite `/boards/:boardId[/settings]` to the v3
 * canonical `/spaces/:spaceId/boards/:boardId[/settings]` once the
 * board's space is known.
 *
 * The redirect is dynamic because the legacy URL doesn't carry the
 * spaceId — we look it up via the TanStack-Query-cached `useBoard`.
 *
 * Behaviour:
 *   - Loading → render a 1-line "redirecting…" placeholder for ≤200 ms.
 *   - Resolved → `navigate({ replace: true })` to the canonical URL.
 *   - Board not found → fall back to rendering the legacy detail
 *     component so the existing 404 path inside the page applies.
 *
 * See `docs/refactor-v3/decisions/D-E-legacy-route-redirect-resolver.md`.
 */
import { useEffect, type ReactElement } from "react";
import { useNavigate } from "@tanstack/react-router";

import { useBoard } from "@entities/board";
import { BoardDetailPage } from "@pages/board-detail";
import { BoardSettingsPage } from "@pages/board-settings";

import {
  spaceBoardPath,
  spaceBoardSettingsPath,
} from "../routes";

export interface LegacyBoardRedirectProps {
  boardId: string;
  fallback: "detail" | "settings";
}

export function LegacyBoardRedirect(
  props: LegacyBoardRedirectProps,
): ReactElement {
  const { boardId, fallback } = props;
  const navigate = useNavigate();
  const boardQuery = useBoard(boardId);

  useEffect(() => {
    const board = boardQuery.data;
    if (!board) return;
    const next =
      fallback === "settings"
        ? spaceBoardSettingsPath(board.spaceId, board.id)
        : spaceBoardPath(board.spaceId, board.id);
    void navigate({ to: next, replace: true });
  }, [boardQuery.data, fallback, navigate]);

  // While the lookup is in flight, mount the legacy page so the user
  // sees real content instead of a flash of empty pane. The replace-
  // navigate above kicks in as soon as `useBoard` resolves.
  if (fallback === "settings") {
    return <BoardSettingsPage />;
  }
  return <BoardDetailPage boardId={boardId} />;
}
