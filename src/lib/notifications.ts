/**
 * Local reminders for time-based implementation intentions (Vague 21,
 * Gollwitzer 1999). Reminding the learner of their « si 19:00 alors je révise »
 * plan at the cued moment is the whole behavioural lever.
 *
 * Scheduling is delegated to the **OS** via `tauri-plugin-notification`'s
 * native `schedule` field rather than in-memory JS timers. This matters: a
 * `setTimeout` only survives while the webview process is alive, so a reminder
 * armed at app start would never fire once the user closed (or the OS
 * suspended) the app — i.e. exactly when the reminder is most useful. Native
 * scheduling hands the trigger to the platform notification daemon, which
 * delivers it whether or not Mnemosys is running.
 *
 *   - « every day » plans (no weekday filter) → one repeating daily interval.
 *   - weekday-restricted plans → one repeating weekly interval *per* allowed
 *     weekday (the plugin's `ScheduleInterval.weekday` targets a single day).
 *
 * Each scheduled OS notification carries a stable 32-bit integer id derived
 * from the plan id, so a re-sync cancels the previous batch before arming the
 * new one (idempotent, no duplicates).
 *
 * Hard rules:
 *   - Outside Tauri (jsdom, plain browser) every entry point is a silent
 *     no-op — `isTauri()` gates the whole module so tests never explode.
 *   - If the user denies notification permission, we stop trying (no spam,
 *     no thrown errors).
 */

import { isTauri } from "@tauri-apps/api/core";
import {
  cancel,
  isPermissionGranted,
  requestPermission,
  Schedule,
  sendNotification,
} from "@tauri-apps/plugin-notification";
import type { StudyPlan } from "@/lib/tauri";

/**
 * OS notification ids armed by the most recent `scheduleNotifications` call,
 * so the next call can cancel them before re-arming. Kept at module level
 * (not inside a closure) so successive calls always reconcile against the
 * *current* schedule rather than a stale snapshot.
 */
let scheduledIds: number[] = [];

/**
 * A plan can map to several OS notifications (one per allowed weekday). We
 * derive a unique 32-bit id per (plan, slot) pair: `planId * 8 + slot`, where
 * `slot` is 0 for a daily plan or the ISO weekday (1..7) for a weekly one.
 * Plan ids are small DB primary keys, so this never overflows a 32-bit int.
 */
function notificationId(planId: number, slot: number): number {
  return (planId * 8 + slot) & 0x7fffffff;
}

/**
 * Plugin `ScheduleInterval.weekday` is 1=Sunday … 7=Saturday, whereas our
 * `days` use ISO weekdays (1=Mon … 7=Sun). Convert between the two.
 */
function isoToPluginWeekday(iso: number): number {
  return (iso % 7) + 1;
}

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

/** Cancel every OS notification armed by a previous sync. Best-effort. */
async function cancelScheduled(): Promise<void> {
  if (scheduledIds.length === 0) return;
  const ids = scheduledIds;
  scheduledIds = [];
  try {
    await cancel(ids);
  } catch {
    // The plugin can reject if a notification was already delivered/cleared;
    // a failed cancel must never crash the app or block re-scheduling.
  }
}

/**
 * Arm the native OS notification(s) for a single enabled `time` plan and
 * return the ids armed (so the caller can track them for later cancellation).
 *
 *   - No weekday filter → one repeating *daily* interval at HH:MM.
 *   - One or more weekdays → one repeating *weekly* interval per weekday.
 *
 * The OS notification daemon owns the trigger, so it fires even when Mnemosys
 * is closed or suspended — unlike the old in-memory `setTimeout`.
 */
function armPlan(plan: StudyPlan): number[] {
  if (plan.trigger_type !== "time" || !plan.enabled) return [];
  const clock = parseClock(plan.trigger_value);
  if (!clock) return [];
  const allowedDays = parseDays(plan.days);

  const send = (id: number, schedule: Schedule): number | null => {
    try {
      sendNotification({
        id,
        title: "Mnemosys — c'est le moment",
        body: plan.action,
        schedule,
      });
      return id;
    } catch {
      // Sending can throw if the webview revoked permission mid-session;
      // swallow it — a missed reminder must never crash the app.
      return null;
    }
  };

  const armed: number[] = [];
  if (allowedDays.length === 0) {
    const id = send(
      notificationId(plan.id, 0),
      Schedule.interval({ hour: clock.hours, minute: clock.minutes, second: 0 }, true),
    );
    if (id !== null) armed.push(id);
  } else {
    for (const iso of allowedDays) {
      if (!Number.isInteger(iso) || iso < 1 || iso > 7) continue;
      const id = send(
        notificationId(plan.id, iso),
        Schedule.interval(
          {
            weekday: isoToPluginWeekday(iso),
            hour: clock.hours,
            minute: clock.minutes,
            second: 0,
          },
          true,
        ),
      );
      if (id !== null) armed.push(id);
    }
  }
  return armed;
}

/**
 * (Re)schedule OS notifications for the given plans. Cancels any previously
 * armed notifications first so calling this on every plan-list change is safe
 * and idempotent. No-op outside Tauri or when permission is unavailable/denied.
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

  // Reconcile against the *current* plan list: drop the previous batch, then
  // arm the new one. No JS timers survive between calls, so there is no stale
  // closure to leak a superseded plan set.
  await cancelScheduled();
  const armed: number[] = [];
  for (const plan of plans) {
    armed.push(...armPlan(plan));
  }
  scheduledIds = armed;
  return true;
}

/** Cancel every OS notification we armed. Safe to call anytime. */
export async function cancelAllNotifications(): Promise<void> {
  if (!isTauri()) return;
  await cancelScheduled();
}
