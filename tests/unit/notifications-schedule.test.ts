/**
 * Tests for the time math behind study-plan reminders (Vague 21).
 *
 * `scheduleNotifications` itself is a no-op outside Tauri (gated by
 * `isTauri()`), so the unit-testable surface is the pure
 * `msUntilNextOccurrence` helper: given a clock time + allowed weekdays, it
 * returns the ms until the next matching moment, always strictly in the
 * future.
 */

import { describe, expect, it } from "vitest";
import { msUntilNextOccurrence } from "@/lib/notifications";

const MINUTE = 60 * 1000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

describe("msUntilNextOccurrence", () => {
  it("returns the delay until later today when the time is still ahead", () => {
    // Wed 2026-05-27 10:00 local → next 14:30 is 4h30 away.
    const now = new Date(2026, 4, 27, 10, 0, 0, 0);
    expect(msUntilNextOccurrence(14, 30, [], now)).toBe(4 * HOUR + 30 * MINUTE);
  });

  it("rolls over to tomorrow when the time has already passed today", () => {
    // 10:00 now, 09:00 target → tomorrow 09:00 is 23h away.
    const now = new Date(2026, 4, 27, 10, 0, 0, 0);
    expect(msUntilNextOccurrence(9, 0, [], now)).toBe(23 * HOUR);
  });

  it("skips to the next allowed weekday", () => {
    // Wed (ISO 3) 10:00; plan only fires Mondays (ISO 1) at 08:00.
    // Next Monday is 5 days out → 5*24h - 2h = 118h.
    const now = new Date(2026, 4, 27, 10, 0, 0, 0); // a Wednesday
    expect(now.getDay()).toBe(3); // sanity: JS Wed
    expect(msUntilNextOccurrence(8, 0, [1], now)).toBe(5 * DAY - 2 * HOUR);
  });

  it("always returns a strictly positive delay", () => {
    const now = new Date(2026, 4, 27, 14, 30, 0, 0);
    // Same clock time as 'now' must roll to tomorrow, never 0.
    expect(msUntilNextOccurrence(14, 30, [], now)).toBe(DAY);
  });
});
