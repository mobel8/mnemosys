/**
 * Tests for the Major System helper (Vague 21 — mnémotechnique des chiffres).
 *
 * Coverage:
 *   1. `mapNumber` maps each digit to the canonical consonant sounds and
 *      ignores non-digit characters.
 *   2. The component renders the consonant breakdown for a typed number.
 *
 * The helper is pure frontend (no Tauri IPC), so nothing needs mocking.
 */

import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { MajorSystemHelper, mapNumber, suggestWord } from "@/components/MajorSystemHelper";

describe("Major System mapping", () => {
  it("maps digits to the canonical consonant sounds", () => {
    // 314 → 3=m, 1=t/d, 4=r (the textbook example).
    const out = mapNumber("314");
    expect(out).toEqual([
      { digit: 3, consonants: "m" },
      { digit: 1, consonants: "t, d" },
      { digit: 4, consonants: "r" },
    ]);

    // Spot-check the trickier consonant groups and that 0 = s/z, 9 = p/b.
    expect(mapNumber("0")[0]?.consonants).toBe("s, z");
    expect(mapNumber("6")[0]?.consonants).toBe("ch, j, g doux");
    expect(mapNumber("7")[0]?.consonants).toBe("k, c dur, g dur");
    expect(mapNumber("9")[0]?.consonants).toBe("p, b");
  });

  it("ignores non-digit characters and suggests a peg word", () => {
    // Separators / spaces are stripped, only digits survive.
    expect(mapNumber("3-1 4").map((b) => b.digit)).toEqual([3, 1, 4]);
    expect(mapNumber("").length).toBe(0);

    // The curated table maps 31 → "mat" and a single 1 → "thé".
    expect(suggestWord("31")).toBe("mat");
    expect(suggestWord("1")).toBe("thé");
    expect(suggestWord("")).toBeNull();
  });

  it("renders the consonant breakdown for the default number", () => {
    render(<MajorSystemHelper />);
    // Default input is 314; the breakdown chips and the consonant line render.
    const breakdown = screen.getByTestId("major-breakdown");
    expect(breakdown).toBeInTheDocument();
    // The digit→consonant table heading is present.
    expect(screen.getByText(/La table des chiffres/i)).toBeInTheDocument();
  });
});
