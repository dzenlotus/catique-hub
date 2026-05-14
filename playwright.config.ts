import { defineConfig, devices } from "@playwright/test";

/**
 * Playwright config — drives `vite preview` against the mock IPC bridge.
 *
 * Real Tauri integration is intentionally NOT exercised here. The bridge
 * (`src/e2e/bridge/`) sits in front of `window.__TAURI_INTERNALS__` so
 * every `invoke()` resolves against an in-memory store. See
 * `src/e2e/bridge/index.ts` for the architectural rationale.
 *
 * - `workers: 1` while the iteration-1 suite settles. The mock bridge
 *   lives in window globals, so parallel workers across the same vite
 *   preview would step on each other's state.
 * - `webServer.command` runs the e2e:preview script which already exports
 *   `VITE_E2E=1` to surface the bridge install at boot.
 */
export default defineConfig({
  testDir: "./e2e/specs",
  outputDir: "./e2e/.artifacts",
  fullyParallel: false,
  forbidOnly: !!process.env["CI"],
  retries: 0,
  workers: 1,
  reporter: process.env["CI"] ? "github" : "list",
  timeout: 15_000,
  expect: { timeout: 5_000 },
  use: {
    baseURL: "http://localhost:4173",
    headless: true,
    actionTimeout: 5_000,
    navigationTimeout: 10_000,
    trace: "retain-on-failure",
  },
  webServer: {
    command: "pnpm run e2e:preview",
    port: 4173,
    reuseExistingServer: !process.env["CI"],
    stdout: "pipe",
    stderr: "pipe",
    timeout: 60_000,
  },
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] },
    },
  ],
});
