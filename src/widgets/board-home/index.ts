export { BoardHome } from "./BoardHome";

/**
 * Round-19c (audit F-12): `lastBoardKey` and `lastBoardStore` moved to
 * `@shared/storage` — alongside the rest of the storage primitives —
 * so consumers (e.g. KanbanBoard) no longer cross-widget-import to
 * grab a helper. Re-export the new path here for one release window
 * to soften any third-party imports; remove on next major.
 */
export { lastBoardKey, lastBoardStore } from "@shared/storage";
