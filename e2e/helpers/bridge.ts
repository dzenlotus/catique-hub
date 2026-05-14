/**
 * Typed wrappers around the bridge's `window.__E2E_*` hooks.
 *
 * Specs import these instead of sprinkling `page.evaluate` calls all
 * over the place. Keeps the contract one-source-of-truth and lets
 * `tsc --noEmit` catch shape drift between the bridge and the tests.
 */

import type { Page } from "@playwright/test";

export interface MockStateSnapshot {
  [domain: string]: Array<[string, unknown]>;
}

/** Wipe every in-memory map; called from `beforeEach`. */
export async function resetBridge(page: Page): Promise<void> {
  await page.evaluate(() => {
    window.__E2E_RESET__?.();
  });
}

/**
 * Seed the in-memory store with a partial snapshot. The snapshot keys
 * must match the `MockStore` field names declared in
 * `src/e2e/bridge/store.ts`.
 */
export async function seedBridge(
  page: Page,
  seed: MockStateSnapshot,
): Promise<void> {
  await page.evaluate((s) => {
    window.__E2E_SEED__?.(s);
  }, seed);
}

/** Read every map's entries — useful for verifying mutations. */
export async function readBridge(page: Page): Promise<MockStateSnapshot> {
  return (await page.evaluate(
    () => window.__E2E_GET_STATE__?.() ?? {},
  )) as MockStateSnapshot;
}

/** Block until the bridge globals are available. */
export async function waitForBridge(page: Page): Promise<void> {
  await page.waitForFunction(
    () =>
      typeof window.__E2E_RESET__ === "function" &&
      typeof window.__E2E_SEED__ === "function",
  );
}

/**
 * Click a testid inside an EntityTree row.
 *
 * The `<li>` activator carries `aria-disabled="true"` from dnd-kit's
 * sortable wiring (the activator is the drag handle, not the row
 * target). Playwright reports the descendant button as disabled, so
 * `force: true` bypasses the actionability check. The click still goes
 * to the real interactive button, the row's `onClick` still fires.
 */
export async function clickTestId(page: Page, testId: string): Promise<void> {
  await page.getByTestId(testId).click({ force: true });
}
