/**
 * Storybook mock for `@tauri-apps/api/core`.
 *
 * In Storybook (browser / Node preview) there is no Tauri runtime.
 * This stub makes `invoke` return a rejected Promise by default so the
 * component can display the error state. Individual stories can swap
 * the implementation via `setMockInvoke` before rendering.
 */

export type InvokeFn = (
  command: string,
  args?: Record<string, unknown>,
) => Promise<unknown>;

let _mockInvoke: InvokeFn = () =>
  Promise.reject(new Error("Tauri runtime недоступен в Storybook"));

/** Replace the mock implementation (call from a story decorator). */
export function setMockInvoke(fn: InvokeFn): void {
  _mockInvoke = fn;
}

/** Restore the default (rejecting) implementation. */
export function resetMockInvoke(): void {
  _mockInvoke = () =>
    Promise.reject(new Error("Tauri runtime недоступен в Storybook"));
}

export function invoke<T>(
  command: string,
  args?: Record<string, unknown>,
): Promise<T> {
  return _mockInvoke(command, args) as Promise<T>;
}
