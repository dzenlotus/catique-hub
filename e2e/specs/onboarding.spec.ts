import { test, expect } from "../fixtures";
import { sel } from "../helpers/selectors";

test.describe("onboarding / empty states", () => {
  test("app boot renders the main sidebar + spaces sidebar", async ({
    page,
  }) => {
    await expect(page.getByTestId(sel.mainSidebar)).toBeVisible();
    await expect(page.getByTestId(sel.spacesSidebar)).toBeVisible();
  });

  test("main sidebar exposes every workspace nav row", async ({ page }) => {
    const sidebar = page.getByTestId(sel.mainSidebar);
    for (const label of ["Boards", "Roles", "Prompts", "Skills", "MCP servers", "Settings"]) {
      await expect(sidebar.getByRole("button", { name: label })).toBeVisible();
    }
  });

  test("spaces sidebar shows the empty state when no spaces exist", async ({
    page,
  }) => {
    await expect(page.getByText("No spaces yet")).toBeVisible();
  });

  test("clicking each nav row navigates to the corresponding page", async ({
    page,
  }) => {
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

  test("returning to /boards lands on the empty board home", async ({ page }) => {
    await page.getByTestId(sel.mainSidebar).getByRole("button", { name: "Prompts" }).click();
    await expect(page.getByTestId(sel.promptsPage)).toBeVisible();
    await page.getByTestId(sel.mainSidebar).getByRole("button", { name: "Boards" }).click();
    await expect(page.getByTestId(sel.spacesSidebar)).toBeVisible();
    await expect(page.getByRole("heading", { name: "All quiet here" })).toBeVisible();
  });
});
