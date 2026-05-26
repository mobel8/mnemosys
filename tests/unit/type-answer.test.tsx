/**
 * Tests for the Type-the-answer cognitive helper (Vague 2).
 *
 * Focus:
 *   - The score buckets resolve to the right verdict copy.
 *   - The component renders, accepts input, and forwards the typed value
 *     to the parent through `onSubmit`.
 *   - Diacritic-insensitive comparison still earns "excellent".
 *   - The submit button blocks empty input.
 */

import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { levenshtein, similarityScore, TypeAnswer, verdictFor } from "@/components/TypeAnswer";

describe("TypeAnswer scoring helpers", () => {
  it("computes levenshtein distance correctly", () => {
    expect(levenshtein("kitten", "sitting")).toBe(3);
    expect(levenshtein("paris", "paris")).toBe(0);
    expect(levenshtein("", "abc")).toBe(3);
  });

  it("normalises diacritics + case in similarityScore", () => {
    // "Élise" vs "elise" → identical after normalisation.
    expect(similarityScore("Élise", "elise")).toBe(1);
    expect(similarityScore("café", "cafe")).toBe(1);
  });

  it("buckets scores via verdictFor", () => {
    expect(verdictFor(0.95)).toBe("excellent");
    expect(verdictFor(0.75)).toBe("close");
    expect(verdictFor(0.5)).toBe("incorrect");
    // Exact thresholds.
    expect(verdictFor(0.85)).toBe("excellent");
    expect(verdictFor(0.7)).toBe("close");
    expect(verdictFor(0.69)).toBe("incorrect");
  });
});

describe("TypeAnswer component", () => {
  it("renders an input + submit button with disabled submit when empty", () => {
    const onSubmit = vi.fn();
    render(<TypeAnswer expectedAnswer="Paris" onSubmit={onSubmit} />);
    const input = screen.getByLabelText("Ta réponse") as HTMLInputElement;
    const submit = screen.getByRole("button", { name: /valider/i }) as HTMLButtonElement;
    expect(input).toBeInTheDocument();
    expect(submit.disabled).toBe(true);
  });

  it("calls onSubmit with verdict=excellent for an exact match", () => {
    const onSubmit = vi.fn();
    render(<TypeAnswer expectedAnswer="Paris" onSubmit={onSubmit} />);
    const input = screen.getByLabelText("Ta réponse") as HTMLInputElement;
    fireEvent.change(input, { target: { value: "Paris" } });
    fireEvent.click(screen.getByRole("button", { name: /valider/i }));
    expect(onSubmit).toHaveBeenCalledTimes(1);
    const [typed, score, verdict] = onSubmit.mock.calls[0] as [string, number, string];
    expect(typed).toBe("Paris");
    expect(score).toBe(1);
    expect(verdict).toBe("excellent");
  });

  it("calls onSubmit with verdict=close for a near match", () => {
    const onSubmit = vi.fn();
    render(<TypeAnswer expectedAnswer="Paris" onSubmit={onSubmit} />);
    fireEvent.change(screen.getByLabelText("Ta réponse"), { target: { value: "Pari" } });
    fireEvent.click(screen.getByRole("button", { name: /valider/i }));
    expect(onSubmit).toHaveBeenCalledTimes(1);
    const [, , verdict] = onSubmit.mock.calls[0] as [string, number, string];
    expect(verdict).toBe("close");
  });

  it("calls onSubmit with verdict=incorrect for a far guess", () => {
    const onSubmit = vi.fn();
    render(<TypeAnswer expectedAnswer="Paris" onSubmit={onSubmit} />);
    fireEvent.change(screen.getByLabelText("Ta réponse"), {
      target: { value: "completely wrong answer" },
    });
    fireEvent.click(screen.getByRole("button", { name: /valider/i }));
    const [, , verdict] = onSubmit.mock.calls[0] as [string, number, string];
    expect(verdict).toBe("incorrect");
  });

  it("locks the input once submitted and reveals the expected answer", () => {
    const onSubmit = vi.fn();
    render(<TypeAnswer expectedAnswer="Paris" onSubmit={onSubmit} />);
    fireEvent.change(screen.getByLabelText("Ta réponse"), { target: { value: "Paris" } });
    fireEvent.click(screen.getByRole("button", { name: /valider/i }));
    const input = screen.getByLabelText("Ta réponse") as HTMLInputElement;
    expect(input.disabled).toBe(true);
    // Verdict region surfaces the expected answer + label.
    const feedback = screen.getByTestId("type-answer-feedback");
    expect(feedback.textContent).toContain("Paris");
    expect(feedback.textContent).toContain("Excellent");
  });
});
