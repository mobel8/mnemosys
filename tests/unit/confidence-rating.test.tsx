/**
 * Tests for the Confidence rating UI (Vague 2 — CBM).
 */

import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { ConfidenceRating } from "@/components/ConfidenceRating";

describe("ConfidenceRating", () => {
  it("renders five level buttons", () => {
    const onChange = vi.fn();
    render(<ConfidenceRating value={null} onChange={onChange} />);
    for (let i = 1; i <= 5; i++) {
      expect(screen.getByTestId(`confidence-${i}`)).toBeInTheDocument();
    }
  });

  it("calls onChange with the level when a button is clicked", () => {
    const onChange = vi.fn();
    render(<ConfidenceRating value={null} onChange={onChange} />);
    fireEvent.click(screen.getByTestId("confidence-3"));
    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onChange).toHaveBeenCalledWith(3);
  });

  it("marks the active button via aria-pressed when value matches", () => {
    const onChange = vi.fn();
    render(<ConfidenceRating value={4} onChange={onChange} />);
    const active = screen.getByTestId("confidence-4");
    expect(active.getAttribute("aria-pressed")).toBe("true");
    // Others must remain unpressed.
    expect(screen.getByTestId("confidence-1").getAttribute("aria-pressed")).toBe("false");
  });
});
