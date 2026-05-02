import { describe, expect, it } from "vitest";

import { booleanCodec, jsonCodec, stringCodec } from "./codecs";

describe("stringCodec", () => {
  it("round-trips arbitrary strings unchanged", () => {
    const samples = ["", "plain", "юникод", "with\nnewline", '"quotes"'];
    for (const v of samples) {
      expect(stringCodec.decode(stringCodec.encode(v))).toBe(v);
    }
  });

  it("decode treats any input as the value (no validation)", () => {
    // Identity codec — decode never returns null.
    expect(stringCodec.decode("anything")).toBe("anything");
  });
});

describe("booleanCodec", () => {
  it("round-trips true and false", () => {
    expect(booleanCodec.decode(booleanCodec.encode(true))).toBe(true);
    expect(booleanCodec.decode(booleanCodec.encode(false))).toBe(false);
  });

  it("encodes to canonical 'true' / 'false' strings", () => {
    expect(booleanCodec.encode(true)).toBe("true");
    expect(booleanCodec.encode(false)).toBe("false");
  });

  it("returns null for unparseable input (legacy / corrupt values)", () => {
    expect(booleanCodec.decode("")).toBeNull();
    expect(booleanCodec.decode("1")).toBeNull();
    expect(booleanCodec.decode("yes")).toBeNull();
    expect(booleanCodec.decode("TRUE")).toBeNull();
  });
});

describe("jsonCodec", () => {
  it("round-trips objects and arrays", () => {
    const codec = jsonCodec<{ a: number; b: string[] }>();
    const value = { a: 1, b: ["x", "y"] };
    expect(codec.decode(codec.encode(value))).toEqual(value);
  });

  it("round-trips primitives wrapped in JSON", () => {
    const numCodec = jsonCodec<number>();
    expect(numCodec.decode(numCodec.encode(42))).toBe(42);

    const boolCodec = jsonCodec<boolean>();
    expect(boolCodec.decode(boolCodec.encode(true))).toBe(true);
  });

  it("returns null on malformed JSON instead of throwing", () => {
    const codec = jsonCodec<unknown>();
    expect(codec.decode("{not-json")).toBeNull();
    expect(codec.decode("")).toBeNull();
    expect(codec.decode("undefined")).toBeNull();
  });
});
