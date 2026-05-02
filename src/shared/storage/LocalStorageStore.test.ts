import { describe, expect, it, beforeEach, vi } from "vitest";

import { LocalStorageStore } from "./LocalStorageStore";
import { booleanCodec, jsonCodec, stringCodec, type Codec } from "./codecs";

beforeEach(() => {
  window.localStorage.clear();
});

describe("LocalStorageStore — get/set/remove", () => {
  it("get returns null for a missing key", () => {
    const store = new LocalStorageStore({ key: "test:missing", codec: stringCodec });
    expect(store.get()).toBeNull();
  });

  it("set then get round-trips a string", () => {
    const store = new LocalStorageStore({ key: "test:str", codec: stringCodec });
    store.set("hello");
    expect(store.get()).toBe("hello");
    expect(window.localStorage.getItem("test:str")).toBe("hello");
  });

  it("set then get round-trips a boolean", () => {
    const store = new LocalStorageStore({ key: "test:bool", codec: booleanCodec });
    store.set(true);
    expect(store.get()).toBe(true);
    store.set(false);
    expect(store.get()).toBe(false);
  });

  it("set then get round-trips a JSON object", () => {
    interface Shape {
      n: number;
      s: string;
    }
    const store = new LocalStorageStore<Shape>({
      key: "test:json",
      codec: jsonCodec<Shape>(),
    });
    store.set({ n: 42, s: "x" });
    expect(store.get()).toEqual({ n: 42, s: "x" });
  });

  it("remove deletes the value and subsequent get returns null", () => {
    const store = new LocalStorageStore({ key: "test:rm", codec: stringCodec });
    store.set("v");
    expect(store.get()).toBe("v");
    store.remove();
    expect(store.get()).toBeNull();
    expect(window.localStorage.getItem("test:rm")).toBeNull();
  });

  it("decode failure returns null instead of throwing", () => {
    // Plant a corrupted JSON entry directly, then read through the store.
    window.localStorage.setItem("test:corrupt", "{not-json");
    const store = new LocalStorageStore({
      key: "test:corrupt",
      codec: jsonCodec<unknown>(),
    });
    expect(() => store.get()).not.toThrow();
    expect(store.get()).toBeNull();
  });

  it("get is resilient when localStorage.getItem throws", () => {
    const store = new LocalStorageStore({ key: "test:throws", codec: stringCodec });
    const spy = vi
      .spyOn(Storage.prototype, "getItem")
      .mockImplementation(() => {
        throw new Error("Access denied");
      });
    try {
      expect(store.get()).toBeNull();
    } finally {
      spy.mockRestore();
    }
  });

  it("set is resilient when localStorage.setItem throws (still notifies)", () => {
    const store = new LocalStorageStore({ key: "test:setthrows", codec: stringCodec });
    const listener = vi.fn();
    const unsubscribe = store.subscribe(listener);
    const spy = vi
      .spyOn(Storage.prototype, "setItem")
      .mockImplementation(() => {
        throw new Error("Quota exceeded");
      });
    try {
      expect(() => store.set("x")).not.toThrow();
      expect(listener).toHaveBeenCalledTimes(1);
    } finally {
      spy.mockRestore();
      unsubscribe();
    }
  });

  it("get returns a stable reference across calls when storage is unchanged", () => {
    interface Shape {
      n: number;
    }
    const codec: Codec<Shape> = jsonCodec<Shape>();
    const store = new LocalStorageStore<Shape>({ key: "test:stable", codec });
    store.set({ n: 1 });
    const a = store.get();
    const b = store.get();
    expect(a).toBe(b);
  });
});

describe("LocalStorageStore — subscribe", () => {
  it("fires the listener after set()", () => {
    const store = new LocalStorageStore({ key: "test:sub", codec: stringCodec });
    const listener = vi.fn();
    const unsubscribe = store.subscribe(listener);
    store.set("a");
    expect(listener).toHaveBeenCalledTimes(1);
    store.set("b");
    expect(listener).toHaveBeenCalledTimes(2);
    unsubscribe();
  });

  it("fires the listener after remove()", () => {
    const store = new LocalStorageStore({ key: "test:subrm", codec: stringCodec });
    const listener = vi.fn();
    const unsubscribe = store.subscribe(listener);
    store.remove();
    expect(listener).toHaveBeenCalledTimes(1);
    unsubscribe();
  });

  it("returned unsubscribe detaches the listener", () => {
    const store = new LocalStorageStore({ key: "test:detach", codec: stringCodec });
    const listener = vi.fn();
    const unsubscribe = store.subscribe(listener);
    unsubscribe();
    store.set("x");
    expect(listener).not.toHaveBeenCalled();
  });

  it("calling unsubscribe twice is safe", () => {
    const store = new LocalStorageStore({ key: "test:detach2", codec: stringCodec });
    const unsubscribe = store.subscribe(() => undefined);
    unsubscribe();
    expect(() => unsubscribe()).not.toThrow();
  });

  it("fires on a synthetic cross-tab `storage` event for the matching key", () => {
    const store = new LocalStorageStore({ key: "test:storage-evt", codec: stringCodec });
    const listener = vi.fn();
    const unsubscribe = store.subscribe(listener);

    const event = new StorageEvent("storage", {
      key: "test:storage-evt",
      newValue: "remote",
      oldValue: null,
      storageArea: window.localStorage,
    });
    window.dispatchEvent(event);

    expect(listener).toHaveBeenCalledTimes(1);
    unsubscribe();
  });

  it("ignores `storage` events for a different key", () => {
    const store = new LocalStorageStore({ key: "test:keyA", codec: stringCodec });
    const listener = vi.fn();
    const unsubscribe = store.subscribe(listener);

    const event = new StorageEvent("storage", {
      key: "test:keyB",
      newValue: "x",
      oldValue: null,
      storageArea: window.localStorage,
    });
    window.dispatchEvent(event);

    expect(listener).not.toHaveBeenCalled();
    unsubscribe();
  });

  it("fires when the `storage` event has a null key (clear() across tabs)", () => {
    const store = new LocalStorageStore({ key: "test:cleared", codec: stringCodec });
    const listener = vi.fn();
    const unsubscribe = store.subscribe(listener);

    const event = new StorageEvent("storage", {
      key: null,
      newValue: null,
      oldValue: null,
      storageArea: window.localStorage,
    });
    window.dispatchEvent(event);

    expect(listener).toHaveBeenCalledTimes(1);
    unsubscribe();
  });

  it("re-reads from storage after a `storage` event invalidates the cache", () => {
    const store = new LocalStorageStore({ key: "test:invalidate", codec: stringCodec });
    store.set("first");
    const listener = vi.fn();
    const unsubscribe = store.subscribe(listener);
    expect(store.get()).toBe("first");

    // Simulate another tab writing a new value.
    window.localStorage.setItem("test:invalidate", "second");
    window.dispatchEvent(
      new StorageEvent("storage", {
        key: "test:invalidate",
        newValue: "second",
        oldValue: "first",
        storageArea: window.localStorage,
      }),
    );

    expect(store.get()).toBe("second");
    unsubscribe();
  });
});
