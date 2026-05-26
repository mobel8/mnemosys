/**
 * Tests for the Cyclic Sighing primer (Vague 3).
 *
 * Targets:
 *  - the modal renders with phase label + cycle counter
 *  - clicking "Skip" closes the dialog
 *  - the countdown formats `mm:ss` and is gated on `open`
 */

import { fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { CyclicSighing } from "@/components/CyclicSighing";

afterEach(() => {
  vi.useRealTimers();
});

describe("CyclicSighing", () => {
  it("renders the phase label and the remaining counter at open", () => {
    render(
      <CyclicSighing open onClose={() => undefined} durationSeconds={120} />,
    );
    // The default first phase is "inhale1" → label includes "Inspire (1)".
    expect(screen.getByText(/Inspire \(1\)/i)).toBeInTheDocument();
    const remaining = screen.getByTestId("time-remaining");
    expect(remaining.textContent).toMatch(/02:00/);
    expect(screen.getByTestId("cycle-count")).toHaveTextContent("Cycles : 0");
  });

  it("calls onClose when the skip button is pressed", () => {
    const onClose = vi.fn();
    render(<CyclicSighing open onClose={onClose} />);
    fireEvent.click(screen.getByTestId("sighing-skip"));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("renders nothing visible when open=false", () => {
    render(<CyclicSighing open={false} onClose={() => undefined} />);
    expect(screen.queryByTestId("cyclic-sighing-dialog")).toBeNull();
  });
});
