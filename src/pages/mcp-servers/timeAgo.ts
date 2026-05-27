/**
 * Tiny "N min/h/d ago" formatter scoped to this widget.
 *
 * Pulled into its own module so the rendering components stay
 * presentational. Accepts the bigint `lastSyncedAt` produced by
 * `McpServerStatus` (ts-rs maps Rust i64 → bigint) plus a `now`
 * milliseconds value the caller injects (`Date.now()` by default —
 * the parameter makes unit-testing the boundaries trivial).
 */

const ONE_MINUTE_MS = 60_000;
const ONE_HOUR_MS = 60 * ONE_MINUTE_MS;
const ONE_DAY_MS = 24 * ONE_HOUR_MS;

/**
 * Returns a compact relative-time string like `synced 4 min ago`.
 * Returns `null` when `lastSyncedAt` is `null`/`undefined` so the
 * caller can decide whether to render anything at all.
 */
export function formatSyncedAgo(
  lastSyncedAt: bigint | null,
  now: number = Date.now(),
): string | null {
  if (lastSyncedAt === null || lastSyncedAt === undefined) return null;
  const tsMs = Number(lastSyncedAt);
  if (!Number.isFinite(tsMs) || tsMs <= 0) return null;
  const diff = Math.max(0, now - tsMs);
  if (diff < ONE_MINUTE_MS) return "synced just now";
  if (diff < ONE_HOUR_MS) {
    const min = Math.floor(diff / ONE_MINUTE_MS);
    return `synced ${min} min ago`;
  }
  if (diff < ONE_DAY_MS) {
    const h = Math.floor(diff / ONE_HOUR_MS);
    return `synced ${h} h ago`;
  }
  const d = Math.floor(diff / ONE_DAY_MS);
  return `synced ${d} d ago`;
}
