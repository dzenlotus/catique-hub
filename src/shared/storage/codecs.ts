/**
 * Codecs — typed encode/decode pairs for `KeyValueStore` values.
 *
 * Contract:
 *   - `encode(value)` produces a `string` ready for a string-medium store.
 *   - `decode(raw)` parses a previously encoded string. Returns `null` on
 *     unparseable / corrupt input — never throws. The store treats `null`
 *     as "no value", so a corrupt entry behaves like a missing one.
 *
 * Why this shape:
 *   - Symmetric (encode + decode in one object) so `LocalStorageStore`'s
 *     constructor takes a single `codec` dependency.
 *   - Returning `null` (not throwing) keeps `KeyValueStore.get()` safe to
 *     call from React render paths via `useSyncExternalStore`.
 */

export interface Codec<T> {
  encode(value: T): string;
  decode(raw: string): T | null;
}

// ---------------------------------------------------------------------------
// Primitive codecs
// ---------------------------------------------------------------------------

/** Identity codec for plain strings — round-trip is a no-op. */
export const stringCodec: Codec<string> = {
  encode(value) {
    return value;
  },
  decode(raw) {
    return raw;
  },
};

/**
 * Boolean codec — accepts the canonical `"true" | "false"` and treats any
 * other input as "no value" (decode returns `null`).
 */
export const booleanCodec: Codec<boolean> = {
  encode(value) {
    return value ? "true" : "false";
  },
  decode(raw) {
    if (raw === "true") return true;
    if (raw === "false") return false;
    return null;
  },
};

/**
 * `jsonCodec<T>()` — JSON encode/decode for arbitrary serialisable shapes.
 *
 * Caller picks `T`; the codec performs no runtime validation. For loose
 * inputs from external sources, layer a validator on top in the consumer.
 */
export function jsonCodec<T>(): Codec<T> {
  return {
    encode(value) {
      return JSON.stringify(value);
    },
    decode(raw) {
      try {
        return JSON.parse(raw) as T;
      } catch {
        return null;
      }
    },
  };
}
