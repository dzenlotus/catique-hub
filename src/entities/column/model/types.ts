/**
 * Column entity types.
 *
 * Canonical `Column` comes from `bindings/Column.ts` (ts-rs auto-gen).
 * Re-exported here so call-sites import via `@entities/column` rather
 * than reaching into `bindings/` — keeps the slice the single contact
 * point with the Rust contract.
 */

export type { Column } from "@bindings/Column";
