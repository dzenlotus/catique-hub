/**
 * Stable id generator for the mock bridge.
 *
 * Tests sometimes seed state via `__E2E_SEED__` and read it back via
 * `__E2E_GET_STATE__`; deterministic ids make those assertions trivial.
 * Counter resets on every `__E2E_RESET__()`.
 */

let counter = 0;

export function nextId(prefix: string): string {
  counter += 1;
  return `${prefix}-${counter}`;
}

export function resetIds(): void {
  counter = 0;
}
