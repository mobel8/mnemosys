import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { describe, expect, it, vi } from "vitest";

// Mock the Tauri invoke layer so `useNextStates` resolves with predictable
// data instead of trying to reach a real backend (which doesn't exist under
// jsdom).
vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn(async (cmd: string) => {
    if (cmd === "preview_next_states") {
      return {
        again: { memory: { stability: 1, difficulty: 5 }, interval_days: 0 },
        hard: { memory: { stability: 2, difficulty: 5 }, interval_days: 2 },
        good: { memory: { stability: 4, difficulty: 5 }, interval_days: 7 },
        easy: { memory: { stability: 8, difficulty: 5 }, interval_days: 15 },
      };
    }
    return null;
  }),
}));

import { ReviewControls } from "@/components/ReviewControls";

function renderWithClient(ui: ReactNode) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(<QueryClientProvider client={client}>{ui}</QueryClientProvider>);
}

describe("ReviewControls", () => {
  it("renders the flip button in the question phase", () => {
    const onFlip = vi.fn();
    const onRate = vi.fn();
    renderWithClient(
      <ReviewControls phase="question" cardId={1} onFlip={onFlip} onRate={onRate} />,
    );
    expect(screen.getByRole("button", { name: /voir la réponse/i })).toBeInTheDocument();
    // No rating buttons in question phase.
    expect(screen.queryByTestId("rating-good")).not.toBeInTheDocument();
  });

  it("invokes onFlip when the flip button is clicked", () => {
    const onFlip = vi.fn();
    const onRate = vi.fn();
    renderWithClient(
      <ReviewControls phase="question" cardId={1} onFlip={onFlip} onRate={onRate} />,
    );
    fireEvent.click(screen.getByRole("button", { name: /voir la réponse/i }));
    expect(onFlip).toHaveBeenCalledTimes(1);
    expect(onRate).not.toHaveBeenCalled();
  });

  it("renders four rating buttons in the answer phase", () => {
    const onFlip = vi.fn();
    const onRate = vi.fn();
    renderWithClient(<ReviewControls phase="answer" cardId={1} onFlip={onFlip} onRate={onRate} />);
    expect(screen.getByTestId("rating-again")).toBeInTheDocument();
    expect(screen.getByTestId("rating-hard")).toBeInTheDocument();
    expect(screen.getByTestId("rating-good")).toBeInTheDocument();
    expect(screen.getByTestId("rating-easy")).toBeInTheDocument();
  });

  it("calls onRate(3) when the Good button is clicked", () => {
    const onFlip = vi.fn();
    const onRate = vi.fn();
    renderWithClient(<ReviewControls phase="answer" cardId={1} onFlip={onFlip} onRate={onRate} />);
    fireEvent.click(screen.getByTestId("rating-good"));
    expect(onRate).toHaveBeenCalledTimes(1);
    expect(onRate).toHaveBeenCalledWith(3);
  });

  it("calls onRate(1) for Again and onRate(4) for Easy", () => {
    const onFlip = vi.fn();
    const onRate = vi.fn();
    renderWithClient(<ReviewControls phase="answer" cardId={1} onFlip={onFlip} onRate={onRate} />);
    fireEvent.click(screen.getByTestId("rating-again"));
    fireEvent.click(screen.getByTestId("rating-easy"));
    expect(onRate).toHaveBeenNthCalledWith(1, 1);
    expect(onRate).toHaveBeenNthCalledWith(2, 4);
  });

  it("renders formatted interval previews under each button", async () => {
    const onFlip = vi.fn();
    const onRate = vi.fn();
    renderWithClient(<ReviewControls phase="answer" cardId={1} onFlip={onFlip} onRate={onRate} />);

    // Wait for the preview query to resolve.
    await waitFor(() => {
      // "Again" → 0 days → "<10 min".
      expect(screen.getByText("<10 min")).toBeInTheDocument();
    });
    expect(screen.getByText("2 j")).toBeInTheDocument();
    expect(screen.getByText("7 j")).toBeInTheDocument();
    expect(screen.getByText("15 j")).toBeInTheDocument();
  });

  it("disables rating buttons during submission", () => {
    const onFlip = vi.fn();
    const onRate = vi.fn();
    renderWithClient(
      <ReviewControls
        phase="submitting"
        cardId={1}
        onFlip={onFlip}
        onRate={onRate}
        pendingRating={3}
      />,
    );
    const good = screen.getByTestId("rating-good") as HTMLButtonElement;
    expect(good.disabled).toBe(true);
    fireEvent.click(good);
    expect(onRate).not.toHaveBeenCalled();
  });
});
