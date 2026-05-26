/**
 * Smoke tests for `<Achievements />`.
 *
 * Targets:
 *  - the grid renders one tile per catalog entry (locked + unlocked).
 *  - unlocked tiles expose the unlock date; locked tiles a "Verrouillé" badge.
 *  - loading state shows skeleton placeholders.
 */

import { render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

interface AchievementFixture {
  id: number;
  code: string;
  unlocked_at: number;
}

let achievementsData: AchievementFixture[] | undefined;
let isLoading = false;

vi.mock("@/lib/queries", () => ({
  useAchievements: () => ({ data: achievementsData, isLoading }),
}));

import { ACHIEVEMENTS_CATALOG, Achievements } from "@/components/Achievements";

beforeEach(() => {
  achievementsData = [];
  isLoading = false;
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("Achievements", () => {
  it("renders skeleton tiles while loading", () => {
    isLoading = true;
    achievementsData = undefined;
    const { container } = render(<Achievements />);
    // 6 skeletons, all bg-muted/40
    expect(container.querySelectorAll(".animate-pulse")).toHaveLength(6);
  });

  it("renders every catalog entry as a tile", () => {
    achievementsData = [];
    render(<Achievements />);
    const catalogCodes = Object.keys(ACHIEVEMENTS_CATALOG);
    for (const code of catalogCodes) {
      expect(screen.getByTestId(`achievement-${code}`)).toBeInTheDocument();
    }
  });

  it("marks an unlocked tile and shows the unlock date badge", () => {
    const ts = 1_700_000_000;
    achievementsData = [{ id: 1, code: "first_review", unlocked_at: ts }];
    render(<Achievements />);
    const tile = screen.getByTestId("achievement-first_review");
    expect(tile.getAttribute("data-locked")).toBe("false");
    // Locked tiles read "Verrouillé"; unlocked ones display a formatted date.
    expect(screen.queryAllByText(/Verrouillé/).length).toBeGreaterThan(0); // others
    // The first_review tile itself should NOT contain the "Verrouillé" text.
    expect(tile.textContent).not.toContain("Verrouillé");
  });

  it("renders all locked when no achievements are unlocked", () => {
    achievementsData = [];
    render(<Achievements />);
    for (const code of Object.keys(ACHIEVEMENTS_CATALOG)) {
      const tile = screen.getByTestId(`achievement-${code}`);
      expect(tile.getAttribute("data-locked")).toBe("true");
    }
  });
});
