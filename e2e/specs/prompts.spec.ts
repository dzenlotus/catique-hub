import { test, expect } from "../fixtures";
import { readBridge } from "../helpers/bridge";
import { sel } from "../helpers/selectors";

async function gotoPrompts(page: import("@playwright/test").Page): Promise<void> {
  await page
    .getByTestId(sel.mainSidebar)
    .getByRole("button", { name: "Prompts" })
    .click();
  await expect(page.getByTestId(sel.promptsPage)).toBeVisible();
}

async function createPrompt(
  page: import("@playwright/test").Page,
  args: { name: string; content: string },
): Promise<string> {
  await page.getByTestId(sel.promptsAddPrompt).click();
  await expect(page.getByTestId(sel.promptCreate.root)).toBeVisible();
  await page.getByTestId(sel.promptCreate.name).fill(args.name);
  await page.getByTestId(sel.promptCreate.content).fill(args.content);
  await page.getByTestId(sel.promptCreate.save).click();
  await expect(page.getByTestId(sel.promptCreate.root)).toHaveCount(0);
  const state = await readBridge(page);
  const prompts = state["prompts"] as Array<[string, { name: string }]>;
  const row = prompts.find(([, p]) => p.name === args.name);
  if (!row) throw new Error(`prompt ${args.name} not in store`);
  return row[0];
}

test.describe("prompts", () => {
  test("creating a prompt adds a row to the PROMPTS section", async ({ page }) => {
    await gotoPrompts(page);
    const id = await createPrompt(page, {
      name: "Bug triage",
      content: "Investigate, reproduce, log.",
    });
    await expect(page.getByTestId(sel.promptRow(id))).toBeVisible();
  });

  test("the prompt persists across a navigation away-and-back", async ({
    page,
  }) => {
    await gotoPrompts(page);
    const id = await createPrompt(page, {
      name: "Cleanup",
      content: "Delete dead branches.",
    });

    await page
      .getByTestId(sel.mainSidebar)
      .getByRole("button", { name: "Boards" })
      .click();
    await expect(page.getByRole("heading", { name: "All quiet here" })).toBeVisible();

    await gotoPrompts(page);
    await expect(page.getByTestId(sel.promptRow(id))).toBeVisible();
  });

  test("creating multiple prompts shows them all in the sidebar", async ({
    page,
  }) => {
    await gotoPrompts(page);
    const a = await createPrompt(page, { name: "Alpha", content: "alpha" });
    const b = await createPrompt(page, { name: "Bravo", content: "bravo" });
    const c = await createPrompt(page, { name: "Charlie", content: "charlie" });

    await expect(page.getByTestId(sel.promptRow(a))).toBeVisible();
    await expect(page.getByTestId(sel.promptRow(b))).toBeVisible();
    await expect(page.getByTestId(sel.promptRow(c))).toBeVisible();

    const state = await readBridge(page);
    expect((state["prompts"] as unknown[]).length).toBe(3);
  });

  test("cancelling the prompt-create dialog does not add a prompt", async ({
    page,
  }) => {
    await gotoPrompts(page);
    await page.getByTestId(sel.promptsAddPrompt).click();
    await page.getByTestId(sel.promptCreate.name).fill("Aborted");
    await page.getByTestId(sel.promptCreate.cancel).click();
    await expect(page.getByTestId(sel.promptCreate.root)).toHaveCount(0);

    const state = await readBridge(page);
    expect((state["prompts"] as unknown[]).length).toBe(0);
  });
});
