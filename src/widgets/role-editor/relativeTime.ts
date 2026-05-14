/**
 * relativeTime — render a `bigint` epoch-millis stamp as a short
 * relative phrase ("just now", "3 days ago"). Pure, zero deps.
 *
 * Scoped to `widgets/role-editor` because that's the only call-site
 * today; promote to `shared/lib` if a second widget needs it.
 */

/** Convert a ts-rs `bigint` epoch-ms into a coarse relative-time phrase. */
export function relativeTime(epochMs: bigint, now: number = Date.now()): string {
  const deltaMs = now - Number(epochMs);
  if (Number.isNaN(deltaMs)) return "unknown";
  if (deltaMs < 0) return "just now";

  const sec = Math.floor(deltaMs / 1000);
  if (sec < 60) return "just now";

  const min = Math.floor(sec / 60);
  if (min < 60) return `${min} minute${min === 1 ? "" : "s"} ago`;

  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr} hour${hr === 1 ? "" : "s"} ago`;

  const day = Math.floor(hr / 24);
  if (day < 30) return `${day} day${day === 1 ? "" : "s"} ago`;

  const month = Math.floor(day / 30);
  if (month < 12) return `${month} month${month === 1 ? "" : "s"} ago`;

  const year = Math.floor(month / 12);
  return `${year} year${year === 1 ? "" : "s"} ago`;
}

/** Absolute timestamp for `title=` hover hints. Locale-friendly. */
export function absoluteTime(epochMs: bigint): string {
  return new Date(Number(epochMs)).toLocaleString();
}
