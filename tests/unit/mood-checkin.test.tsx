/**
 * Tests for the Mood/Sleep/Stress pre-session check-in (Vague 3).
 *
 * Targets:
 *  - renders the five mood emojis + the two sliders + the two toggles
 *  - clicking "Passer" closes without firing the submit mutation
 *  - clicking "Valider" forwards the values via the mutation
 *  - shows the low-sleep disclaimer when sleep_hours < 6
 *  - shows the high-stress disclaimer when stress_level >= 4
 */

import { fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const submitMock = vi.fn();

vi.mock("@/lib/queries", () => ({
  useSubmitWellness: (hookOpts?: {
    onSuccess?: (data: unknown) => void;
  }) => ({
    mutate: (
      input: Record<string, unknown>,
      mutateOpts?: { onSuccess?: (data: unknown) => void },
    ) => {
      submitMock(input);
      const log = {
        id: 1,
        date: "2026-05-27",
        mood: (input.mood as number | null) ?? null,
        sleep_hours: (input.sleepHours as number | null) ?? null,
        stress_level: (input.stressLevel as number | null) ?? null,
        hydrated: input.hydrated === true,
        caffeine_taken: input.caffeineTaken === true,
        created_at: 1_700_000_000,
      };
      hookOpts?.onSuccess?.(log);
      mutateOpts?.onSuccess?.(log);
    },
    isPending: false,
  }),
}));

import { MoodCheckIn } from "@/components/MoodCheckIn";

beforeEach(() => {
  submitMock.mockReset();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("MoodCheckIn", () => {
  it("renders the five mood emojis and both toggles", () => {
    render(<MoodCheckIn open onClose={() => undefined} />);
    for (let i = 1; i <= 5; i++) {
      expect(screen.getByTestId(`mood-${i}`)).toBeInTheDocument();
    }
    expect(screen.getByTestId("hydrated-switch")).toBeInTheDocument();
    expect(screen.getByTestId("caffeine-switch")).toBeInTheDocument();
  });

  it("calls onClose without submitting when 'Passer' is clicked", () => {
    const onClose = vi.fn();
    render(<MoodCheckIn open onClose={onClose} />);
    fireEvent.click(screen.getByTestId("mood-skip"));
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(submitMock).not.toHaveBeenCalled();
  });

  it("forwards the selected mood through the submit mutation", () => {
    const onClose = vi.fn();
    const onSubmit = vi.fn();
    render(<MoodCheckIn open onClose={onClose} onSubmit={onSubmit} />);
    fireEvent.click(screen.getByTestId("mood-4"));
    fireEvent.click(screen.getByTestId("mood-submit"));
    expect(submitMock).toHaveBeenCalledTimes(1);
    expect(submitMock.mock.calls[0]?.[0]).toMatchObject({
      mood: 4,
      sleepHours: null,
      stressLevel: null,
      hydrated: false,
      caffeineTaken: false,
    });
    expect(onSubmit).toHaveBeenCalledTimes(1);
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("does not show the low-sleep disclaimer until the slider is touched", () => {
    render(<MoodCheckIn open onClose={() => undefined} />);
    expect(screen.queryByTestId("low-sleep-disclaimer")).toBeNull();
  });

  it("shows the high-stress disclaimer when stress >= 4 is picked", () => {
    render(<MoodCheckIn open onClose={() => undefined} />);
    const slider = screen.getByTestId("stress-slider");
    // Simulate keyboard interaction with the Radix slider — focus + ArrowRight
    // bumps the value by `step` (1). We start at the default of 3 so two
    // right-arrows = 5.
    const thumb = slider.querySelector('[role="slider"]') as HTMLElement | null;
    expect(thumb).not.toBeNull();
    if (thumb) {
      thumb.focus();
      fireEvent.keyDown(thumb, { key: "ArrowRight" });
      fireEvent.keyDown(thumb, { key: "ArrowRight" });
    }
    expect(screen.getByTestId("high-stress-disclaimer")).toBeInTheDocument();
  });
});
