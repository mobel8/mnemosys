/**
 * Tests for the Gesture-drawing timer (Vague 16 — Mode Arts).
 *
 * Targets:
 *  - the timer renders with its presets, canvas frame and zero poses done
 *  - picking a duration preset updates the displayed countdown
 *
 * The Web-Audio AudioContext is stubbed globally in `tests/setup.ts`.
 */

import { fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { GestureTimer } from "@/components/art/GestureTimer";

afterEach(() => {
  vi.useRealTimers();
});

describe("GestureTimer", () => {
  it("renders the presets, canvas frame and an initial pose count of 0", () => {
    render(<GestureTimer />);
    expect(screen.getByTestId("gesture-timer")).toBeInTheDocument();
    expect(screen.getByTestId("canvas-frame")).toBeInTheDocument();
    expect(screen.getByTestId("poses-done")).toHaveTextContent("0");
    // The four quick presets + the ladder shortcut are all present.
    expect(screen.getByTestId("preset-30")).toBeInTheDocument();
    expect(screen.getByTestId("preset-60")).toBeInTheDocument();
    expect(screen.getByTestId("preset-120")).toBeInTheDocument();
    expect(screen.getByTestId("preset-300")).toBeInTheDocument();
    expect(screen.getByTestId("preset-ladder")).toBeInTheDocument();
  });

  it("loads the selected duration preset into the countdown", () => {
    render(<GestureTimer />);
    // Default pose is 1 min.
    expect(screen.getByTestId("time-remaining")).toHaveTextContent("01:00");

    fireEvent.click(screen.getByTestId("preset-30"));
    expect(screen.getByTestId("time-remaining")).toHaveTextContent("00:30");

    fireEvent.click(screen.getByTestId("preset-300"));
    expect(screen.getByTestId("time-remaining")).toHaveTextContent("05:00");
  });
});
