import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { retentionColor, TodayCard } from "@/components/stats/TodayCard";
import type { TodayStats } from "@/lib/tauri";

const FULL_DATA: TodayStats = {
  reviews_done_today: 42,
  due_now: 7,
  new_cards_today: 5,
  retention_today: 0.94,
};

describe("TodayCard", () => {
  it("renders the four KPI tiles", () => {
    render(<TodayCard data={FULL_DATA} />);
    expect(screen.getByTestId("today-reviews-done")).toBeInTheDocument();
    expect(screen.getByTestId("today-due-now")).toBeInTheDocument();
    expect(screen.getByTestId("today-new-cards")).toBeInTheDocument();
    expect(screen.getByTestId("today-retention")).toBeInTheDocument();
  });

  it("shows the provided numeric values", () => {
    render(<TodayCard data={FULL_DATA} />);
    expect(screen.getByTestId("today-reviews-done-value")).toHaveTextContent("42");
    expect(screen.getByTestId("today-due-now-value")).toHaveTextContent("7");
    expect(screen.getByTestId("today-new-cards-value")).toHaveTextContent("5");
    expect(screen.getByTestId("today-retention-value")).toHaveTextContent("94%");
  });

  it("renders zeros and a neutral « — » retention when no data has loaded yet", () => {
    render(<TodayCard data={undefined} />);
    expect(screen.getByTestId("today-reviews-done-value")).toHaveTextContent("0");
    expect(screen.getByTestId("today-due-now-value")).toHaveTextContent("0");
    expect(screen.getByTestId("today-new-cards-value")).toHaveTextContent("0");
    // P098: 0 review today → « — » (no data) rather than an alarming red 0 %.
    expect(screen.getByTestId("today-retention-value")).toHaveTextContent("—");
  });

  it("colors retention with the destructive token when below 75 %", () => {
    render(
      <TodayCard
        data={{
          reviews_done_today: 10,
          due_now: 0,
          new_cards_today: 0,
          retention_today: 0.6,
        }}
      />,
    );
    const value = screen.getByTestId("today-retention-value");
    expect(value.className).toMatch(/text-destructive/);
  });

  it("colors retention with the success token at >= 90 %", () => {
    render(<TodayCard data={FULL_DATA} />);
    const value = screen.getByTestId("today-retention-value");
    expect(value.className).toMatch(/text-success/);
  });

  it("shows em-dash while loading", () => {
    render(<TodayCard data={undefined} isLoading />);
    expect(screen.getByTestId("today-reviews-done-value")).toHaveTextContent("—");
  });
});

describe("retentionColor", () => {
  it("returns green for >= 0.9", () => {
    expect(retentionColor(0.9)).toBe("green");
    expect(retentionColor(1)).toBe("green");
  });

  it("returns amber for 0.75 .. 0.89", () => {
    expect(retentionColor(0.75)).toBe("amber");
    expect(retentionColor(0.89)).toBe("amber");
  });

  it("returns red below 0.75", () => {
    expect(retentionColor(0.74)).toBe("red");
    expect(retentionColor(0)).toBe("red");
  });
});
