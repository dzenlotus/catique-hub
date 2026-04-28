/**
 * Storybook mock for `@tauri-apps/api/event`.
 *
 * EventsProvider uses `listen` from this module. In Storybook there is no
 * Tauri runtime so we provide no-op implementations to prevent errors when
 * providers mount. `listen` returns a no-op unlisten function immediately.
 */

export type UnlistenFn = () => void;

export function listen<T>(
  _event: string,
  _handler: (event: { payload: T }) => void,
): Promise<UnlistenFn> {
  return Promise.resolve(() => undefined);
}

export function emit(_event: string, _payload?: unknown): Promise<void> {
  return Promise.resolve();
}
