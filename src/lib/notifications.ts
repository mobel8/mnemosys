/**
 * Best-effort local reminders for time-based implementation intentions
 * (Vague 21, Gollwitzer 1999). Reminding the learner of their « si 19:00
 * alors je révise » plan at the cued moment is the whole behavioural lever.
 *
 * Scheduling is intentionally *simple* (the spec calls for it): for every
 * enabled `time` plan we compute the delay until its next occurrence today
 * (or tomorrow if already past) and arm a `setTimeout`. When it fires we send
 * the notification and re-arm for the next day. A once-a-day master tick also
 * re-syncs everything so drift / day-rollover never strands a plan.
 *
 * Hard rules:
 *   - Outside Tauri (jsdom, plain browser) every entry point is a silent
 *     no-op — `isTauri()` gates the whole module so tests never explode.
 *   - If the user denies notification permission, we stop trying (no spam,
 *     no thrown errors).
 *   - `setTimeout` is capped at ~24 days (2^31 ms); our delays are always
 *     < 48 h so we never overflow.
 */

import { isTauri } from "@tauri-apps/api/core";
import {
  isPermissionGranted,
  requestPermission,
  sendNotification,
} from "@tauri-apps/plugin-notification";
import type { StudyPlan } from "@/lib/tauri";

/** Active timers, keyed by plan id, so a re-sync can cancel stale ones. */
const timers = new Map<number, ReturnType<typeof setTimeout>>();

/** The daily master re-sync handle, if running. */
let dailyTick: ReturnType<typeof setInterval> | null = null;

/**
 * Parse `"HH:MM"` into `{ hours, minutes }`, or `null` when malformed. The
 * backend already validates this, but a defensive parse keeps the scheduler
 * from arming a `NaN` timeout if a row was written out-of-band.
 */
function parseClock(value: string): { hours: number; minutes: number } | null {
  const [h, m] = value.split(":");
  const hours = Number(h);
  const minutes = Number(m);
  if (!Number.isInteger(hours) || !Number.isInteger(minutes)) return null;
  if (hours < 0 || hours > 23 || minutes < 0 || minutes > 59) return null;
  return { hours, minutes };
}

/**
 * Parse the JSON `days` array; treat any malformed value as « every day »
 * (empty set) so a bad row still reminds rather than silently never firing.
 */
function parseDays(days: string): number[] {
  try {
    const parsed = JSON.parse(days);
    if (Array.isArray(parsed) && parsed.every((d) => Number.isInteger(d))) {
      return parsed as number[];
    }
  } catch {
    // fall through
  }
  return [];
}

/** ISO weekday (1 = Mon … 7 = Sun) for a JS `Date` (whose `getDay()` is 0=Sun). */
function isoWeekday(date: Date): number {
  const js = date.getDay();
  return js === 0 ? 7 : js;
}

/**
 * Milliseconds from `now` until the next occurrence of `hours:minutes` that
 * also falls on one of `allowedDays` (empty = any day). Always strictly in the
 * future. Scans at most 8 days ahead (covers the weekly cycle + today).
 */
export function msUntilNextOccurrence(
  hours: number,
  minutes: number,
  allowedDays: number[],
  now: Date = new Date(),
): number {
  for (let offset = 0; offset <= 8; offset++) {
    const candidate = new Date(now);
    candidate.setDate(now.getDate() + offset);
    candidate.setHours(hours, minutes, 0, 0);
    if (candidate.getTime() <= now.getTime()) continue;
    if (allowedDays.length > 0 && !allowedDays.includes(isoWeekday(candidate))) {
      continue;
    }
    return candidate.getTime() - now.getTime();
  }
  // Unreachable for a non-empty/any-day set, but keep the type total.
  return 24 * 60 * 60 * 1000;
}

/** Cancel every armed timer (used on re-sync and teardown). */
function clearAll(): void {
  for (const handle of timers.values()) {
    clearTimeout(handle);
  }
  timers.clear();
}

/** Arm a single `time` plan. Re-arms itself after firing for the next day. */
function armPlan(plan: StudyPlan): void {
  if (plan.trigger_type !== "time" || !plan.enabled) return;
  const clock = parseClock(plan.trigger_value);
  if (!clock) return;
  const allowedDays = parseDays(plan.days);

  const delay = msUntilNextOccurrence(clock.hours, clock.minutes, allowedDays);
  const handle = setTimeout(() => {
    try {
      sendNotification({
        title: "Mnemosys — c'est le moment",
        body: plan.action,
      });
    } catch {
      // Sending can throw if the webview revoked permission mid-session;
      // swallow it — a missed reminder must never crash the app.
    }
    // Re-arm for the next occurrence.
    armPlan(plan);
  }, delay);
  timers.set(plan.id, handle);
}

/**
 * (Re)schedule notifications for the given plans. Cancels any previously
 * armed timers first so calling this on every plan-list change is safe and
 * idempotent. No-op outside Tauri or when permission is unavailable/denied.
 *
 * Returns `true` when scheduling ran (Tauri + permission granted), `false`
 * when it short-circuited — handy for tests and callers that want to know.
 */
export async function scheduleNotifications(plans: StudyPlan[]): Promise<boolean> {
  if (!isTauri()) return false;

  let granted = false;
  try {
    granted = await isPermissionGranted();
    if (!granted) {
      const perm = await requestPermission();
      granted = perm === "granted";
    }
  } catch {
    return false; // plugin unavailable — silent no-op
  }
  if (!granted) return false;

  clearAll();
  for (const plan of plans) {
    armPlan(plan);
  }

  // Master daily re-sync: re-arm everything once a day so day-rollover and
  // long-session drift can't strand a plan. Guard against double-arming.
  if (dailyTick === null) {
    dailyTick = setInterval(
      () => {
        clearAll();
        for (const plan of plans) {
          armPlan(plan);
        }
      },
      24 * 60 * 60 * 1000,
    );
  }
  return true;
}

/** Tear everything down (timers + daily tick). Safe to call anytime. */
export function cancelAllNotifications(): void {
  clearAll();
  if (dailyTick !== null) {
    clearInterval(dailyTick);
    dailyTick = null;
  }
}
