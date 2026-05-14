/**
 * Custom Playwright fixture that resets the mock bridge before every
 * test. Specs `import { test, expect } from "../fixtures"` to inherit
 * the bridge-aware page object without per-file boilerplate.
 */

import { test as base, expect } from "@playwright/test";

import { resetBridge, waitForBridge } from "./helpers/bridge";

export const test = base.extend({
  page: async ({ page }, use) => {
    await page.goto("/");
    await waitForBridge(page);
    await resetBridge(page);
    await use(page);
  },
});

export { expect };
