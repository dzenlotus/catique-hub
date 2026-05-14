import type { Page } from "@playwright/test";

import { test, expect } from "../fixtures";
import { invokeBridge, readBridge } from "../helpers/bridge";
import { sel } from "../helpers/selectors";

async function gotoPrompts(page: Page): Promise<void> {
  await page
    .getByTestId(sel.mainSidebar)
    .getByRole("button", { name: "Prompts" })
    .click();
  await expect(page.getByTestId(sel.promptsPage)).toBeVisible();
}

async function createPrompt(
  page: Page,
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

  test("Save stays disabled while the create form is missing required fields", async ({
    page,
  }) => {
    await gotoPrompts(page);
    await page.getByTestId(sel.promptsAddPrompt).click();

    // Both name + content empty → save disabled.
    await expect(page.getByTestId(sel.promptCreate.save)).toBeDisabled();

    await page.getByTestId(sel.promptCreate.name).fill("Only name");
    // Name set, content still empty → save still disabled (Rust + UI
    // both reject content === "" for prompts).
    await expect(page.getByTestId(sel.promptCreate.save)).toBeDisabled();

    await page.getByTestId(sel.promptCreate.content).fill("Body text");
    await expect(page.getByTestId(sel.promptCreate.save)).toBeEnabled();
  });

  test("editing a prompt's content via update_prompt persists", async ({
    page,
  }) => {
    await gotoPrompts(page);
    const id = await createPrompt(page, {
      name: "Editable",
      content: "v1 body",
    });

    // The content editor is a MarkdownField which renders as a
    // view-button until clicked into edit mode — driving the
    // click-into-edit + textarea-fill dance is brittle in Playwright.
    // The IPC path is what matters; this scenario proves
    // `update_prompt` round-trips, which is the same code path the
    // editor's Save button dispatches.
    await invokeBridge(page, "update_prompt", { id, content: "v2 body" });

    const state = await readBridge(page);
    const prompts = state["prompts"] as Array<[string, { content: string }]>;
    expect(prompts.find(([pid]) => pid === id)?.[1].content).toBe("v2 body");
  });

  test("All Prompts entry resets the group selection", async ({ page }) => {
    await gotoPrompts(page);

    // Seed a group via the bridge so we have something to navigate away
    // from; landing on a group flips selection state inside the page.
    const group = await invokeBridge<{ id: string }>(
      page,
      "create_prompt_group",
      { name: "Setup" },
    );

    // Pick the group from the sidebar.
    await page.getByTestId(sel.groupRow(group.id)).click({ force: true });
    await expect(page.getByTestId(sel.inlineGroupView.root)).toBeVisible();

    // Click "All Prompts" to drop back to the grid view.
    await page.getByTestId(sel.promptsAllPrompts).click();
    await expect(page.getByTestId(sel.inlineGroupView.root)).toHaveCount(0);
  });

  test("opening then closing the editor via Cancel routes back to the grid", async ({
    page,
  }) => {
    await gotoPrompts(page);
    const id = await createPrompt(page, {
      name: "ClosableP",
      content: "anything",
    });

    await page.getByTestId(sel.promptRow(id)).click({ force: true });
    await expect(page.getByTestId(sel.promptEditorPanel.root)).toBeVisible();

    await page.getByTestId(sel.promptEditorPanel.cancel).click();
    await expect(page.getByTestId(sel.promptEditorPanel.root)).toHaveCount(0);
  });

  test("creating a prompt with a color persists the color through the bridge", async ({
    page,
  }) => {
    await gotoPrompts(page);

    // Drive the IPC directly so the chosen color sticks (the appearance
    // picker is non-trivial to drive without a stable popover testid;
    // this scenario exists to prove the bridge stores the color).
    const created = await invokeBridge<{ id: string }>(page, "create_prompt", {
      name: "Coloured",
      content: "uses red",
      color: "#e11d48",
    });

    const state = await readBridge(page);
    const prompts = state["prompts"] as Array<[string, { color: string | null }]>;
    const row = prompts.find(([id]) => id === created.id);
    expect(row?.[1].color).toBe("#e11d48");
    // The sidebar still renders the row — proves the queries refreshed.
    await expect(page.getByTestId(sel.promptRow(created.id))).toBeVisible();
  });

  test("deleting a prompt clears its row from the sidebar", async ({ page }) => {
    await gotoPrompts(page);
    const id = await createPrompt(page, {
      name: "Doomed",
      content: "to delete",
    });
    await expect(page.getByTestId(sel.promptRow(id))).toBeVisible();

    await invokeBridge(page, "delete_prompt", { id });
    await expect(page.getByTestId(sel.promptRow(id))).toHaveCount(0);
  });

  test("two prompts retain their independent rows after one is renamed", async ({
    page,
  }) => {
    await gotoPrompts(page);
    const a = await createPrompt(page, { name: "Apple", content: "a" });
    const b = await createPrompt(page, { name: "Banana", content: "b" });

    await invokeBridge(page, "update_prompt", { id: a, name: "Apricot" });

    // Sidebar refetches on mutation invalidation. Wait for the renamed
    // row's aria-label to update and the second row to stay intact.
    await expect(page.getByTestId(sel.promptRow(a))).toHaveAttribute(
      "aria-label",
      /Apricot/,
    );
    await expect(page.getByTestId(sel.promptRow(b))).toBeVisible();
  });

  test("clicking a prompt row opens its editor seeded with the prompt's name", async ({
    page,
  }) => {
    await gotoPrompts(page);
    const id = await createPrompt(page, {
      name: "Seeded name",
      content: "seeded body",
    });

    await page.getByTestId(sel.promptRow(id)).click({ force: true });
    await expect(page.getByTestId(sel.promptEditorPanel.root)).toBeVisible();
    // The editor's name input is controlled from the loaded prompt —
    // assert via inputValue rather than DOM text so we follow React's
    // single source of truth.
    await expect(page.getByTestId(sel.promptEditorPanel.nameInput)).toHaveValue(
      "Seeded name",
    );
  });
});
