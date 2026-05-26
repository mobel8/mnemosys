/**
 * Tiny formatting helpers used by the review UI.
 *
 * `formatInterval(days)` turns the FSRS scheduler output (a fractional day
 * count) into the short, scannable label that lives under each rating
 * button — small enough to fit, granular enough to communicate "10 min"
 * vs "10 j" vs "10 mois".
 */

/**
 * Render an interval (in days, possibly fractional) as a short label.
 *
 * - `0`         → `"<10 min"`        (relearning / immediate retry)
 * - `< 1 day`   → `"42 min"` or `"3 h"` (sub-day learning steps)
 * - `1`         → `"1 j"`
 * - `< 30`      → `"7 j"`
 * - `< 365`     → `"2.5 mois"`
 * - `>= 365`    → `"1.2 ans"`
 *
 * Negative or non-finite inputs collapse to `"—"` so the button stays
 * legible even if the backend returns garbage.
 */
export function formatInterval(days: number): string {
  if (!Number.isFinite(days) || days < 0) return "—";
  if (days === 0) return "<10 min";

  if (days < 1) {
    const totalMinutes = Math.max(1, Math.round(days * 24 * 60));
    if (totalMinutes < 60) return `${totalMinutes} min`;
    const hours = Math.round((days * 24 + Number.EPSILON) * 10) / 10;
    // Drop the decimal when it rounds to a whole hour for cleaner output.
    return Number.isInteger(hours) ? `${hours} h` : `${hours.toFixed(1)} h`;
  }

  if (days === 1) return "1 j";
  if (days < 30) return `${Math.round(days)} j`;
  if (days < 365) return `${(days / 30).toFixed(1)} mois`;
  return `${(days / 365).toFixed(1)} ans`;
}

/** Render a millisecond duration as `mm:ss`. Caps the minute count at 99. */
export function formatElapsed(ms: number): string {
  if (!Number.isFinite(ms) || ms < 0) return "00:00";
  const totalSeconds = Math.floor(ms / 1000);
  const minutes = Math.min(99, Math.floor(totalSeconds / 60));
  const seconds = totalSeconds % 60;
  return `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
}
