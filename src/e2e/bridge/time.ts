/**
 * Monotonic bigint clock for the mock bridge.
 *
 * Rust returns `createdAt`/`updatedAt` as `i64`, which ts-rs renders as
 * `bigint` on the TS side. The clock advances per call so timestamps
 * remain strictly increasing within a single test, which keeps any
 * "ordered by createdAt" UI behaviour deterministic.
 */

let clock = 0n;

export function nowBig(): bigint {
  clock += 1n;
  return clock;
}

export function resetClock(): void {
  clock = 0n;
}
