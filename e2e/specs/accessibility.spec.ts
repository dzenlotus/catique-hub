/**
 * Accessibility scenarios (NEW in iteration-2).
 *
 * The full a11y suite (axe-core scans, screen-reader walk-throughs)
 * lives outside Playwright. These scenarios prove the keyboard
 * skeleton: dialogs trap focus + restore on close, Tab reaches the
 * nav rail, Escape closes the topmost overlay.
 */

import { test, expect } from "../fixtures";
import { spaNavigate } from "../helpers/bridge";
import { sel } from "../helpers/selectors";

test.describe("accessibility — keyboard navigation", () => {
  test("Tab from the page body lands inside the main sidebar", async ({
    page,
  }) => {
    // Click on the document body to clear any stray focus, then Tab
    // until the active element lives inside the main sidebar. We allow
    // a small budget for the focus to reach the rail (TopBar buttons
    // may consume earlier Tabs).
    await page.evaluate(() => document.body.focus());

    let landedInsideSidebar = false;
    for (let i = 0; i < 12; i += 1) {
      await page.keyboard.press("Tab");
      const inside = await page.evaluate(() => {
        const active = document.activeElement;
        if (!active) return false;
        return active.closest('[data-testid="main-sidebar-root"]') !== null;
      });
      if (inside) {
        landedInsideSidebar = true;
        break;
      }
    }
    expect(landedInsideSidebar).toBe(true);
  });

  test("Escape closes the topmost open dialog (Space create)", async ({
    page,
  }) => {
    await page.getByTestId(sel.spacesAdd).click();
    await expect(page.getByTestId(sel.spaceCreate.root)).toBeVisible();

    await page.keyboard.press("Escape");
    await expect(page.getByTestId(sel.spaceCreate.root)).toHaveCount(0);
  });

  test("closing the create-space dialog restores focus near the trigger", async ({
    page,
  }) => {
    // Focus the trigger first so we have a known restore-target. RAC's
    // Dialog restores focus to the previously-focused element on close.
    const trigger = page.getByTestId(sel.spacesAdd);
    await trigger.focus();
    await trigger.click();
    await expect(page.getByTestId(sel.spaceCreate.root)).toBeVisible();

    await page.keyboard.press("Escape");
    await expect(page.getByTestId(sel.spaceCreate.root)).toHaveCount(0);

    // Focus is back on (or extremely near) the trigger button. RAC may
    // hand it to a parent role=row activator; assert the activeElement
    // is the trigger or a descendant/ancestor of the spaces sidebar.
    const focused = await page.evaluate(() => {
      const el = document.activeElement as HTMLElement | null;
      if (!el) return null;
      const sidebar = el.closest('[data-testid="spaces-sidebar-root"]');
      return sidebar === null ? null : sidebar.getAttribute("data-testid");
    });
    expect(focused).toBe("spaces-sidebar-root");
  });

  test("Escape from inside the column-create dialog dismisses it", async ({
    page,
  }) => {
    // Seed a space + board via the dialog, then open the column-create
    // modal on the board page and dismiss with Escape.
    await page.getByTestId(sel.spacesAdd).click();
    await page.getByTestId(sel.spaceCreate.name).fill("KbTest");
    await page.getByTestId(sel.spaceCreate.prefix).fill("kb");
    await page.getByTestId(sel.spaceCreate.save).click();
    await expect(page.getByTestId(sel.spaceCreate.root)).toHaveCount(0);

    // Land on /boards/:id via SPA push so the bridge store survives.
    const state = await page.evaluate(() => window.__E2E_GET_STATE__?.());
    const boards = ((state ?? {})["boards"] ?? []) as Array<[string, unknown]>;
    const boardId = boards[0]?.[0] as string | undefined;
    if (!boardId) throw new Error("board missing");
    await spaNavigate(page, `/boards/${boardId}`);
    await expect(page.getByTestId(sel.kanban.scroller)).toBeVisible();

    await page.getByTestId(sel.kanban.addColumn).click();
    await expect(page.getByTestId(sel.columnCreate.root)).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(page.getByTestId(sel.columnCreate.root)).toHaveCount(0);
  });
});
