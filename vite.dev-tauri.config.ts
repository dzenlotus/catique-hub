/**
 * Vite config for the dev Tauri bundle (`Catique HUB Dev`, identifier
 * `com.dzenlotus.catique-hub.dev`).
 *
 * Loaded via `pnpm vite --config vite.dev-tauri.config.ts`, which is
 * what `src-tauri/tauri.dev.conf.json` puts in `beforeDevCommand`.
 * Inherits everything from `vite.config.ts` and only overrides the
 * server ports so the dev bundle can run alongside a regular
 * `pnpm dev` / packaged release without colliding on 1420/1421.
 *
 * Anything dev-bundle-specific (proxies, plugins, defines) lives in
 * this file — the base `vite.config.ts` stays a single-purpose
 * production / standalone-dev config.
 */

import { defineConfig, mergeConfig, type UserConfig } from "vite";

import baseConfig from "./vite.config";

const DEV_TAURI_VITE_PORT = 1430;
const DEV_TAURI_HMR_PORT = 1431;

export default defineConfig(async (env) => {
  // `vite.config.ts` exports a config function — resolve it against
  // the current command/mode to get a plain UserConfig we can merge.
  const fn = await baseConfig;
  const resolved =
    typeof fn === "function"
      ? await (fn as (e: typeof env) => Promise<UserConfig> | UserConfig)(env)
      : (fn as UserConfig);

  return mergeConfig(resolved, {
    server: {
      port: DEV_TAURI_VITE_PORT,
      strictPort: true,
      hmr: {
        protocol: "ws",
        host: "localhost",
        port: DEV_TAURI_HMR_PORT,
      },
    },
  });
});
