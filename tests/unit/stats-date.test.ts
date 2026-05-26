import { describe, expect, it } from "vitest";
import { daysAgo, formatDate, formatDateLong, isoDate, periodToDays } from "@/lib/date";

describe("periodToDays", () => {
  it("maps each period token to its day count", () => {
    expect(periodToDays("7d")).toBe(7);
    expect(periodToDays("30d")).toBe(30);
    expect(periodToDays("90d")).toBe(90);
    expect(periodToDays("365d")).toBe(365);
  });
});

describe("formatDate", () => {
  it("handles a YYYY-MM-DD string in local time", () => {
    // Using a numeric day (15) avoids any locale-induced ambiguity. The
    // helper is configured to render French short month names.
    const formatted = formatDate("2025-05-15");
    // French short month for May is "mai" (case insensitive).
    expect(formatted.toLowerCase()).toContain("15");
    expect(formatted.toLowerCase()).toContain("mai");
  });

  it("handles a unix-ms number", () => {
    const ms = new Date(2025, 4, 15).getTime(); // 15 May 2025 local time
    const formatted = formatDate(ms);
    expect(formatted.toLowerCase()).toContain("15");
    expect(formatted.toLowerCase()).toContain("mai");
  });

  it("formatDateLong includes the year", () => {
    const formatted = formatDateLong("2025-05-15");
    expect(formatted).toContain("2025");
  });
});

describe("isoDate", () => {
  it("returns YYYY-MM-DD format", () => {
    const d = new Date(Date.UTC(2025, 0, 5, 12, 0, 0));
    expect(isoDate(d)).toBe("2025-01-05");
  });

  it("always returns exactly 10 chars", () => {
    expect(isoDate(new Date()).length).toBe(10);
  });
});

describe("daysAgo", () => {
  it("returns a date roughly n days in the past", () => {
    const before = Date.now();
    const past = daysAgo(7);
    const after = Date.now();

    // The returned timestamp should land within the 7-days-ago window for
    // both `before` and `after` reference points (allowing for the few ms
    // we spent on the call itself).
    const sevenDaysMs = 7 * 24 * 60 * 60 * 1000;
    expect(past.getTime()).toBeGreaterThanOrEqual(before - sevenDaysMs - 10);
    expect(past.getTime()).toBeLessThanOrEqual(after - sevenDaysMs + 10);
  });

  it("daysAgo(0) returns approximately now", () => {
    const past = daysAgo(0);
    expect(Math.abs(past.getTime() - Date.now())).toBeLessThan(1000);
  });
});
