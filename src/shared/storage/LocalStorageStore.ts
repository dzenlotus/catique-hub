/**
 * `LocalStorageStore<T>` — `KeyValueStore` backed by `window.localStorage`.
 *
 * Production code anywhere in `src/` MUST go through this class (or the
 * `useLocalStorage` hook that wraps it). Direct `window.localStorage.*`
 * calls outside this file are forbidden — see the storage README and the
 * grep guard in CI.
 *
 * Robustness:
 *   - Every `localStorage` access is wrapped in try/catch. Private mode,
 *     restricted environments, quota errors and SSR-snapshot rendering
 *     all degrade to a sensible default (read returns `null`, write is a
 *     no-op) instead of throwing.
 *   - `subscribe` listens to the native `storage` event, which fires in
 *     other tabs of the same origin. Same-tab `set`/`remove` calls
 *     dispatch a synthetic listener notification because the browser
 *     doesn't fire `storage` for the writing tab.
 *
 * Snapshot identity:
 *   - `get()` caches its decoded value keyed by the raw string read from
 *     `localStorage`. Repeated reads with no underlying change return
 *     the same reference, so `useSyncExternalStore` does not loop on
 *     freshly-parsed JSON object identities.
 */

import { KeyValueStore, type StoreListener } from "./KeyValueStore";
import type { Codec } from "./codecs";

interface LocalStorageStoreOptions<T> {
  key: string;
  codec: Codec<T>;
}

/** True when `window.localStorage` is reachable AND usable. */
function hasLocalStorage(): boolean {
  try {
    return typeof window !== "undefined" && window.localStorage !== undefined;
  } catch {
    return false;
  }
}

function readRaw(key: string): string | null {
  if (!hasLocalStorage()) return null;
  try {
    return window.localStorage.getItem(key);
  } catch {
    return null;
  }
}

export class LocalStorageStore<T> extends KeyValueStore<T> {
  readonly key: string;
  private readonly codec: Codec<T>;
  private readonly listeners = new Set<StoreListener>();
  private storageHandler: ((event: StorageEvent) => void) | null = null;

  // Cache so `get()` returns a stable reference between calls when the
  // underlying raw string hasn't changed. The pair `(raw, value)` is
  // refreshed only when `raw` differs from the last observed value.
  // Initial sentinel `undefined` means "never read yet".
  private cachedRaw: string | null | undefined = undefined;
  private cachedValue: T | null = null;

  constructor({ key, codec }: LocalStorageStoreOptions<T>) {
    super();
    this.key = key;
    this.codec = codec;
  }

  override get(): T | null {
    const raw = readRaw(this.key);
    if (this.cachedRaw === raw) return this.cachedValue;
    this.cachedRaw = raw;
    this.cachedValue = raw === null ? null : this.codec.decode(raw);
    return this.cachedValue;
  }

  override set(value: T): void {
    const encoded = this.codec.encode(value);
    if (hasLocalStorage()) {
      try {
        window.localStorage.setItem(this.key, encoded);
      } catch {
        // Quota exceeded / private mode — best-effort write.
      }
    }
    this.cachedRaw = encoded;
    this.cachedValue = value;
    this.notify();
  }

  override remove(): void {
    if (hasLocalStorage()) {
      try {
        window.localStorage.removeItem(this.key);
      } catch {
        // Restricted environment — best-effort delete.
      }
    }
    this.cachedRaw = null;
    this.cachedValue = null;
    this.notify();
  }

  override subscribe(listener: StoreListener): () => void {
    this.listeners.add(listener);
    this.ensureStorageHandler();

    let active = true;
    return () => {
      if (!active) return;
      active = false;
      this.listeners.delete(listener);
      this.teardownStorageHandlerIfIdle();
    };
  }

  // -------------------------------------------------------------------------
  // Internals
  // -------------------------------------------------------------------------

  private notify(): void {
    for (const listener of this.listeners) listener();
  }

  /**
   * Lazily attach the cross-tab `storage`-event handler exactly once,
   * the first time someone subscribes. Avoids paying the listener cost
   * on stores nobody is observing.
   */
  private ensureStorageHandler(): void {
    if (this.storageHandler !== null) return;
    if (typeof window === "undefined") return;

    const handler = (event: StorageEvent): void => {
      // `event.key === null` happens on `localStorage.clear()` — treat
      // as "everything changed" and notify so consumers re-read.
      if (event.key !== null && event.key !== this.key) return;
      // Invalidate cache so the next `get()` re-reads from storage.
      this.cachedRaw = undefined;
      this.notify();
    };
    this.storageHandler = handler;
    window.addEventListener("storage", handler);
  }

  private teardownStorageHandlerIfIdle(): void {
    if (this.listeners.size > 0) return;
    if (this.storageHandler === null) return;
    if (typeof window === "undefined") return;
    window.removeEventListener("storage", this.storageHandler);
    this.storageHandler = null;
  }
}
