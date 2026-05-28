/**
 * Tests for `<WellnessHistory />` (Vague 3 — neuro modes, opt-in).
 *
 * Coverage:
 *   1. Empty state invites the user to enable the neuro modes when no check-in
 *      has ever been logged.
 *   2. With logs, each row surfaces the date, a mood emoji, the sleep hours and
 *      a stress label.
 *
 * The Tauri-backed `useRecentWellness` hook is mocked.
 */

import { render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { WellnessLog } from "@/lib/tauri";

let logs: WellnessLog[] | undefined;
let isLoading = false;

vi.mock("@/lib/queries", () => ({
  useRecentWellness: () => ({ data: logs, isLoading }),
}));

import { WellnessHistory } from "@/components/stats/WellnessHistory";

beforeEach(() => {
  logs = [];
  isLoading = false;
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("WellnessHistory", () => {
  it("shows an invite to enable neuro modes when there are no check-ins", () => {
    logs = [];
    render(<WellnessHistory />);
    // The body invitation references enabling the neuro modes in the settings.
    expect(screen.getByText(/Active les modes « neuro » dans les réglages/i)).toBeInTheDocument();
  });

  it("renders one row per check-in with mood, sleep and stress", () => {
    logs = [
      {
        id: 1,
        date: "2026-05-27",
        mood: 4,
        sleep_hours: 7.5,
        stress_level: 2,
        hydrated: true,
        caffeine_taken: false,
        created_at: 1_700_000_000,
      },
      {
        id: 2,
        date: "2026-05-26",
        mood: 2,
        sleep_hours: 5,
        stress_level: 4,
        hydrated: false,
        caffeine_taken: true,
        created_at: 1_699_900_000,
      },
    ];
    render(<WellnessHistory />);

    // Two rows rendered, newest first.
    const rows = screen.getAllByTestId("wellness-row");
    expect(rows).toHaveLength(2);

    // Mood emojis (4 -> 🙂, 2 -> 😟) surface.
    expect(screen.getByText("🙂")).toBeInTheDocument();
    expect(screen.getByText("😟")).toBeInTheDocument();

    // Sleep hours rendered with the "h" unit (inspect each row's text content
    // so "5 h" can't substring-match inside "7.5 h").
    expect(rows[0]?.textContent).toContain("7.5 h");
    expect(rows[1]?.textContent).toContain("5 h");

    // Stress labels: level 2 -> "Bas", level 4 -> "Élevé".
    expect(screen.getByText("Bas")).toBeInTheDocument();
    expect(screen.getByText("Élevé")).toBeInTheDocument();
  });

  it("renders a loading placeholder without crashing", () => {
    isLoading = true;
    logs = undefined;
    render(<WellnessHistory />);
    expect(screen.getByText(/Chargement/i)).toBeInTheDocument();
  });
});
