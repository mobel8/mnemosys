/**
 * Tests for `<SelfExplanationPrompt />` (Vague 12 — Chi 1989, g≈0.55).
 *
 * Targets:
 *   - renders the prompt with its textarea + continue button;
 *   - clicking « Continuer » fires `onContinue` (even with an empty box,
 *     since the prompt is skippable and never scored).
 */

import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { SelfExplanationPrompt } from "@/components/SelfExplanationPrompt";

describe("SelfExplanationPrompt", () => {
  it("renders the explanation textarea and the continue button", () => {
    render(<SelfExplanationPrompt onContinue={() => undefined} />);
    expect(screen.getByTestId("self-explanation-prompt")).toBeInTheDocument();
    expect(screen.getByTestId("self-explanation-input")).toBeInTheDocument();
    expect(screen.getByTestId("self-explanation-continue")).toBeInTheDocument();
  });

  it("calls onContinue when the learner clicks continue (empty box allowed)", () => {
    const onContinue = vi.fn();
    render(<SelfExplanationPrompt onContinue={onContinue} />);
    fireEvent.click(screen.getByTestId("self-explanation-continue"));
    expect(onContinue).toHaveBeenCalledTimes(1);
  });
});
