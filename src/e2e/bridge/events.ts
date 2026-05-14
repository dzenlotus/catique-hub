/**
 * Minimal in-memory event bus mirroring `@tauri-apps/api/event`.
 *
 * Tauri 2.x routes `listen()` through `plugin:event|listen` and unwinds
 * via `plugin:event|unlisten`. Listeners are referenced by the
 * `transformCallback` id stamped on `window.__TAURI_INTERNALS__`. We
 * re-implement that contract just enough for `EventsProvider` to mount
 * without errors during E2E runs.
 *
 * Tests rarely care about events being delivered — the mutation hooks
 * already invalidate queries on success, so the UI updates without the
 * event bus carrying a payload. This file exists so the subscription
 * call path doesn't throw on boot.
 */

type Listener = (payload: unknown) => void;

const listeners = new Map<string, Set<Listener>>();
const callbacks = new Map<number, Listener>();
let nextCallbackId = 1;

export function registerCallback(cb: Listener): number {
  const id = nextCallbackId;
  nextCallbackId += 1;
  callbacks.set(id, cb);
  return id;
}

export function unregisterCallback(id: number): void {
  callbacks.delete(id);
}

export function pluginEventListen(event: string, handlerId: number): number {
  const cb = callbacks.get(handlerId);
  if (!cb) return handlerId;
  let set = listeners.get(event);
  if (!set) {
    set = new Set();
    listeners.set(event, set);
  }
  set.add(cb);
  return handlerId;
}

export function pluginEventUnlisten(event: string, handlerId: number): void {
  const cb = callbacks.get(handlerId);
  if (!cb) return;
  listeners.get(event)?.delete(cb);
}

export function emitEvent(event: string, payload: unknown): void {
  listeners.get(event)?.forEach((cb) => {
    try {
      cb({ event, id: 0, payload });
    } catch {
      // swallow — handler errors shouldn't break the bridge
    }
  });
}

export function resetEvents(): void {
  listeners.clear();
  callbacks.clear();
  nextCallbackId = 1;
}
