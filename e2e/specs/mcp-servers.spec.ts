import { test, expect } from "../fixtures";
import { readBridge } from "../helpers/bridge";
import { sel } from "../helpers/selectors";

async function gotoMcp(page: import("@playwright/test").Page): Promise<void> {
  await page
    .getByTestId(sel.mainSidebar)
    .getByRole("button", { name: "MCP servers" })
    .click();
  await expect(page.getByTestId(sel.mcpServersPage)).toBeVisible();
}

test.describe("mcp servers", () => {
  test("creating an MCP server adds it as a group in the rail", async ({
    page,
  }) => {
    await gotoMcp(page);
    await page.getByTestId(sel.mcpAdd).click();
    await expect(page.getByTestId(sel.mcpServerCreate.root)).toBeVisible();
    await page.getByTestId(sel.mcpServerCreate.name).fill("Local tools");
    await page.getByTestId(sel.mcpServerCreate.command).fill("/bin/echo");
    await page.getByTestId(sel.mcpServerCreate.save).click();
    await expect(page.getByTestId(sel.mcpServerCreate.root)).toHaveCount(0);

    const state = await readBridge(page);
    const servers = state["mcpServers"] as Array<[string, { name: string }]>;
    expect(servers).toHaveLength(1);
    expect(servers[0][1].name).toBe("Local tools");
    await expect(
      page.getByTestId(sel.mcpServerSidebarRow(servers[0][0])),
    ).toBeVisible();
  });
});
