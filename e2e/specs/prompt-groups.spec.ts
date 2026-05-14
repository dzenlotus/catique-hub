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

test.describe("prompt groups", () => {
  test("creating a group adds it to the GROUPS section", async ({ page }) => {
    await gotoPrompts(page);
    await page.getByTestId(sel.promptsAddGroup).click();
    await expect(page.getByTestId(sel.groupCreate.root)).toBeVisible();
    await page.getByTestId(sel.groupCreate.name).fill("Onboarding");
    await page.getByTestId(sel.groupCreate.save).click();
    await expect(page.getByTestId(sel.groupCreate.root)).toHaveCount(0);

    const state = await readBridge(page);
    const groups = state["promptGroups"] as Array<[string, { name: string }]>;
    expect(groups).toHaveLength(1);
    const groupId = groups[0][0];
    await expect(page.getByTestId(sel.groupRow(groupId))).toBeVisible();
  });

  test("attaching a prompt to a group via the bridge surfaces in membership state", async ({
    page,
  }) => {
    // The drag-and-drop UX is exercised via dnd-kit pointer events, which
    // are flaky to drive through Playwright dragTo against a custom dnd
    // engine. We exercise the same backend call path the drop handler
    // dispatches — `add_prompt_group_member` — by seeding the data and
    // verifying the membership join reflects it through the bridge API.
    await gotoPrompts(page);

    // Create a group + a prompt.
    await page.getByTestId(sel.promptsAddGroup).click();
    await page.getByTestId(sel.groupCreate.name).fill("Triage");
    await page.getByTestId(sel.groupCreate.save).click();
    await expect(page.getByTestId(sel.groupCreate.root)).toHaveCount(0);

    await page.getByTestId(sel.promptsAddPrompt).click();
    await page.getByTestId(sel.promptCreate.name).fill("Reproduce");
    await page.getByTestId(sel.promptCreate.content).fill("reproduce the bug");
    await page.getByTestId(sel.promptCreate.save).click();
    await expect(page.getByTestId(sel.promptCreate.root)).toHaveCount(0);

    const before = await readBridge(page);
    const groupId = (before["promptGroups"] as Array<[string, unknown]>)[0][0];
    const promptId = (before["prompts"] as Array<[string, unknown]>)[0][0];

    // Drive the same IPC the drop handler would.
    await page.evaluate(
      async ({ groupId, promptId }) => {
        await window.__TAURI_INTERNALS__.invoke("add_prompt_group_member", {
          groupId,
          promptId,
          position: 0,
        });
      },
      { groupId, promptId },
    );

    const after = await readBridge(page);
    const members = (
      after["promptGroupMembers"] as Array<[string, string[]]>
    ).find(([id]) => id === groupId);
    expect(members?.[1]).toEqual([promptId]);
  });
});
