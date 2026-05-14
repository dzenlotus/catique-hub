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

/**
 * Invoke an arbitrary mock IPC command. Useful for tests that need to
 * exercise the same backend code path the UI would dispatch without
 * jumping through every dialog (creating fixture data fast).
 */
export async function invokeBridge<T = unknown>(
  page: Page,
  command: string,
  args: Record<string, unknown> = {},
): Promise<T> {
  return (await page.evaluate(
    async (payload) =>
      await window.__TAURI_INTERNALS__.invoke(payload.command, payload.args),
    { command, args },
  )) as T;
}

/**
 * SPA-friendly navigation. `page.goto()` causes a full reload, which
 * re-executes the bundle, which calls `installMockBridge()` again,
 * which constructs a fresh empty store — wiping any state seeded by a
 * preceding `invokeBridge`. We sidestep that by driving wouter via
 * `history.pushState` + a synthetic `popstate` event, which wouter
 * listens to (it doesn't depend on `page.goto`).
 *
 * Use this in any test that seeds bridge state via `invokeBridge` and
 * then needs to navigate to a deep-link route afterwards.
 */
export async function spaNavigate(page: Page, path: string): Promise<void> {
  await page.evaluate((p) => {
    window.history.pushState({}, "", p);
    window.dispatchEvent(new PopStateEvent("popstate"));
  }, path);
}

/**
 * Single space-create helper — exercises the dialog flow end-to-end so
 * tests don't redundantly type into name/prefix inputs. Returns the new
 * space id.
 */
export async function createSpaceViaDialog(
  page: Page,
  args: { name: string; prefix: string },
): Promise<string> {
  await page.getByTestId("spaces-sidebar-add-space").click();
  await page
    .getByTestId("space-create-dialog-name-input")
    .fill(args.name);
  await page
    .getByTestId("space-create-dialog-prefix-input")
    .fill(args.prefix);
  await page.getByTestId("space-create-dialog-save").click();
  await page
    .getByTestId("space-create-dialog")
    .waitFor({ state: "detached" })
    .catch(() => undefined);
  const state = await readBridge(page);
  const spaces = state["spaces"] as Array<[string, { name: string }]>;
  const row = spaces.find(([, s]) => s.name === args.name);
  if (!row) throw new Error(`space ${args.name} not in store`);
  return row[0];
}
