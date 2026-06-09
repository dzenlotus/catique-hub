/**
 * Settings scenarios (NEW in iteration-2).
 *
 * Covers the merged Settings page TOC, theme toggle (persists via the
 * platform `localStorage`), Data card affordances, and the About card.
 */

import type { Page } from "@playwright/test";

import { test, expect } from "../fixtures";
import { readBridge } from "../helpers/bridge";
import { sel } from "../helpers/selectors";

async function gotoSettings(page: Page): Promise<void> {
  await page
    .getByTestId(sel.mainSidebar)
    .getByRole("button", { name: "Settings" })
    .click();
  await expect(page.getByTestId(sel.settings.viewScroll)).toBeVisible();
}

test.describe("settings", () => {
  test("the Settings TOC exposes every canonical section", async ({ page }) => {
    await gotoSettings(page);

    for (const id of [
      "settings-appearance",
      "settings-keyboard-shortcuts",
      "settings-data",
      "settings-about",
    ]) {
      await expect(page.getByTestId(sel.settings.nav(id))).toBeVisible();
    }
  });

  test("the seed-test-prompts button creates the canonical prompt set", async ({
    page,
  }) => {
    await gotoSettings(page);
    await page.getByTestId(sel.settings.seedPrompts).click();

    // The button fires `create_prompt` 6 times sequentially (see
    // SETTINGS_VIEW SEED_PROMPTS). Poll the bridge until they all land.
    await expect
      .poll(async () => {
        const state = await readBridge(page);
        return (state["prompts"] as unknown[]).length;
      })
      .toBe(6);

    const state = await readBridge(page);
    const names = (state["prompts"] as Array<[string, { name: string }]>)
      .map(([, p]) => p.name)
      .sort();
    expect(names).toEqual(
      [
        "Bug triage",
        "Code review",
        "Commit message",
        "Docs writer",
        "Refactor planner",
        "SQL query helper",
      ].sort(),
    );
  });

  test("the theme toggle flips the active theme indicator", async ({
    page,
  }) => {
    await gotoSettings(page);

    // Click Light, indicator reads "Light".
    await page.getByTestId(sel.settings.themeLight).click();
    await expect(page.getByTestId(sel.settings.activeThemeName)).toHaveText(
      "Light",
    );
    // Click Dark, indicator reads "Dark".
    await page.getByTestId(sel.settings.themeDark).click();
    await expect(page.getByTestId(sel.settings.activeThemeName)).toHaveText(
      "Dark",
    );
  });

  test("the About card shows the application version", async ({ page }) => {
    await gotoSettings(page);
    // The version is read from `package.json`; assert via a non-empty
    // text node rather than coupling to the exact string.
    const version = await page
      .getByTestId(sel.settings.appVersion)
      .textContent();
    expect(version?.trim().length ?? 0).toBeGreaterThan(0);
  });
});
