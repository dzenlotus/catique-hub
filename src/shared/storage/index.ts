/**
 * Public API of `@shared/storage`.
 *
 * The only entry point app code should use to read/write `localStorage`.
 * Direct `window.localStorage.*` calls outside `LocalStorageStore.ts`
 * are forbidden in production code (see CI grep guard).
 */

export { KeyValueStore } from "./KeyValueStore";
export type { StoreListener } from "./KeyValueStore";

export { LocalStorageStore } from "./LocalStorageStore";

export { stringCodec, booleanCodec, jsonCodec } from "./codecs";
export type { Codec } from "./codecs";

export { useLocalStorage } from "./useLocalStorage";
export type { SetStorageValue } from "./useLocalStorage";
