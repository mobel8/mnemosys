/**
 * Smoke + interaction tests for `<StreakWidget />`.
 *
 * Targets:
 *  - the trigger button renders the streak counter (or em-dash when 0).
 *  - clicking the trigger opens the modal with stats tiles.
 *  - the "Sauver mon streak" button is gated on freeze availability **and**
 *    whether the user actually missed yesterday.
 */

import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const freezeMutate = vi.fn();
const toastMock = vi.fn();

vi.mock("@/components/ui/use-toast", () => ({
  toast: (...args: unknown[]) => toastMock(...args),
  useToast: () => ({ toasts: [], toast: toastMock, dismiss: vi.fn() }),
}));

interface UserStatsFixture {
  streak_current: number;
  streak_best: number;
  last_review_date: string | null;
  freeze_remaining: number;
  freeze_month: string | null;
  total_reviews: number;
  total_correct: number;
}

let userStatsData: UserStatsFixture | undefined;
let reviewsData: Array<{ date: string; count: number }> | undefined;

vi.mock("@/lib/queries", () => ({
  useUserStats: () => ({ data: userStatsData, isLoading: false }),
  useReviewsByDay: () => ({ data: reviewsData, isLoading: false }),
  useStreakFreeze: (opts?: {
    onSuccess?: (data: unknown) => void;
    onError?: (err: Error) => void;
  }) => ({
    mutate: () => {
      freezeMutate();
      opts?.onSuccess?.({});
    },
    isPending: false,
  }),
}));

import { StreakWidget } from "@/components/StreakWidget";

const TODAY_ISO = new Date().toISOString().slice(0, 10);
const THREE_DAYS_AGO = new Date(Date.now() - 3 * 24 * 3_600_000).toISOString().slice(0, 10);

beforeEach(() => {
  freezeMutate.mockReset();
  toastMock.mockReset();
  reviewsData = [
    { date: THREE_DAYS_AGO, count: 12 },
    { date: TODAY_ISO, count: 0 },
  ];
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("StreakWidget", () => {
  it("renders an em-dash when the user has no streak yet", () => {
    userStatsData = {
      streak_current: 0,
      streak_best: 0,
      last_review_date: null,
      freeze_remaining: 2,
      freeze_month: null,
      total_reviews: 0,
      total_correct: 0,
    };
    render(<StreakWidget />);
    const trigger = screen.getByRole("button", { name: /streak 0 jours/i });
    expect(trigger).toBeInTheDocument();
    expect(trigger).toHaveTextContent("—");
  });

  it("renders the current streak number when > 0", () => {
    userStatsData = {
      streak_current: 14,
      streak_best: 21,
      last_review_date: TODAY_ISO,
      freeze_remaining: 2,
      freeze_month: TODAY_ISO.slice(0, 7),
      total_reviews: 300,
      total_correct: 270,
    };
    render(<StreakWidget />);
    const trigger = screen.getByRole("button", { name: /streak 14 jours/i });
    expect(trigger).toHaveTextContent("14");
  });

  it("opens the modal showing stat tiles when clicked", async () => {
    userStatsData = {
      streak_current: 7,
      streak_best: 12,
      last_review_date: TODAY_ISO,
      freeze_remaining: 2,
      freeze_month: TODAY_ISO.slice(0, 7),
      total_reviews: 100,
      total_correct: 90,
    };
    render(<StreakWidget />);
    fireEvent.click(screen.getByRole("button", { name: /streak 7 jours/i }));
    await waitFor(() => {
      expect(screen.getByText(/30 derniers jours/i)).toBeInTheDocument();
    });
    // KPI tiles
    expect(screen.getByText(/Actuel/i)).toBeInTheDocument();
    expect(screen.getByText(/Meilleur/i)).toBeInTheDocument();
    expect(screen.getByText(/Reviews/i)).toBeInTheDocument();
    expect(screen.getByText(/Réussite/i)).toBeInTheDocument();
    // 7 in current, 12 in best, 100 in reviews, 90% accuracy
    expect(screen.getByText("90%")).toBeInTheDocument();
  });

  it("disables the freeze button when the user reviewed today", async () => {
    userStatsData = {
      streak_current: 7,
      streak_best: 12,
      last_review_date: TODAY_ISO,
      freeze_remaining: 2,
      freeze_month: TODAY_ISO.slice(0, 7),
      total_reviews: 100,
      total_correct: 90,
    };
    render(<StreakWidget />);
    fireEvent.click(screen.getByRole("button", { name: /streak 7 jours/i }));
    const btn = await screen.findByRole("button", { name: /sauver mon streak/i });
    expect(btn).toBeDisabled();
  });

  it("enables the freeze button when there is freeze stock and the user missed days", async () => {
    userStatsData = {
      streak_current: 7,
      streak_best: 12,
      last_review_date: THREE_DAYS_AGO,
      freeze_remaining: 2,
      freeze_month: TODAY_ISO.slice(0, 7),
      total_reviews: 100,
      total_correct: 90,
    };
    render(<StreakWidget />);
    fireEvent.click(screen.getByRole("button", { name: /streak 7 jours/i }));
    const btn = await screen.findByRole("button", { name: /sauver mon streak/i });
    expect(btn).not.toBeDisabled();
    fireEvent.click(btn);
    expect(freezeMutate).toHaveBeenCalledTimes(1);
    expect(toastMock).toHaveBeenCalled();
  });

  it("disables the freeze button when no freezes remain", async () => {
    userStatsData = {
      streak_current: 7,
      streak_best: 12,
      last_review_date: THREE_DAYS_AGO,
      freeze_remaining: 0,
      freeze_month: TODAY_ISO.slice(0, 7),
      total_reviews: 100,
      total_correct: 90,
    };
    render(<StreakWidget />);
    fireEvent.click(screen.getByRole("button", { name: /streak 7 jours/i }));
    const btn = await screen.findByRole("button", { name: /sauver mon streak/i });
    expect(btn).toBeDisabled();
  });
});
