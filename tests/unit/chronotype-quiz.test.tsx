/**
 * Tests for the Chronotype calibration quiz (Vague 18).
 *
 * Targets:
 *  - the dialog renders its 5 questions when open (and nothing when closed)
 *  - `scoreToChronotype` maps summed scores to the right type
 *  - answering every question « morning-most » and submitting reports
 *    `morning` to `onResult`
 */

import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { ChronotypeQuiz, scoreToChronotype } from "@/components/ChronotypeQuiz";

describe("scoreToChronotype", () => {
  it("classifies high scores as morning, low as evening, mid as intermediate", () => {
    // Max achievable total is 5 + 4 + 5 + 5 + 4 = 23, min is 5.
    expect(scoreToChronotype(23)).toBe("morning");
    expect(scoreToChronotype(18)).toBe("morning");
    expect(scoreToChronotype(15)).toBe("intermediate");
    expect(scoreToChronotype(12)).toBe("evening");
    expect(scoreToChronotype(5)).toBe("evening");
  });
});

describe("ChronotypeQuiz", () => {
  it("renders nothing when closed", () => {
    render(<ChronotypeQuiz open={false} onClose={() => undefined} onResult={() => undefined} />);
    expect(screen.queryByTestId("chronotype-quiz-dialog")).toBeNull();
  });

  it("renders the questionnaire when open", () => {
    render(<ChronotypeQuiz open onClose={() => undefined} onResult={() => undefined} />);
    expect(screen.getByText(/Calibre ton chronotype/i)).toBeInTheDocument();
    // The five prompts each begin with their number.
    expect(screen.getByText(/à quelle heure te lèverais-tu/i)).toBeInTheDocument();
    expect(screen.getByText(/au sommet de ta forme/i)).toBeInTheDocument();
    // Submit is gated until all questions are answered.
    expect(screen.getByTestId("chronotype-submit")).toBeDisabled();
  });

  it("computes 'morning' when every most-morning option is picked", () => {
    const onResult = vi.fn();
    const onClose = vi.fn();
    render(<ChronotypeQuiz open onClose={onClose} onResult={onResult} />);

    // Each question's first radio is the most-morning answer (highest score).
    const wake = screen.getByLabelText("Avant 6h30");
    const alert = screen.getByLabelText("Très alerte");
    const peak = screen.getByLabelText("Tôt le matin");
    const bed = screen.getByLabelText("Avant 21h");
    const self = screen.getByLabelText("Nettement du matin");
    for (const radio of [wake, alert, peak, bed, self]) {
      fireEvent.click(radio);
    }

    const submit = screen.getByTestId("chronotype-submit");
    expect(submit).not.toBeDisabled();
    fireEvent.click(submit);

    expect(onResult).toHaveBeenCalledTimes(1);
    expect(onResult).toHaveBeenCalledWith("morning");
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
