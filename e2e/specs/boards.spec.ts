import { test, expect } from "../fixtures";
import { readBridge } from "../helpers/bridge";
import { sel } from "../helpers/selectors";

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
    await page.getByTestId(sel.spacesAdd).click();
    await page.getByTestId(sel.spaceCreate.name).fill("Atlas");
    await page.getByTestId(sel.spaceCreate.prefix).fill("at");
    await page.getByTestId(sel.spaceCreate.save).click();
    await expect(page.getByTestId(sel.spaceCreate.root)).toHaveCount(0);

    const state = await readBridge(page);
    const boards = state["boards"] as Array<[string, { name: string }]>;
    const boardId = boards[0][0];

    await expect(page.getByTestId(sel.boardRowBtn(boardId))).toBeVisible();
  });

  test("clicking the board row navigates to the board detail route", async ({
    page,
  }) => {
    await page.getByTestId(sel.spacesAdd).click();
    await page.getByTestId(sel.spaceCreate.name).fill("Nova");
    await page.getByTestId(sel.spaceCreate.prefix).fill("nv");
    await page.getByTestId(sel.spaceCreate.save).click();
    await expect(page.getByTestId(sel.spaceCreate.root)).toHaveCount(0);

    const state = await readBridge(page);
    const boards = state["boards"] as Array<[string, unknown]>;
    const boardId = boards[0][0];

    await page.getByTestId(sel.boardRowBtn(boardId)).click({ force: true });
    await expect(page).toHaveURL(new RegExp(`/boards/${boardId}$`));
  });
});
