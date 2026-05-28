/**
 * Tests for `<PretestPrompt />` (Vague 12 — pretesting effect, Pan 2023).
 *
 * Targets:
 *   - renders the recto + the guess input + the reveal button;
 *   - typing updates the controlled textarea;
 *   - clicking « Révéler » fires `onComplete` with the trimmed guess.
 */

import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { PretestPrompt } from "@/components/PretestPrompt";

describe("PretestPrompt", () => {
  it("renders the front text, the guess input and the reveal button", () => {
    render(<PretestPrompt front="Capitale de la France ?" onComplete={() => undefined} />);
    expect(screen.getByTestId("pretest-prompt")).toBeInTheDocument();
    expect(screen.getByTestId("pretest-front")).toHaveTextContent("Capitale de la France ?");
    expect(screen.getByTestId("pretest-input")).toBeInTheDocument();
    expect(screen.getByTestId("pretest-reveal")).toBeInTheDocument();
  });

  it("updates the textarea as the learner types a guess", () => {
    render(<PretestPrompt front="2 + 2 ?" onComplete={() => undefined} />);
    const input = screen.getByTestId("pretest-input") as HTMLTextAreaElement;
    fireEvent.change(input, { target: { value: "quatre" } });
    expect(input.value).toBe("quatre");
  });

  it("calls onComplete with the trimmed guess when revealed", () => {
    const onComplete = vi.fn();
    render(<PretestPrompt front="Capitale ?" onComplete={onComplete} />);
    fireEvent.change(screen.getByTestId("pretest-input"), {
      target: { value: "  Paris  " },
    });
    fireEvent.click(screen.getByTestId("pretest-reveal"));
    expect(onComplete).toHaveBeenCalledTimes(1);
    expect(onComplete).toHaveBeenCalledWith("Paris");
  });
});
