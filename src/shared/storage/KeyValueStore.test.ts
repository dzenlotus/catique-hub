import { describe, expect, it, vi } from "vitest";

import { KeyValueStore, type StoreListener } from "./KeyValueStore";

/**
 * LSP smoke test — a tiny in-memory subclass must satisfy the same
 * interface as `LocalStorageStore` and be substitutable everywhere
 * `KeyValueStore<T>` is accepted. This guards the abstraction itself
 * from leaking provider-specific assumptions back into the base class.
 */
class MemoryStore<T> extends KeyValueStore<T> {
  private value: T | null = null;
  private readonly listeners = new Set<StoreListener>();

  override get(): T | null {
    return this.value;
  }

  override set(value: T): void {
    this.value = value;
    for (const l of this.listeners) l();
  }

  override remove(): void {
    this.value = null;
    for (const l of this.listeners) l();
  }

  override subscribe(listener: StoreListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }
}

describe("KeyValueStore — Liskov-substitutability via MemoryStore", () => {
  it("missing-key get returns null", () => {
    const store: KeyValueStore<string> = new MemoryStore<string>();
    expect(store.get()).toBeNull();
  });

  it("set then get round-trips", () => {
    const store: KeyValueStore<{ n: number }> = new MemoryStore();
    store.set({ n: 7 });
    expect(store.get()).toEqual({ n: 7 });
  });

  it("remove resets to null", () => {
    const store: KeyValueStore<string> = new MemoryStore();
    store.set("v");
    store.remove();
    expect(store.get()).toBeNull();
  });

  it("subscribe fires on set / remove and unsubscribe detaches", () => {
    const store: KeyValueStore<string> = new MemoryStore();
    const listener = vi.fn();
    const unsubscribe = store.subscribe(listener);
    store.set("a");
    store.remove();
    expect(listener).toHaveBeenCalledTimes(2);
    unsubscribe();
    store.set("b");
    expect(listener).toHaveBeenCalledTimes(2);
  });
});
