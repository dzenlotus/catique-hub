/**
 * `formatRelativeTime` — convert a unix-millis timestamp to a short
 * English relative-time string ("5 min ago", "2 d ago"). Buckets stop
 * at days; weeks/months/years are rendered as an absolute date so the
 * viewer doesn't have to mentally count.
 *
 * Input is the `bigint` `createdAt` field from `RoleContentVersionView`
 * / `PromptContentVersionView`, expressed as Unix milliseconds. Accepts
 * `number` for ergonomic call from tests.
 */

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

export function formatRelativeTime(
  createdAt: bigint | number,
  now: number = Date.now(),
): string {
  const tsMs =
    typeof createdAt === "bigint" ? Number(createdAt) : createdAt;
  const delta = now - tsMs;
  if (!Number.isFinite(delta) || delta < 0) {
    return "just now";
  }
  if (delta < MINUTE) return "just now";
  if (delta < HOUR) return `${Math.floor(delta / MINUTE)} min ago`;
  if (delta < DAY) return `${Math.floor(delta / HOUR)} h ago`;
  if (delta < 7 * DAY) return `${Math.floor(delta / DAY)} d ago`;
  // Absolute date for older entries (YYYY-MM-DD HH:mm). Locale-agnostic
  // so it reads the same on every machine.
  const d = new Date(tsMs);
  const pad = (v: number): string => v.toString().padStart(2, "0");
  return (
    `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}` +
    ` ${pad(d.getHours())}:${pad(d.getMinutes())}`
  );
}
