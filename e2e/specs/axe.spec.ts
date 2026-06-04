/**
 * Automated accessibility scanning with @axe-core/playwright.
 *
 * Each test navigates to a key screen, runs axe against the rendered
 * DOM, and asserts that there are zero violations at the `critical` or
 * `serious` impact level. Minor/moderate issues are intentionally
 * excluded from the gate so the bar is meaningful without being
 * drowned in cosmetic findings that can be addressed incrementally.
 *
 * Impact filter rationale:
 *   critical  — makes content completely inaccessible (e.g. missing
 *               form labels on required inputs, keyboard traps).
 *   serious   — causes significant barriers (e.g. insufficient colour
 *               contrast on interactive elements, missing landmark
 *               regions).
 *   moderate/minor — tracked separately; not yet CI-gated.
 *
 * Navigation pattern:
 *   - The fixture already lands on "/" and resets the bridge.
 *   - Use sidebar clicks (same as other specs) to reach each page so
 *     the bridge store is never wiped by a full page reload.
 *   - The Settings page is reached via the sidebar "Settings" button.
 *
 * When a violation IS reported:
 *   The assertion message includes the `help` and `helpUrl` fields from
 *   axe, which link to the Deque rule docs. The list of failing nodes is
 *   also printed via the helper below so failures are actionable.
 */

import type { Page } from "@playwright/test";

import AxeBuilder from "@axe-core/playwright";
import { test, expect } from "../fixtures";
import { sel } from "../helpers/selectors";

// Derive the violation item type from the AxeBuilder API so we don't
// need a direct import of axe-core (it is not hoisted to node_modules
// in this pnpm workspace — it is a transitive dep of @axe-core/playwright).
type AxeViolations = Awaited<ReturnType<AxeBuilder["analyze"]>>["violations"];
type AxeViolation = AxeViolations[number];

// Impact levels that block the gate.
const BLOCKED_IMPACTS = new Set(["critical", "serious"]);

/**
 * Run axe on the current page state and return only violations whose
 * impact is in BLOCKED_IMPACTS.
 */
async function scanPage(page: Page): Promise<AxeViolations> {
  const results = await new AxeBuilder({ page }).analyze();
  return results.violations.filter(
    (v) => v.impact != null && BLOCKED_IMPACTS.has(v.impact),
  );
}

/**
 * Produce a compact, human-readable summary for the expect() message
 * so failures identify the exact rule and affected nodes without
 * requiring the developer to open a separate report.
 */
function summarise(violations: AxeViolations): string {
  if (violations.length === 0) return "no violations";
  return violations
    .map((v: AxeViolation) => {
      const nodes = v.nodes
        .slice(0, 3)
        .map((n) => n.target.join(" > "))
        .join(", ");
      return `[${v.impact}] ${v.id}: ${v.help} (${v.nodes.length} node(s): ${nodes})`;
    })
    .join("\n");
}

test.describe("axe — critical/serious violation scan", () => {
  test("boards home (/) has no critical/serious violations", async ({
    page,
  }) => {
    // The fixture already lands on "/". Wait for the spaces sidebar to
    // confirm the shell is fully painted before scanning.
    await expect(page.getByTestId(sel.spacesSidebar)).toBeVisible();

    const violations = await scanPage(page);
    expect(violations, summarise(violations)).toHaveLength(0);
  });

  test("prompts page has no critical/serious violations", async ({ page }) => {
    await page
      .getByTestId(sel.mainSidebar)
      .getByRole("button", { name: "Prompts" })
      .click();
    await expect(page.getByTestId(sel.promptsPage)).toBeVisible();

    const violations = await scanPage(page);
    expect(violations, summarise(violations)).toHaveLength(0);
  });

  test("settings page has no critical/serious violations", async ({ page }) => {
    await page
      .getByTestId(sel.mainSidebar)
      .getByRole("button", { name: "Settings" })
      .click();
    await expect(page.getByTestId(sel.settings.viewScroll)).toBeVisible();

    const violations = await scanPage(page);
    expect(violations, summarise(violations)).toHaveLength(0);
  });

  test("agents (roles) page has no critical/serious violations", async ({
    page,
  }) => {
    await page
      .getByTestId(sel.mainSidebar)
      .getByRole("button", { name: "Agents" })
      .click();
    await expect(page.getByTestId(sel.rolesPage)).toBeVisible();

    const violations = await scanPage(page);
    expect(violations, summarise(violations)).toHaveLength(0);
  });

  test("integrations (MCP servers) page has no critical/serious violations", async ({
    page,
  }) => {
    await page
      .getByTestId(sel.mainSidebar)
      .getByRole("button", { name: "Integrations" })
      .click();
    await expect(page.getByTestId(sel.mcpServersPage)).toBeVisible();

    const violations = await scanPage(page);
    expect(violations, summarise(violations)).toHaveLength(0);
  });
});
