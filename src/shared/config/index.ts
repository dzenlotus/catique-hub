/**
 * App-wide constants and env-derived config.
 *
 * E1 is a stub. Tauri bridges environment via `import.meta.env`
 * (Vite-managed) and via Rust commands at runtime — we'll wire those
 * properly in E2 when we know which Tauri commands the UI consumes.
 */

export const APP_NAME = "Catique HUB" as const;

export const IS_DEV = import.meta.env.DEV;
export const IS_PROD = import.meta.env.PROD;
