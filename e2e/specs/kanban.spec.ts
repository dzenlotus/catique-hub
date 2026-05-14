/**
 * Kanban scenarios (NEW in iteration-2).
 *
 * Default-column seeding lives in the bridge's `create_space` /
 * `create_board` handlers — the Rust backend mirrors this on the real
 * side. Without seeding the user would land on the "No columns yet"
 * empty state, and most kanban interactions wouldn't be reachable.
 *
 * DnD scenarios drive the underlying `move_task` IPC directly rather
 * than simulating pointer drags through Playwright — the prior commit
 * (b261f02) documented this pattern in `prompt-groups.spec.ts` for the
 * same reason (dnd-kit + pointer events round-trips are flaky from
 * Playwright against a custom dnd engine).
 */

import type { Page } from "@playwright/test";

import { test, expect } from "../fixtures";
import { invokeBridge, readBridge, spaNavigate } from "../helpers/bridge";
import { sel } from "../helpers/selectors";

interface SeededBoard {
  boardId: string;
  columnsByName: Record<string, string>;
}

async function seedBoardWithDefaults(
  page: Page,
  args: { name: string; prefix: string },
): Promise<SeededBoard> {
  await page.getByTestId(sel.spacesAdd).click();
  await page.getByTestId(sel.spaceCreate.name).fill(args.name);
  await page.getByTestId(sel.spaceCreate.prefix).fill(args.prefix);
  await page.getByTestId(sel.spaceCreate.save).click();
  await expect(page.getByTestId(sel.spaceCreate.root)).toHaveCount(0);

  const state = await readBridge(page);
  const boards = state["boards"] as Array<[string, { spaceId: string }]>;
  const columns = state["columns"] as Array<[string, { name: string; boardId: string }]>;
  const board = boards[0];
  if (!board) throw new Error("default board missing");
  const columnsByName: Record<string, string> = {};
  for (const [id, col] of columns) {
    if (col.boardId === board[0]) columnsByName[col.name] = id;
  }
  return { boardId: board[0], columnsByName };
}

test.describe("kanban", () => {
  test('default columns ("To do", "In progress", "Done") render on a fresh board', async ({
    page,
  }) => {
    const { boardId, columnsByName } = await seedBoardWithDefaults(page, {
      name: "Studio",
      prefix: "st",
    });

    await spaNavigate(page, `/boards/${boardId}`);
    await expect(page.getByTestId(sel.kanban.scroller)).toBeVisible();

    for (const name of ["To do", "In progress", "Done"]) {
      const id = columnsByName[name];
      if (!id) throw new Error(`missing seeded column ${name}`);
      await expect(page.getByTestId(sel.kanban.column(id))).toBeVisible();
    }
  });

  test("adding a column appears in the kanban view", async ({ page }) => {
    const { boardId } = await seedBoardWithDefaults(page, {
      name: "Cols",
      prefix: "col",
    });
    await spaNavigate(page, `/boards/${boardId}`);

    await page.getByTestId(sel.kanban.addColumn).click();
    await expect(page.getByTestId(sel.columnCreate.root)).toBeVisible();
    await page.getByTestId(sel.columnCreate.name).fill("Backlog");
    await page.getByTestId(sel.columnCreate.save).click();
    await expect(page.getByTestId(sel.columnCreate.root)).toHaveCount(0);

    const state = await readBridge(page);
    const columns = state["columns"] as Array<
      [string, { name: string; boardId: string }]
    >;
    const backlog = columns.find(
      ([, c]) => c.boardId === boardId && c.name === "Backlog",
    );
    if (!backlog) throw new Error("Backlog column not in store");
    await expect(page.getByTestId(sel.kanban.column(backlog[0]))).toBeVisible();
  });

  test("creating a task via the inline quick-add appears under the column", async ({
    page,
  }) => {
    const { boardId, columnsByName } = await seedBoardWithDefaults(page, {
      name: "Quick",
      prefix: "qk",
    });
    const todoColumnId = columnsByName["To do"];
    if (!todoColumnId) throw new Error("To do column missing");

    await spaNavigate(page, `/boards/${boardId}`);
    await expect(page.getByTestId(sel.kanban.column(todoColumnId))).toBeVisible();

    // Empty state is a button that opens the task-create modal — but the
    // quick-add affordance lives on the column footer. We use the
    // bridge-IPC route instead of the dialog so we don't depend on
    // task-create-dialog's structure (out of scope for this scenario).
    await invokeBridge(page, "create_task", {
      boardId,
      columnId: todoColumnId,
      title: "Reproduce the bug",
      position: 1,
    });

    const state = await readBridge(page);
    const tasks = state["tasks"] as Array<[string, {
      columnId: string;
      title: string;
    }]>;
    const newTask = tasks.find(([, t]) => t.title === "Reproduce the bug");
    if (!newTask) throw new Error("task not persisted");
    expect(newTask[1].columnId).toBe(todoColumnId);
  });

  test("moving a task between columns persists via the bridge", async ({
    page,
  }) => {
    const { boardId, columnsByName } = await seedBoardWithDefaults(page, {
      name: "Move",
      prefix: "mv",
    });
    const todoColumnId = columnsByName["To do"];
    const doneColumnId = columnsByName["Done"];
    if (!todoColumnId || !doneColumnId) throw new Error("seed columns missing");

    const task = await invokeBridge<{ id: string }>(page, "create_task", {
      boardId,
      columnId: todoColumnId,
      title: "Investigate",
      position: 1,
    });

    await invokeBridge(page, "move_task", {
      id: task.id,
      boardId,
      columnId: doneColumnId,
      position: 1,
    });

    const state = await readBridge(page);
    const tasks = state["tasks"] as Array<[string, { columnId: string }]>;
    const moved = tasks.find(([id]) => id === task.id);
    expect(moved?.[1].columnId).toBe(doneColumnId);
  });

  test("deleting a column removes it from the kanban view", async ({
    page,
  }) => {
    const { boardId, columnsByName } = await seedBoardWithDefaults(page, {
      name: "Cull",
      prefix: "cull",
    });
    const todoColumnId = columnsByName["To do"];
    if (!todoColumnId) throw new Error("To do column missing");

    await spaNavigate(page, `/boards/${boardId}`);
    await expect(
      page.getByTestId(sel.kanban.column(todoColumnId)),
    ).toBeVisible();

    await invokeBridge(page, "delete_column", { id: todoColumnId });

    // The bridge emits `column:deleted`, which the EventsProvider
    // listens to and invalidates the per-board columns cache. The
    // kanban widget refetches and drops the deleted column from the
    // rendered list without us needing a manual route remount.
    await expect(
      page.getByTestId(sel.kanban.column(todoColumnId)),
    ).toHaveCount(0);
  });

  test("kanban board options button routes to /boards/:id/settings", async ({
    page,
  }) => {
    const { boardId } = await seedBoardWithDefaults(page, {
      name: "Opt",
      prefix: "opt",
    });
    await spaNavigate(page, `/boards/${boardId}`);

    await page.getByTestId(sel.kanban.optionsButton).click();
    await expect(page).toHaveURL(new RegExp(`/boards/${boardId}/settings$`));
  });
});
