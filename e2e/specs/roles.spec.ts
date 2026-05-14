import { test, expect } from "../fixtures";
import { readBridge } from "../helpers/bridge";
import { sel } from "../helpers/selectors";

async function gotoRoles(page: import("@playwright/test").Page): Promise<void> {
  await page
    .getByTestId(sel.mainSidebar)
    .getByRole("button", { name: "Roles" })
    .click();
  await expect(page.getByTestId(sel.rolesPage)).toBeVisible();
}

async function createRole(
  page: import("@playwright/test").Page,
  name: string,
): Promise<string> {
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
    const promptResult = (await page.evaluate(async () => {
      return await window.__TAURI_INTERNALS__.invoke("create_prompt", {
        name: "Skim PR",
        content: "Skim incoming changesets.",
      });
    })) as { id: string };

    await page.evaluate(
      async ({ roleId, promptId }) => {
        await window.__TAURI_INTERNALS__.invoke("set_role_prompts", {
          roleId,
          promptIds: [promptId],
        });
      },
      { roleId, promptId: promptResult.id },
    );

    const after = await readBridge(page);
    const attached = (after["rolePrompts"] as Array<[string, string[]]>).find(
      ([id]) => id === roleId,
    );
    expect(attached?.[1]).toEqual([promptResult.id]);
  });

  test("removing an attached prompt from a role clears the join row", async ({
    page,
  }) => {
    await gotoRoles(page);
    const roleId = await createRole(page, "Janitor");

    const promptResult = (await page.evaluate(async () => {
      return await window.__TAURI_INTERNALS__.invoke("create_prompt", {
        name: "Sweep",
        content: "Sweep stale tasks.",
      });
    })) as { id: string };

    await page.evaluate(
      async ({ roleId, promptId }) => {
        await window.__TAURI_INTERNALS__.invoke("add_role_prompt", {
          roleId,
          promptId,
          position: 0,
        });
        await window.__TAURI_INTERNALS__.invoke("remove_role_prompt", {
          roleId,
          promptId,
        });
      },
      { roleId, promptId: promptResult.id },
    );

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

    const skillResult = (await page.evaluate(async () => {
      return await window.__TAURI_INTERNALS__.invoke("create_skill", {
        name: "Search",
        position: 0,
      });
    })) as { id: string };

    await page.evaluate(
      async ({ roleId, skillId }) => {
        await window.__TAURI_INTERNALS__.invoke("add_role_skill", {
          roleId,
          skillId,
          position: 0,
        });
      },
      { roleId, skillId: skillResult.id },
    );

    const after = await readBridge(page);
    const attached = (after["roleSkills"] as Array<[string, string[]]>).find(
      ([id]) => id === roleId,
    );
    expect(attached?.[1]).toEqual([skillResult.id]);
  });
});
