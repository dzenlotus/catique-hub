/**
 * Mock Tauri IPC bridge.
 *
 * # Why this exists
 * Tauri's WebDriver harness (`tauri-driver`) is Linux/Windows-only;
 * end-to-end testing on macOS therefore needs an in-process substitute.
 * This bridge installs `window.__TAURI_INTERNALS__` with an `invoke()`
 * implementation that dispatches to in-memory state instead of the
 * Rust backend, so `vite preview` can host the same React build as
 * Tauri and Playwright can drive it through Chromium.
 *
 * # When is it loaded?
 * Only when `import.meta.env.VITE_E2E === "1"`. Dev / Tauri production
 * builds never include this module at runtime — the dynamic import in
 * `src/app/index.tsx` is gated behind the same flag, so the tree-shaker
 * drops every reference from regular builds.
 *
 * # Architectural compromise
 * - No real Rust handlers are invoked. Every IPC call resolves against
 *   the maps in `store.ts`.
 * - Most validation is omitted; the bridge is permissive so tests can
 *   construct any state via `__E2E_SEED__()` without bumping into FK
 *   checks that the real backend would enforce.
 * - Events are mounted but never emitted by the bridge itself. The
 *   frontend's React-Query mutation hooks invalidate caches on success
 *   without needing event payloads, which is what keeps test scenarios
 *   green.
 *
 * # Extending the bridge with a new command
 * 1. Locate the Rust handler in `crates/api/src/handlers/<domain>.rs`.
 * 2. Add a `case "<snake_case_command>": ...` to the matching file in
 *    `handlers/<domain>.ts`.
 * 3. Return a shape that mirrors the ts-rs binding for that command
 *    (camelCase keys, `bigint` for `i64`).
 * 4. If the command threads state, mutate `store` from `store.ts` —
 *    never invent ad-hoc storage.
 *
 * # Public window hooks for Playwright
 * - `window.__E2E_RESET__()`           wipes state.
 * - `window.__E2E_SEED__(snapshot)`    seeds state (per-Map entries).
 * - `window.__E2E_GET_STATE__()`       returns a snapshot for assertions.
 */

import { handleBoards } from "./handlers/boards";
import { handleColumns } from "./handlers/columns";
import { handleMcpServers } from "./handlers/mcpServers";
import { handleMcpTools } from "./handlers/mcpTools";
import { handleMisc } from "./handlers/misc";
import { handlePromptGroups } from "./handlers/promptGroups";
import { handlePrompts } from "./handlers/prompts";
import { handleRoles } from "./handlers/roles";
import { handleSkills } from "./handlers/skills";
import { handleSpaces } from "./handlers/spaces";
import { handleTags } from "./handlers/tags";
import {
  pluginEventListen,
  pluginEventUnlisten,
  registerCallback,
  unregisterCallback,
} from "./events";
import { resetStore, snapshot, store } from "./store";

declare global {
  interface Window {
    __TAURI_INTERNALS__: {
      invoke: (
        cmd: string,
        args?: Record<string, unknown>,
      ) => Promise<unknown>;
      transformCallback: (cb: (arg: unknown) => void, once?: boolean) => number;
      unregisterCallback: (id: number) => void;
      convertFileSrc?: (path: string, protocol?: string) => string;
    };
    __E2E_RESET__?: () => void;
    __E2E_SEED__?: (snapshot: Record<string, unknown>) => void;
    __E2E_GET_STATE__?: () => Record<string, unknown>;
  }
}

const DISPATCHERS = [
  handleSpaces,
  handleBoards,
  handleColumns,
  handlePrompts,
  handlePromptGroups,
  handleRoles,
  handleSkills,
  handleMcpServers,
  handleMcpTools,
  handleTags,
  handleMisc,
];

async function mockInvoke(
  cmd: string,
  args: Record<string, unknown> = {},
): Promise<unknown> {
  // Plug `plugin:event|*` directly to the event bus.
  if (cmd === "plugin:event|listen") {
    const event = String(args["event"]);
    const handlerId = Number(args["handler"]);
    return pluginEventListen(event, handlerId);
  }
  if (cmd === "plugin:event|unlisten") {
    const event = String(args["event"]);
    const handlerId = Number(args["eventId"]);
    pluginEventUnlisten(event, handlerId);
    return null;
  }
  if (cmd === "plugin:event|emit") {
    return null;
  }

  for (const dispatch of DISPATCHERS) {
    const result = dispatch(cmd, args);
    if (result !== undefined) return result;
  }

  // Unknown command — log + return null so React-Query treats it as
  // "loaded with empty result" instead of crashing the UI.
  // eslint-disable-next-line no-console
  console.warn(`[e2e-bridge] unhandled command: ${cmd}`, args);
  return null;
}

/**
 * Mount the bridge synchronously. Called from `src/app/index.tsx` before
 * `createRoot()` when the E2E flag is set. After this returns,
 * `window.__TAURI_INTERNALS__` is populated so the first `invoke()` from
 * any React tree resolves against the mock store.
 */
export function installMockBridge(): void {
  window.__TAURI_INTERNALS__ = {
    invoke: mockInvoke,
    transformCallback: (cb, _once) => {
      // Tauri's real implementation stores the cb against a numeric id
      // and returns the id. Our bus uses the same convention.
      return registerCallback(cb as (arg: unknown) => void);
    },
    unregisterCallback: (id) => {
      unregisterCallback(id);
    },
    convertFileSrc: (path: string) => path,
  };

  window.__E2E_RESET__ = (): void => {
    // Reset state only — listeners stay registered because the test
    // fixture's reset call runs AFTER the React tree (and its
    // EventsProvider listen() registrations) has mounted. Wiping
    // listeners here would orphan every subscription for the rest of
    // the test. Specs that need a fresh listener set should drive a
    // full page reload via `page.goto("/")`.
    resetStore();
  };

  window.__E2E_SEED__ = (seed: Record<string, unknown>): void => {
    for (const [key, value] of Object.entries(seed)) {
      const target = (store as unknown as Record<string, Map<unknown, unknown>>)[
        key
      ];
      if (!target) continue;
      target.clear();
      if (Array.isArray(value)) {
        for (const entry of value as Array<[unknown, unknown]>) {
          target.set(entry[0], entry[1]);
        }
      }
    }
  };

  window.__E2E_GET_STATE__ = (): Record<string, unknown> => snapshot();
}
