import { test, expect } from "../fixtures";
import { readBridge } from "../helpers/bridge";
import { sel } from "../helpers/selectors";

async function gotoSkills(page: import("@playwright/test").Page): Promise<void> {
  await page
    .getByTestId(sel.mainSidebar)
    .getByRole("button", { name: "Skills" })
    .click();
  await expect(page.getByTestId(sel.skillsPage)).toBeVisible();
}

test.describe("skills", () => {
  test("creating a skill adds it to the Skills page sidebar", async ({ page }) => {
    await gotoSkills(page);
    await page.getByTestId(sel.skillsAdd).click();
    await expect(page.getByTestId(sel.skillCreate.root)).toBeVisible();
    await page.getByTestId(sel.skillCreate.name).fill("Search code");
    await page.getByTestId(sel.skillCreate.save).click();
    await expect(page.getByTestId(sel.skillCreate.root)).toHaveCount(0);

    const state = await readBridge(page);
    const skills = state["skills"] as Array<[string, { name: string }]>;
    expect(skills).toHaveLength(1);
    expect(skills[0][1].name).toBe("Search code");
    await expect(page.getByTestId(sel.skillSidebarRow(skills[0][0]))).toBeVisible();
  });
});
