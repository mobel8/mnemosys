import { describe, expect, it } from "vitest";
import { formatElapsed, formatInterval } from "@/lib/format";

describe("formatInterval", () => {
  it("formats 0 days as the immediate-retry sentinel", () => {
    expect(formatInterval(0)).toBe("<10 min");
  });

  it("formats sub-hour intervals in minutes", () => {
    // 10 min = 10 / 1440 of a day.
    expect(formatInterval(10 / 1440)).toBe("10 min");
  });

  it("formats sub-day intervals in hours", () => {
    // Half a day → 12 h, integer so no decimal.
    expect(formatInterval(0.5)).toBe("12 h");
  });

  it("formats fractional hours with one decimal", () => {
    expect(formatInterval(1.5 / 24)).toBe("1.5 h");
  });

  it("formats exactly one day", () => {
    expect(formatInterval(1)).toBe("1 j");
  });

  it("formats day-scale intervals", () => {
    expect(formatInterval(15)).toBe("15 j");
    expect(formatInterval(29)).toBe("29 j");
  });

  it("rounds days to nearest integer", () => {
    expect(formatInterval(7.4)).toBe("7 j");
    expect(formatInterval(7.6)).toBe("8 j");
  });

  it("formats month-scale intervals", () => {
    expect(formatInterval(45)).toBe("1.5 mois");
  });

  it("formats year-scale intervals", () => {
    expect(formatInterval(400)).toBe("1.1 ans");
  });

  it("returns the em-dash placeholder for invalid input", () => {
    expect(formatInterval(Number.NaN)).toBe("—");
    expect(formatInterval(-1)).toBe("—");
    expect(formatInterval(Number.POSITIVE_INFINITY)).toBe("—");
  });
});

describe("formatElapsed", () => {
  it("renders zero as 00:00", () => {
    expect(formatElapsed(0)).toBe("00:00");
  });

  it("renders sub-minute durations", () => {
    expect(formatElapsed(15_000)).toBe("00:15");
  });

  it("renders minute + second", () => {
    expect(formatElapsed(125_000)).toBe("02:05");
  });

  it("caps at 99 minutes", () => {
    expect(formatElapsed(60 * 60 * 1000 * 5)).toBe("99:00");
  });

  it("guards against invalid input", () => {
    expect(formatElapsed(Number.NaN)).toBe("00:00");
    expect(formatElapsed(-1000)).toBe("00:00");
  });
});
