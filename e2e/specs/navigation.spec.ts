import { test, expect } from "../fixtures";
import { sel } from "../helpers/selectors";

test.describe("navigation", () => {
  test("each route renders its page root testid", async ({ page }) => {
    const sidebar = page.getByTestId(sel.mainSidebar);

    await sidebar.getByRole("button", { name: "Prompts" }).click();
    await expect(page.getByTestId(sel.promptsPage)).toBeVisible();

    await sidebar.getByRole("button", { name: "Roles" }).click();
    await expect(page.getByTestId(sel.rolesPage)).toBeVisible();

    await sidebar.getByRole("button", { name: "Skills" }).click();
    await expect(page.getByTestId(sel.skillsPage)).toBeVisible();

    await sidebar.getByRole("button", { name: "MCP servers" }).click();
    await expect(page.getByTestId(sel.mcpServersPage)).toBeVisible();
  });

  test("Boards nav row toggles the spaces sidebar visibility", async ({
    page,
  }) => {
    await expect(page.getByTestId(sel.spacesSidebar)).toBeVisible();
    await page
      .getByTestId(sel.mainSidebar)
      .getByRole("button", { name: "Prompts" })
      .click();
    await expect(page.getByTestId(sel.spacesSidebar)).toHaveCount(0);
    await page
      .getByTestId(sel.mainSidebar)
      .getByRole("button", { name: "Boards" })
      .click();
    await expect(page.getByTestId(sel.spacesSidebar)).toBeVisible();
  });
});
