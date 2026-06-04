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
    // v3: "Boards" nav row removed (spaces tree navigates to boards),
    //     "Roles" renamed to "Agents", "MCP servers" renamed to "Integrations".
    const sidebar = page.getByTestId(sel.mainSidebar);
    for (const label of ["Agents", "Prompts", "Skills", "Integrations", "Settings"]) {
      await expect(sidebar.getByRole("button", { name: label })).toBeVisible();
    }
  });

  test("spaces sidebar shows the empty state when no spaces exist", async ({
    page,
  }) => {
    await expect(page.getByText("No projects yet")).toBeVisible();
  });

  test("clicking each nav row navigates to the corresponding page", async ({
    page,
  }) => {
    // v3: "Roles" renamed to "Agents", "MCP servers" renamed to "Integrations".
    const sidebar = page.getByTestId(sel.mainSidebar);

    await sidebar.getByRole("button", { name: "Prompts" }).click();
    await expect(page.getByTestId(sel.promptsPage)).toBeVisible();

    await sidebar.getByRole("button", { name: "Agents" }).click();
    await expect(page.getByTestId(sel.rolesPage)).toBeVisible();

    await sidebar.getByRole("button", { name: "Skills" }).click();
    await expect(page.getByTestId(sel.skillsPage)).toBeVisible();

    await sidebar.getByRole("button", { name: "Integrations" }).click();
    await expect(page.getByTestId(sel.mcpServersPage)).toBeVisible();
  });

  test("returning to /boards lands on the empty board home", async ({ page }) => {
    // v3: no "Boards" nav button — navigate via SPA push to the board-home root.
    await page.getByTestId(sel.mainSidebar).getByRole("button", { name: "Prompts" }).click();
    await expect(page.getByTestId(sel.promptsPage)).toBeVisible();
    await page.evaluate(() => {
      window.history.pushState({}, "", "/");
      window.dispatchEvent(new PopStateEvent("popstate"));
    });
    await expect(page.getByTestId(sel.spacesSidebar)).toBeVisible();
    await expect(page.getByRole("heading", { name: "All quiet here" })).toBeVisible();
  });

  test("empty PROMPTS section shows the empty copy", async ({ page }) => {
    await page
      .getByTestId(sel.mainSidebar)
      .getByRole("button", { name: "Prompts" })
      .click();
    await expect(page.getByTestId(sel.promptsPage)).toBeVisible();
    // PromptsSidebar renders "No prompts yet." inside the PROMPTS RailSection.
    await expect(page.getByText("No prompts yet.")).toBeVisible();
  });

  test("empty ROLES list shows the empty copy", async ({ page }) => {
    // v3: "Roles" nav renamed to "Agents".
    await page
      .getByTestId(sel.mainSidebar)
      .getByRole("button", { name: "Agents" })
      .click();
    await expect(page.getByTestId(sel.rolesPage)).toBeVisible();
    await expect(page.getByText("No agents yet.")).toBeVisible();
  });

  test("empty MCP servers list shows the empty copy", async ({ page }) => {
    // v3: "MCP servers" nav renamed to "Integrations".
    await page
      .getByTestId(sel.mainSidebar)
      .getByRole("button", { name: "Integrations" })
      .click();
    await expect(page.getByTestId(sel.mcpServersPage)).toBeVisible();
    await expect(page.getByText("No MCP servers yet.")).toBeVisible();
  });
});
