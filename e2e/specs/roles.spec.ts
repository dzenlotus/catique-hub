import type { Page } from "@playwright/test";

import { test, expect } from "../fixtures";
import { invokeBridge, readBridge } from "../helpers/bridge";
import { sel } from "../helpers/selectors";

async function gotoRoles(page: Page): Promise<void> {
  // v3: "Roles" nav label renamed to "Agents".
  await page
    .getByTestId(sel.mainSidebar)
    .getByRole("button", { name: "Agents" })
    .click();
  await expect(page.getByTestId(sel.rolesPage)).toBeVisible();
}

async function createRole(page: Page, name: string): Promise<string> {
  await page.getByTestId(sel.rolesAdd).click();
  await expect(page.getByTestId(sel.roleCreate.root)).toBeVisible();
  await page.getByTestId(sel.roleCreate.name).fill(name);
  await page.getByTestId(sel.roleCreate.save).click();
  await expect(page.getByTestId(sel.roleCreate.root)).toHaveCount(0);
  const state = await readBridge(page);
  const roles = state["roles"] as Array<[string, { name: string }]>;
  const row = roles.find(([, r]) => r.name === name);
  if (!row) throw new Error(`role ${name} not in store`);
  return row[0];
}

test.describe("roles", () => {
  test("creating a role adds it to the Roles page sidebar", async ({ page }) => {
    await gotoRoles(page);
    const id = await createRole(page, "Maintainer");
    await expect(page.getByTestId(sel.roleSidebarRow(id))).toBeVisible();
  });

  test("attaching a prompt to a role via add_role_prompt persists in state", async ({
    page,
  }) => {
    await gotoRoles(page);
    const roleId = await createRole(page, "Reviewer");

    // Seed a prompt via the bridge to skip the prompt-create dialog.
    const prompt = await invokeBridge<{ id: string }>(page, "create_prompt", {
      name: "Skim PR",
      content: "Skim incoming changesets.",
    });

    await invokeBridge(page, "set_role_prompts", {
      roleId,
      promptIds: [prompt.id],
    });

    const after = await readBridge(page);
    const attached = (after["rolePrompts"] as Array<[string, string[]]>).find(
      ([id]) => id === roleId,
    );
    expect(attached?.[1]).toEqual([prompt.id]);
  });

  test("removing an attached prompt from a role clears the join row", async ({
    page,
  }) => {
    await gotoRoles(page);
    const roleId = await createRole(page, "Janitor");

    const prompt = await invokeBridge<{ id: string }>(page, "create_prompt", {
      name: "Sweep",
      content: "Sweep stale tasks.",
    });

    await invokeBridge(page, "add_role_prompt", {
      roleId,
      promptId: prompt.id,
      position: 0,
    });
    await invokeBridge(page, "remove_role_prompt", {
      roleId,
      promptId: prompt.id,
    });

    const after = await readBridge(page);
    const attached = (after["rolePrompts"] as Array<[string, string[]]>).find(
      ([id]) => id === roleId,
    );
    expect(attached?.[1] ?? []).toEqual([]);
  });

  test("attaching a skill to a role records it on roleSkills", async ({
    page,
  }) => {
    await gotoRoles(page);
    const roleId = await createRole(page, "Architect");

    const skill = await invokeBridge<{ id: string }>(page, "create_skill", {
      name: "Search",
      position: 0,
    });

    await invokeBridge(page, "add_role_skill", {
      roleId,
      skillId: skill.id,
      position: 0,
    });

    const after = await readBridge(page);
    const attached = (after["roleSkills"] as Array<[string, string[]]>).find(
      ([id]) => id === roleId,
    );
    expect(attached?.[1]).toEqual([skill.id]);
  });

  test("creating a role with a color round-trips through the bridge", async ({
    page,
  }) => {
    await gotoRoles(page);

    // Drive via the bridge IPC so the chosen color sticks without
    // wrestling the appearance picker popover.
    const created = await invokeBridge<{ id: string }>(page, "create_role", {
      name: "Coloured",
      content: "",
      color: "#0ea5e9",
    });

    const state = await readBridge(page);
    const role = (state["roles"] as Array<[string, { color: string | null }]>).find(
      ([id]) => id === created.id,
    );
    expect(role?.[1].color).toBe("#0ea5e9");
  });

  test("attaching three prompts via set_role_prompts persists order", async ({
    page,
  }) => {
    await gotoRoles(page);
    const roleId = await createRole(page, "Curator");

    const a = await invokeBridge<{ id: string }>(page, "create_prompt", {
      name: "p1",
      content: "1",
    });
    const b = await invokeBridge<{ id: string }>(page, "create_prompt", {
      name: "p2",
      content: "2",
    });
    const c = await invokeBridge<{ id: string }>(page, "create_prompt", {
      name: "p3",
      content: "3",
    });

    await invokeBridge(page, "set_role_prompts", {
      roleId,
      promptIds: [a.id, b.id, c.id],
    });

    const state = await readBridge(page);
    const attached = (state["rolePrompts"] as Array<[string, string[]]>).find(
      ([id]) => id === roleId,
    );
    expect(attached?.[1]).toEqual([a.id, b.id, c.id]);

    // Reordering via the same IPC writes a fresh ordered list.
    await invokeBridge(page, "set_role_prompts", {
      roleId,
      promptIds: [c.id, a.id, b.id],
    });
    const after = await readBridge(page);
    const reordered = (after["rolePrompts"] as Array<[string, string[]]>).find(
      ([id]) => id === roleId,
    );
    expect(reordered?.[1]).toEqual([c.id, a.id, b.id]);
  });

  test("attaching an MCP tool to a role persists in roleMcpTools", async ({
    page,
  }) => {
    await gotoRoles(page);
    const roleId = await createRole(page, "Tooler");

    const tool = await invokeBridge<{ id: string }>(page, "create_mcp_tool", {
      name: "fetch",
      schemaJson: "{}",
      position: 0,
    });

    await invokeBridge(page, "add_role_mcp_tool", {
      roleId,
      mcpToolId: tool.id,
      position: 0,
    });

    const state = await readBridge(page);
    const attached = (
      state["roleMcpTools"] as Array<[string, string[]]>
    ).find(([id]) => id === roleId);
    expect(attached?.[1]).toEqual([tool.id]);
  });

  test("detaching all attached skills clears roleSkills", async ({ page }) => {
    await gotoRoles(page);
    const roleId = await createRole(page, "Clearer");
    const s1 = await invokeBridge<{ id: string }>(page, "create_skill", {
      name: "s1",
      position: 0,
    });
    const s2 = await invokeBridge<{ id: string }>(page, "create_skill", {
      name: "s2",
      position: 1,
    });

    await invokeBridge(page, "add_role_skill", {
      roleId,
      skillId: s1.id,
      position: 0,
    });
    await invokeBridge(page, "add_role_skill", {
      roleId,
      skillId: s2.id,
      position: 1,
    });
    await invokeBridge(page, "remove_role_skill", {
      roleId,
      skillId: s1.id,
    });
    await invokeBridge(page, "remove_role_skill", {
      roleId,
      skillId: s2.id,
    });

    const state = await readBridge(page);
    const attached = (state["roleSkills"] as Array<[string, string[]]>).find(
      ([id]) => id === roleId,
    );
    expect(attached?.[1] ?? []).toEqual([]);
  });

  test("removing an MCP tool from a role clears the join row", async ({
    page,
  }) => {
    await gotoRoles(page);
    const roleId = await createRole(page, "ToolRemoved");
    const t = await invokeBridge<{ id: string }>(page, "create_mcp_tool", {
      name: "rm-target",
      schemaJson: "{}",
      position: 0,
    });
    await invokeBridge(page, "add_role_mcp_tool", {
      roleId,
      mcpToolId: t.id,
      position: 0,
    });
    await invokeBridge(page, "remove_role_mcp_tool", {
      roleId,
      mcpToolId: t.id,
    });

    const state = await readBridge(page);
    const attached = (
      state["roleMcpTools"] as Array<[string, string[]]>
    ).find(([id]) => id === roleId);
    expect(attached?.[1] ?? []).toEqual([]);
  });

  test("selecting a role from the sidebar routes to /roles/:id and highlights the row", async ({
    page,
  }) => {
    await gotoRoles(page);
    const id = await createRole(page, "Routed");

    await page.getByTestId(sel.roleSidebarRow(id)).click({ force: true });
    await expect(page).toHaveURL(new RegExp(`/roles/${id}$`));
    await expect(page.getByTestId(sel.roleEditorPanel)).toBeVisible();
  });

  test("opening a role's editor seeds the name input from the role's data", async ({
    page,
  }) => {
    await gotoRoles(page);
    const id = await createRole(page, "Named");
    await page.getByTestId(sel.roleSidebarRow(id)).click({ force: true });
    // v3: role name is now an inline EntityTitle (click-to-edit heading).
    // The `role-editor-name-input` only appears after clicking the trigger.
    await page.getByTestId(`${sel.roleEditorName}-trigger`).click();
    await expect(page.getByTestId(sel.roleEditorName)).toHaveValue("Named");
  });

  test("renaming a role via update_role refreshes the sidebar label", async ({
    page,
  }) => {
    await gotoRoles(page);
    const id = await createRole(page, "Renameable");

    await invokeBridge(page, "update_role", { id, name: "Renamed!" });

    await expect(page.getByTestId(sel.roleSidebarRow(id))).toHaveAttribute(
      "aria-label",
      "Renamed!",
    );
  });
});
