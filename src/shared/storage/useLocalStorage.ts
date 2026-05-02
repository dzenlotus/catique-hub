/**
 * `useLocalStorage<T>` — React hook that exposes a `LocalStorageStore`
 * via React 19's `useSyncExternalStore`.
 *
 * Why `useSyncExternalStore`:
 *   - SSR-safe: the `getServerSnapshot` arg returns `null` so server
 *     renders never touch `window.localStorage`. The hook then falls
 *     back to `defaultValue`.
 *   - Re-renders the component when another tab writes the same key
 *     (the store relays the native `storage` event).
 *
 * Behaviour:
 *   - With `defaultValue`: returns `[T, setValue, remove]`.
 *   - Without `defaultValue`: returns `[T | null, setValue, remove]`.
 *   - `setValue` accepts a value or an updater function (like `useState`).
 *   - The store instance is memoised per `(key, codec)`. Changing the
 *     `key` re-creates the store and re-subscribes — old listener is
 *     released, no leak.
 */

import {
  useCallback,
  useMemo,
  useSyncExternalStore,
} from "react";

import { LocalStorageStore } from "./LocalStorageStore";
import type { Codec } from "./codecs";

export type SetStorageValue<T> = (next: T | ((prev: T) => T)) => void;

export function useLocalStorage<T>(
  key: string,
  codec: Codec<T>,
  defaultValue: T,
): [T, SetStorageValue<T>, () => void];
export function useLocalStorage<T>(
  key: string,
  codec: Codec<T>,
): [T | null, SetStorageValue<T>, () => void];
export function useLocalStorage<T>(
  key: string,
  codec: Codec<T>,
  defaultValue?: T,
): [T | null, SetStorageValue<T>, () => void] {
  const store = useMemo(
    () => new LocalStorageStore<T>({ key, codec }),
    [key, codec],
  );

  const subscribe = useCallback(
    (listener: () => void): (() => void) => store.subscribe(listener),
    [store],
  );

  const getSnapshot = useCallback((): T | null => store.get(), [store]);
  const getServerSnapshot = useCallback((): T | null => null, []);

  const stored = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
  const value: T | null =
    stored !== null ? stored : defaultValue !== undefined ? defaultValue : null;

  const setValue: SetStorageValue<T> = useCallback(
    (next) => {
      if (typeof next === "function") {
        const updater = next as (prev: T) => T;
        const prev: T = (store.get() ?? defaultValue) as T;
        store.set(updater(prev));
        return;
      }
      store.set(next);
    },
    [store, defaultValue],
  );

  const remove = useCallback((): void => {
    store.remove();
  }, [store]);

  return [value, setValue, remove];
}
