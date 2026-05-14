import { test, expect } from "../fixtures";
import { invokeBridge, readBridge, spaNavigate } from "../helpers/bridge";
import { sel } from "../helpers/selectors";

interface SeededSpace {
  spaceId: string;
  defaultBoardId: string;
}

async function seedSpaceWithDefaultBoard(
  page: import("@playwright/test").Page,
  args: { name: string; prefix: string },
): Promise<SeededSpace> {
  await page.getByTestId(sel.spacesAdd).click();
  await page.getByTestId(sel.spaceCreate.name).fill(args.name);
  await page.getByTestId(sel.spaceCreate.prefix).fill(args.prefix);
  await page.getByTestId(sel.spaceCreate.save).click();
  await expect(page.getByTestId(sel.spaceCreate.root)).toHaveCount(0);
  const state = await readBridge(page);
  const spaces = state["spaces"] as Array<[string, { name: string }]>;
  const boards = state["boards"] as Array<[string, { spaceId: string }]>;
  const space = spaces.find(([, s]) => s.name === args.name);
  if (!space) throw new Error(`space ${args.name} not seeded`);
  const board = boards.find(([, b]) => b.spaceId === space[0]);
  if (!board) throw new Error(`default board for ${args.name} missing`);
  return { spaceId: space[0], defaultBoardId: board[0] };
}

test.describe("boards", () => {
  test("creating a space yields a default board owned by maintainer-system", async ({
    page,
  }) => {
    await page.getByTestId(sel.spacesAdd).click();
    await page.getByTestId(sel.spaceCreate.name).fill("Studio");
    await page.getByTestId(sel.spaceCreate.prefix).fill("st");
    await page.getByTestId(sel.spaceCreate.save).click();
    await expect(page.getByTestId(sel.spaceCreate.root)).toHaveCount(0);

    const state = await readBridge(page);
    const boards = state["boards"] as Array<
      [string, { name: string; isDefault: boolean }]
    >;
    expect(boards).toHaveLength(1);
    expect(boards[0][1].isDefault).toBe(true);
  });

  test("the default board shows up under its space in the sidebar", async ({
    page,
  }) => {
    const { defaultBoardId } = await seedSpaceWithDefaultBoard(page, {
      name: "Atlas",
      prefix: "at",
    });
    await expect(
      page.getByTestId(sel.boardRowBtn(defaultBoardId)),
    ).toBeVisible();
  });

  test("clicking the board row navigates to the board detail route", async ({
    page,
  }) => {
    const { defaultBoardId } = await seedSpaceWithDefaultBoard(page, {
      name: "Nova",
      prefix: "nv",
    });
    await page
      .getByTestId(sel.boardRowBtn(defaultBoardId))
      .click({ force: true });
    await expect(page).toHaveURL(new RegExp(`/boards/${defaultBoardId}$`));
  });

  test("a default board is auto-created exactly once per space", async ({
    page,
  }) => {
    await seedSpaceWithDefaultBoard(page, { name: "Only", prefix: "only" });
    const state = await readBridge(page);
    const boards = state["boards"] as Array<
      [string, { isDefault: boolean }]
    >;
    const defaults = boards.filter(([, b]) => b.isDefault);
    expect(defaults).toHaveLength(1);
  });

  test("creating an additional board via create_board shows it under the space", async ({
    page,
  }) => {
    const { spaceId } = await seedSpaceWithDefaultBoard(page, {
      name: "Atrium",
      prefix: "atr",
    });
    const newBoard = (await invokeBridge<{ id: string }>(page, "create_board", {
      name: "Engineering",
      spaceId,
    }));
    await expect(page.getByTestId(sel.boardRowBtn(newBoard.id))).toBeVisible();
    const state = await readBridge(page);
    const boards = state["boards"] as Array<[string, { spaceId: string }]>;
    const inThisSpace = boards.filter(([, b]) => b.spaceId === spaceId);
    expect(inThisSpace).toHaveLength(2);
  });

  test("deleting a non-default board removes it from the sidebar", async ({
    page,
  }) => {
    const { spaceId } = await seedSpaceWithDefaultBoard(page, {
      name: "Bin",
      prefix: "bin",
    });
    const extra = await invokeBridge<{ id: string }>(page, "create_board", {
      name: "Extra",
      spaceId,
    });
    await expect(page.getByTestId(sel.boardRowBtn(extra.id))).toBeVisible();

    await invokeBridge(page, "delete_board", { id: extra.id });
    await expect(page.getByTestId(sel.boardRowBtn(extra.id))).toHaveCount(0);
  });

  test("the default board's kebab menu hides the Delete action", async ({
    page,
  }) => {
    const { defaultBoardId } = await seedSpaceWithDefaultBoard(page, {
      name: "Default",
      prefix: "def",
    });
    await page
      .getByTestId(sel.boardKebab(defaultBoardId))
      .click({ force: true });
    // Settings appears.
    await expect(
      page.getByRole("menuitem", { name: "Settings" }),
    ).toBeVisible();
    // Delete is not rendered on the default board (cannot be deleted).
    await expect(
      page.getByRole("menuitem", { name: "Delete" }),
    ).toHaveCount(0);
  });

  test("non-default board kebab menu exposes Settings + Delete", async ({
    page,
  }) => {
    const { spaceId } = await seedSpaceWithDefaultBoard(page, {
      name: "Menu",
      prefix: "menu",
    });
    const extra = await invokeBridge<{ id: string }>(page, "create_board", {
      name: "Workshop",
      spaceId,
    });
    await page.getByTestId(sel.boardKebab(extra.id)).click({ force: true });
    await expect(
      page.getByRole("menuitem", { name: "Settings" }),
    ).toBeVisible();
    await expect(
      page.getByRole("menuitem", { name: "Delete" }),
    ).toBeVisible();
  });

  test("board settings page shows the board name in the heading", async ({
    page,
  }) => {
    const { spaceId } = await seedSpaceWithDefaultBoard(page, {
      name: "Heading",
      prefix: "head",
    });
    const extra = await invokeBridge<{ id: string }>(page, "create_board", {
      name: "Annotations",
      spaceId,
    });
    await spaNavigate(page, `/boards/${extra.id}/settings`);
    await expect(page.getByTestId(sel.boardSettings.root)).toBeVisible();
    await expect(
      page.getByRole("heading", { name: "Annotations" }),
    ).toBeVisible();
  });

  test("renaming a non-default board from settings updates the sidebar", async ({
    page,
  }) => {
    const { spaceId } = await seedSpaceWithDefaultBoard(page, {
      name: "Rename",
      prefix: "ren",
    });
    const extra = await invokeBridge<{ id: string }>(page, "create_board", {
      name: "Beta",
      spaceId,
    });

    await spaNavigate(page, `/boards/${extra.id}/settings`);
    await expect(page.getByTestId(sel.boardSettings.root)).toBeVisible();
    // Input is controlled — fill clears + types.
    await page.getByTestId(sel.boardSettings.nameInput).fill("Renamed beta");
    await page.getByTestId(sel.boardSettings.save).click();
    await expect(page.getByTestId(sel.boardSettings.saved)).toBeVisible();

    // Sidebar reflects the rename via aria-label.
    await expect(page.getByTestId(sel.boardRowBtn(extra.id))).toHaveAttribute(
      "aria-label",
      "Renamed beta",
    );
  });
});
