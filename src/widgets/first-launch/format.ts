/**
 * Formatting helpers for the first-launch widgets.
 *
 * Local to this widget — they're not yet shared across the app and
 * extracting them to `@shared/lib` before there's a second consumer
 * would be premature. When a second widget needs them, lift verbatim.
 */

/**
 * Render a byte count using SI units (1024-based, binary). Falls back
 * to "—" for anything non-finite or negative; the import handlers
 * never return such values today, but the function is defensive
 * because the inputs come from `bigint` values that may have been
 * downcast.
 */
export function formatBytes(input: bigint | number): string {
  const bytes = typeof input === "bigint" ? Number(input) : input;
  if (!Number.isFinite(bytes) || bytes < 0) return "—";
  if (bytes < 1024) return `${bytes} B`;
  const units = ["KB", "MB", "GB", "TB"];
  let value = bytes / 1024;
  let i = 0;
  while (value >= 1024 && i < units.length - 1) {
    value /= 1024;
    i += 1;
  }
  // 1 decimal under 100, integer above — keeps the visual width stable.
  const formatted = value < 100 ? value.toFixed(1) : Math.round(value).toString();
  return `${formatted} ${units[i]}`;
}

/**
 * Render a file-modification timestamp (epoch ms) into a locale-aware
 * date+time string. Caller passes a `bigint` because that's what
 * ts-rs hands us; we downcast and rely on JS's `Date` constructor.
 *
 * Note: locale defaults to "ru-RU" because the wizard text is
 * Russian for E4.1. Once i18n lands, push the locale up via
 * `Intl.DateTimeFormat`.
 */
export function formatTimestamp(epochMs: bigint): string {
  const ms = Number(epochMs);
  if (!Number.isFinite(ms) || ms <= 0) return "—";
  const d = new Date(ms);
  return d.toLocaleString("ru-RU", {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

/**
 * Convert a `bigint` row count into a string. Tiny indirection but
 * call-sites read clearer (`formatCount(report.tasksCount)` vs
 * `String(Number(report.tasksCount))`) and we centralise the `null`
 * fallback shape.
 */
export function formatCount(n: bigint | null | undefined): string {
  if (n === null || n === undefined) return "—";
  return Number(n).toLocaleString("ru-RU");
}
