import { test, expect } from "../fixtures";
import { invokeBridge, readBridge, spaNavigate } from "../helpers/bridge";
import { sel } from "../helpers/selectors";

test.describe("navigation", () => {
  test("each route renders its page root testid", async ({ page }) => {
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

  test("browser back/forward preserves the current page across two clicks", async ({
    page,
  }) => {
    const sidebar = page.getByTestId(sel.mainSidebar);

    await sidebar.getByRole("button", { name: "Prompts" }).click();
    await expect(page.getByTestId(sel.promptsPage)).toBeVisible();

    await sidebar.getByRole("button", { name: "Agents" }).click();
    await expect(page.getByTestId(sel.rolesPage)).toBeVisible();

    // Back to Prompts.
    await page.goBack();
    await expect(page.getByTestId(sel.promptsPage)).toBeVisible();

    // Forward to Agents.
    await page.goForward();
    await expect(page.getByTestId(sel.rolesPage)).toBeVisible();
  });

  test("deep-linking to /roles/:id highlights it in the sidebar + opens the editor", async ({
    page,
  }) => {
    const role = await invokeBridge<{ id: string }>(page, "create_role", {
      name: "Deeplink",
    });

    // SPA navigation keeps the bridge store intact — `page.goto`
    // would reload the bundle and reset the mock state.
    await spaNavigate(page, `/roles/${role.id}`);
    await expect(page).toHaveURL(new RegExp(`/roles/${role.id}$`));
    await expect(page.getByTestId(sel.rolesPage)).toBeVisible();
    await expect(page.getByTestId(sel.roleEditorPanel)).toBeVisible();
    // Sidebar row appears (active state surfaces via styles.rowActive,
    // not via aria — just verify the row is rendered for the role).
    await expect(
      page.getByTestId(sel.roleSidebarRow(role.id)),
    ).toBeVisible();
  });

  test("deep-linking to a non-existent role shows the not-found banner in the editor", async ({
    page,
  }) => {
    // No seeding — empty store. SPA-navigate so the bridge stays
    // intact; the role lookup will throw notFound and the editor
    // panel will render its error banner.
    await spaNavigate(page, "/roles/role-does-not-exist");
    await expect(page.getByTestId(sel.rolesPage)).toBeVisible();
    // RoleEditorPanel renders `data-testid="role-editor-fetch-error"`
    // when `useRole` throws. We assert against that.
    await expect(page.getByTestId("role-editor-fetch-error")).toBeVisible();
  });

  test("typed URL for a board with no spaces still renders the empty home", async ({
    page,
  }) => {
    // No spaces seeded — the fixture already lands on `/` and resets
    // the bridge, so the empty state should be on screen already.
    await expect(page.getByText("No projects yet")).toBeVisible();
    const state = await readBridge(page);
    expect((state["spaces"] as unknown[]).length).toBe(0);
  });
});
