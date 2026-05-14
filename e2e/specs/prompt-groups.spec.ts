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

async function createGroupViaUi(page: Page, name: string): Promise<string> {
  await page.getByTestId(sel.promptsAddGroup).click();
  await expect(page.getByTestId(sel.groupCreate.root)).toBeVisible();
  await page.getByTestId(sel.groupCreate.name).fill(name);
  await page.getByTestId(sel.groupCreate.save).click();
  await expect(page.getByTestId(sel.groupCreate.root)).toHaveCount(0);

  const state = await readBridge(page);
  const groups = state["promptGroups"] as Array<[string, { name: string }]>;
  const row = groups.find(([, g]) => g.name === name);
  if (!row) throw new Error(`group ${name} not in store`);
  return row[0];
}

test.describe("prompt groups", () => {
  test("creating a group adds it to the GROUPS section", async ({ page }) => {
    await gotoPrompts(page);
    const groupId = await createGroupViaUi(page, "Onboarding");
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
    const groupId = await createGroupViaUi(page, "Triage");

    await page.getByTestId(sel.promptsAddPrompt).click();
    await page.getByTestId(sel.promptCreate.name).fill("Reproduce");
    await page.getByTestId(sel.promptCreate.content).fill("reproduce the bug");
    await page.getByTestId(sel.promptCreate.save).click();
    await expect(page.getByTestId(sel.promptCreate.root)).toHaveCount(0);

    const before = await readBridge(page);
    const promptId = (before["prompts"] as Array<[string, unknown]>)[0][0];

    // Drive the same IPC the drop handler would.
    await invokeBridge(page, "add_prompt_group_member", {
      groupId,
      promptId,
      position: 0,
    });

    const after = await readBridge(page);
    const members = (
      after["promptGroupMembers"] as Array<[string, string[]]>
    ).find(([id]) => id === groupId);
    expect(members?.[1]).toEqual([promptId]);
  });

  test("creating two groups preserves their order in the sidebar", async ({
    page,
  }) => {
    await gotoPrompts(page);
    const first = await createGroupViaUi(page, "First");
    const second = await createGroupViaUi(page, "Second");

    // Both rows visible.
    await expect(page.getByTestId(sel.groupRow(first))).toBeVisible();
    await expect(page.getByTestId(sel.groupRow(second))).toBeVisible();

    // Group store keeps creation order via `position` (= members.size on
    // create). Read the store to verify.
    const state = await readBridge(page);
    const groups = state["promptGroups"] as Array<[string, { position: bigint }]>;
    const sorted = [...groups].sort((a, b) =>
      Number(a[1].position - b[1].position),
    );
    expect(sorted[0]?.[0]).toBe(first);
    expect(sorted[1]?.[0]).toBe(second);
  });

  test("renaming a group via update_prompt_group updates the sidebar", async ({
    page,
  }) => {
    await gotoPrompts(page);
    const groupId = await createGroupViaUi(page, "Old name");

    await invokeBridge(page, "update_prompt_group", {
      id: groupId,
      name: "New name",
    });

    await expect(page.getByTestId(sel.groupRow(groupId))).toHaveAttribute(
      "aria-label",
      /New name/,
    );
  });

  test("deleting a group with members detaches those prompts silently", async ({
    page,
  }) => {
    await gotoPrompts(page);
    const groupId = await createGroupViaUi(page, "Vanish");
    const prompt = await invokeBridge<{ id: string }>(page, "create_prompt", {
      name: "Member",
      content: "member body",
    });

    await invokeBridge(page, "add_prompt_group_member", {
      groupId,
      promptId: prompt.id,
      position: 0,
    });

    // Sanity: membership is recorded.
    const before = await readBridge(page);
    const membership = (
      before["promptGroupMembers"] as Array<[string, string[]]>
    ).find(([id]) => id === groupId);
    expect(membership?.[1]).toEqual([prompt.id]);

    // Delete the group.
    await invokeBridge(page, "delete_prompt_group", { id: groupId });

    // Group is gone, but the prompt itself stays.
    const after = await readBridge(page);
    const groups = after["promptGroups"] as Array<[string, unknown]>;
    expect(groups.find(([id]) => id === groupId)).toBeUndefined();
    const prompts = after["prompts"] as Array<[string, unknown]>;
    expect(prompts.find(([id]) => id === prompt.id)).toBeDefined();
    // The membership row is also dropped.
    const memberRows = after["promptGroupMembers"] as Array<[string, string[]]>;
    expect(memberRows.find(([id]) => id === groupId)).toBeUndefined();
  });

  test("opening a group surfaces the inline group view", async ({ page }) => {
    await gotoPrompts(page);
    const groupId = await createGroupViaUi(page, "Open me");

    await page.getByTestId(sel.groupRow(groupId)).click({ force: true });
    await expect(page.getByTestId(sel.inlineGroupView.root)).toBeVisible();
  });

  test("opening group settings via the inline view's kebab routes to settings", async ({
    page,
  }) => {
    await gotoPrompts(page);
    const groupId = await createGroupViaUi(page, "Settings target");
    await page.getByTestId(sel.groupRow(groupId)).click({ force: true });
    await expect(page.getByTestId(sel.inlineGroupView.root)).toBeVisible();

    // The kebab menu has Settings; pick it.
    await page.getByTestId(sel.inlineGroupView.menu).click();
    await page.getByRole("menuitem", { name: "Settings" }).click();

    // Group settings page should render with the group's name in the
    // controlled name input.
    await expect(page.getByTestId(sel.inlineGroupSettings.root)).toBeVisible();
    await expect(
      page.getByTestId(sel.inlineGroupSettings.nameInput),
    ).toHaveValue("Settings target");
  });

  test("adding a second prompt to a group via the bridge persists in members", async ({
    page,
  }) => {
    await gotoPrompts(page);
    const groupId = await createGroupViaUi(page, "Multi");
    const p1 = await invokeBridge<{ id: string }>(page, "create_prompt", {
      name: "p1",
      content: "1",
    });
    const p2 = await invokeBridge<{ id: string }>(page, "create_prompt", {
      name: "p2",
      content: "2",
    });

    await invokeBridge(page, "add_prompt_group_member", {
      groupId,
      promptId: p1.id,
      position: 0,
    });
    await invokeBridge(page, "add_prompt_group_member", {
      groupId,
      promptId: p2.id,
      position: 1,
    });

    const state = await readBridge(page);
    const members = (
      state["promptGroupMembers"] as Array<[string, string[]]>
    ).find(([id]) => id === groupId);
    expect(members?.[1]).toEqual([p1.id, p2.id]);
  });
});
