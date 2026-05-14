/**
 * SelectTag primitive scenarios (NEW in iteration-2).
 *
 * Exercises the in-app SelectTag instances on the Role editor (prompts /
 * skills / MCP tools sections). The primitive itself is unit-covered in
 * `src/shared/ui/SelectTag/SelectTag.test.tsx`; these scenarios focus
 * on the contract with a real consumer + bridge round-trip.
 *
 * The role editor doesn't pass `maxVisibleChips`, so the `+N` overflow
 * scenario asserts the *baseline* behaviour (all chips visible, no
 * counter) — the bench test for the cap lives in the unit suite. The
 * `onCreate` row + `isClearable` button are similarly not exposed by
 * the role editor consumer, so those scenarios are skipped here.
 *
 * // dropped: clear-all in-app — role editor does not pass `isClearable`,
 * //         so there's no production consumer exercising the affordance.
 * //         Unit coverage in SelectTag.test.tsx is sufficient.
 * // dropped: onCreate "Create '<query>'" row — no in-app consumer of
 * //         the role editor sections supplies `onCreate`, so there's
 * //         nothing real to drive. Unit coverage covers the affordance.
 */

import type { Page } from "@playwright/test";

import { test, expect } from "../fixtures";
import { invokeBridge, readBridge, spaNavigate } from "../helpers/bridge";
import { sel } from "../helpers/selectors";

async function openRoleEditor(page: Page): Promise<string> {
  const role = await invokeBridge<{ id: string }>(page, "create_role", {
    name: "Tagged",
  });
  await spaNavigate(page, `/roles/${role.id}`);
  await expect(page.getByTestId(sel.roleEditorPanel)).toBeVisible();
  return role.id;
}

async function seedPrompts(
  page: Page,
  count: number,
): Promise<string[]> {
  const ids: string[] = [];
  for (let i = 0; i < count; i += 1) {
    const prompt = await invokeBridge<{ id: string }>(page, "create_prompt", {
      name: `p${i + 1}`,
      content: `body ${i + 1}`,
    });
    ids.push(prompt.id);
  }
  return ids;
}

test.describe("SelectTag primitive (role editor)", () => {
  test("typing in the combobox filters the dropdown options", async ({
    page,
  }) => {
    await openRoleEditor(page);
    const [p1, p2, p3] = await seedPrompts(page, 3);
    if (!p1 || !p2 || !p3) throw new Error("seed prompts missing");
    // p1/p2/p3 exist; typing "p2" should leave only p2 visible.
    const input = page.getByTestId(sel.rolePromptsInput);
    await input.focus();
    await input.fill("p2");

    // The dropdown shows the filtered list. Confirm only the matching
    // option appears by asserting count + identity.
    await expect(page.getByTestId(sel.rolePromptOption(p2))).toBeVisible();
    await expect(page.getByTestId(sel.rolePromptOption(p1))).toHaveCount(0);
    await expect(page.getByTestId(sel.rolePromptOption(p3))).toHaveCount(0);
  });

  test("clicking an option attaches it as a chip; clicking again removes it", async ({
    page,
  }) => {
    const roleId = await openRoleEditor(page);
    const [p1] = await seedPrompts(page, 1);
    if (!p1) throw new Error("seed prompt missing");

    await page.getByTestId(sel.rolePromptsInput).focus();
    await page.getByTestId(sel.rolePromptOption(p1)).click();
    // Chip appears.
    await expect(page.getByTestId(sel.rolePromptChip(p1))).toBeVisible();

    // The mutation is dispatched. Wait for bridge state to reflect it.
    await expect
      .poll(async () => {
        const state = await readBridge(page);
        const join = (state["rolePrompts"] as Array<[string, string[]]>).find(
          ([id]) => id === roleId,
        );
        return join?.[1] ?? [];
      })
      .toEqual([p1]);

    // Click the same option again to toggle off (option still in the
    // dropdown — combobox stays open after select).
    await page.getByTestId(sel.rolePromptsInput).focus();
    await page.getByTestId(sel.rolePromptOption(p1)).click();
    await expect
      .poll(async () => {
        const state = await readBridge(page);
        const join = (state["rolePrompts"] as Array<[string, string[]]>).find(
          ([id]) => id === roleId,
        );
        return join?.[1] ?? [];
      })
      .toEqual([]);
  });

  test("chip's remove button detaches a single attached option", async ({
    page,
  }) => {
    const roleId = await openRoleEditor(page);
    const [p1] = await seedPrompts(page, 1);
    if (!p1) throw new Error("seed prompt missing");

    // Attach the prompt via the dropdown so React Query's mutation
    // path runs (cache invalidation, chip render). Seeding via the
    // bridge IPC bypasses the mutation and leaves the cache stale.
    await page.getByTestId(sel.rolePromptsInput).focus();
    await page.getByTestId(sel.rolePromptOption(p1)).click();
    await expect(page.getByTestId(sel.rolePromptChip(p1))).toBeVisible();

    await page.getByTestId(sel.rolePromptChipRemove(p1)).click();
    await expect(page.getByTestId(sel.rolePromptChip(p1))).toHaveCount(0);
    await expect
      .poll(async () => {
        const state = await readBridge(page);
        const join = (state["rolePrompts"] as Array<[string, string[]]>).find(
          ([id]) => id === roleId,
        );
        return join?.[1] ?? [];
      })
      .toEqual([]);
  });

  test("backspace on the empty input pops the last attached chip", async ({
    page,
  }) => {
    const roleId = await openRoleEditor(page);
    const ids = await seedPrompts(page, 2);
    if (ids.length !== 2) throw new Error("seed prompts missing");
    // Attach via dropdown so the mutation invalidates the cache.
    for (const id of ids) {
      await page.getByTestId(sel.rolePromptsInput).focus();
      await page.getByTestId(sel.rolePromptOption(id)).click();
    }
    // Wait for both chips.
    for (const id of ids) {
      await expect(page.getByTestId(sel.rolePromptChip(id))).toBeVisible();
    }

    // Click the combobox input to focus, then send a Backspace key
    // press. With an empty input, the primitive pops the tail chip.
    await page.getByTestId(sel.rolePromptsInput).click();
    await page.keyboard.press("Backspace");
    await expect
      .poll(async () => {
        const state = await readBridge(page);
        const join = (state["rolePrompts"] as Array<[string, string[]]>).find(
          ([id]) => id === roleId,
        );
        return join?.[1] ?? [];
      })
      .toEqual([ids[0]]);
  });

  test("five+ attached chips all render in the role editor's prompts field", async ({
    page,
  }) => {
    // The role editor consumer does not set `maxVisibleChips`, so every
    // chip is visible. This scenario substitutes for the `+N` counter
    // bench — when the role editor adopts the cap, swap to asserting
    // the overflow testid lands instead.
    await openRoleEditor(page);
    const ids = await seedPrompts(page, 5);
    // Attach via dropdown clicks so React Query's mutation invalidates
    // the cache; the chips will render as the mutation settles.
    for (const id of ids) {
      await page.getByTestId(sel.rolePromptsInput).focus();
      await page.getByTestId(sel.rolePromptOption(id)).click();
    }

    for (const id of ids) {
      await expect(page.getByTestId(sel.rolePromptChip(id))).toBeVisible();
    }
    // No overflow chip rendered because the consumer didn't request it.
    await expect(page.getByTestId(sel.rolePromptsOverflow)).toHaveCount(0);
  });

  test("the skills SelectTag attaches via dropdown click", async ({ page }) => {
    const roleId = await openRoleEditor(page);
    const skill = await invokeBridge<{ id: string }>(page, "create_skill", {
      name: "Search",
      position: 0,
    });

    await page.getByTestId(sel.roleSkillsInput).focus();
    await page.getByTestId(sel.roleSkillOption(skill.id)).click();
    await expect(page.getByTestId(sel.roleSkillChip(skill.id))).toBeVisible();

    await expect
      .poll(async () => {
        const state = await readBridge(page);
        const join = (state["roleSkills"] as Array<[string, string[]]>).find(
          ([id]) => id === roleId,
        );
        return join?.[1] ?? [];
      })
      .toEqual([skill.id]);
  });

  test("the MCP tools SelectTag attaches via dropdown click", async ({
    page,
  }) => {
    const roleId = await openRoleEditor(page);
    const tool = await invokeBridge<{ id: string }>(page, "create_mcp_tool", {
      name: "fetch",
      schemaJson: "{}",
      position: 0,
    });

    await page.getByTestId(sel.roleMcpToolsInput).focus();
    await page.getByTestId(sel.roleMcpToolOption(tool.id)).click();
    await expect(
      page.getByTestId(sel.roleMcpToolChip(tool.id)),
    ).toBeVisible();

    await expect
      .poll(async () => {
        const state = await readBridge(page);
        const join = (state["roleMcpTools"] as Array<[string, string[]]>).find(
          ([id]) => id === roleId,
        );
        return join?.[1] ?? [];
      })
      .toEqual([tool.id]);
  });
});
