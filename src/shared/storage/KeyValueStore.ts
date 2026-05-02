/**
 * `KeyValueStore<T>` — provider-agnostic typed value storage.
 *
 * Abstract base for any synchronous, single-key value store. Subclasses
 * pick the backing medium (e.g. `localStorage`, in-memory map, IndexedDB
 * with a sync facade). The contract is intentionally narrow so call-sites
 * remain decoupled from the medium (Dependency Inversion).
 *
 * Design notes:
 * - Synchronous get/set/remove mirror `localStorage` semantics. Async
 *   providers (IDB) would need a separate base class — we don't pretend
 *   they share an interface.
 * - `subscribe(listener)` returns an `unsubscribe` function. Listeners
 *   fire after a value has changed (set, remove, or external event).
 * - `null` means "no value". Codecs must surface decode failures by
 *   returning `null`, not by throwing — keeps the store's reads
 *   side-effect-free for the caller.
 */

export type StoreListener = () => void;

export abstract class KeyValueStore<T> {
  /** Read the current value, or `null` if missing/undecodable. */
  abstract get(): T | null;

  /** Write a value. */
  abstract set(value: T): void;

  /** Delete the value. Subsequent `get()` returns `null`. */
  abstract remove(): void;

  /**
   * Subscribe to value changes. Listener fires after the underlying
   * value has changed (local mutation or external event).
   *
   * Returns a no-arg `unsubscribe` function. Calling it twice is safe.
   */
  abstract subscribe(listener: StoreListener): () => void;
}
