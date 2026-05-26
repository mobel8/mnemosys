/**
 * Date helpers used across the stats dashboard.
 *
 * Backend timestamps come either as unix milliseconds (`Card.last_review`,
 * `Note.created_at`) or as ISO date strings in `YYYY-MM-DD` form (the
 * `DayCount` / `DayRetention` rows returned by the stats commands). The
 * helpers below normalise both forms before delegating to the platform
 * `Intl` formatter, so charts get human-friendly French labels regardless of
 * the source representation.
 *
 * Keep this file dependency-free — it's imported by the stats components,
 * the unit tests under `tests/unit/`, and may end up imported by Wave C
 * polish tasks that want consistent date formatting.
 */

export type Period = "7d" | "30d" | "90d" | "365d";

const PERIOD_TO_DAYS: Record<Period, number> = {
  "7d": 7,
  "30d": 30,
  "90d": 90,
  "365d": 365,
};

/** Map a period token to the number of days it represents. */
export function periodToDays(period: Period): number {
  return PERIOD_TO_DAYS[period];
}

/**
 * Convert a value into a `Date`, accepting either a unix-ms number or an
 * ISO `YYYY-MM-DD` string. Strings are pinned to local midnight to avoid
 * the off-by-one timezone surprises that bite when parsing pure dates with
 * `new Date("YYYY-MM-DD")` (which is UTC).
 */
function toDate(ts: number | string): Date {
  if (typeof ts === "number") {
    return new Date(ts);
  }
  // `YYYY-MM-DD` → local midnight. Append the time so `Date` doesn't treat
  // the input as UTC.
  return new Date(`${ts}T00:00:00`);
}

/** Short label suited for chart X-axes (e.g. "24 mai"). */
export function formatDate(ts: number | string): string {
  return toDate(ts).toLocaleDateString("fr-FR", {
    day: "numeric",
    month: "short",
  });
}

/** Long label for tooltips (e.g. "lun. 26 mai 2025"). */
export function formatDateLong(ts: number | string): string {
  return toDate(ts).toLocaleDateString("fr-FR", {
    weekday: "short",
    day: "numeric",
    month: "long",
    year: "numeric",
  });
}

/** A `Date` representing `n` days before now (time-of-day preserved). */
export function daysAgo(n: number): Date {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return d;
}

/** Serialise a `Date` to `YYYY-MM-DD` (UTC slice — sufficient for keys). */
export function isoDate(d: Date): string {
  return d.toISOString().slice(0, 10);
}
