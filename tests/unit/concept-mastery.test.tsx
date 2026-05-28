/**
 * Smoke tests for `<ConceptMastery />` (Vague 20 — BKT concept mastery).
 *
 * Targets:
 *  - each tag renders a bar with its rounded mastery percentage + review count.
 *  - the empty-state message shows when no tagged concept has been reviewed.
 *  - the loading state renders without crashing.
 */

import { render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ConceptMastery as ConceptMasteryData } from "@/lib/tauri";

let masteryData: ConceptMasteryData[] | undefined;
let isLoading = false;

vi.mock("@/lib/queries", () => ({
  useConceptMastery: () => ({ data: masteryData, isLoading }),
}));

import { ConceptMastery } from "@/components/stats/ConceptMastery";

beforeEach(() => {
  masteryData = [];
  isLoading = false;
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("ConceptMastery", () => {
  it("renders one bar per concept with its mastery % and review count", () => {
    masteryData = [
      { tag: "anatomie", mastery: 0.92, reviews: 40 },
      { tag: "physiologie", mastery: 0.45, reviews: 12 },
    ];
    render(<ConceptMastery />);

    // Both tag labels show up.
    expect(screen.getByText("anatomie")).toBeInTheDocument();
    expect(screen.getByText("physiologie")).toBeInTheDocument();

    // Rounded percentages are rendered (0.92 -> 92%, 0.45 -> 45%).
    expect(screen.getByText("92%")).toBeInTheDocument();
    expect(screen.getByText("45%")).toBeInTheDocument();

    // Review counts surface too.
    expect(screen.getByText("40 rev.")).toBeInTheDocument();
    expect(screen.getByText("12 rev.")).toBeInTheDocument();

    // High mastery is labelled "Maîtrisé", low mastery "En cours".
    expect(screen.getByText("Maîtrisé")).toBeInTheDocument();
    expect(screen.getByText("En cours")).toBeInTheDocument();
  });

  it("shows the empty-state copy when there are no tagged concepts", () => {
    masteryData = [];
    render(<ConceptMastery />);
    expect(screen.getByText(/Aucun concept tagué révisé/i)).toBeInTheDocument();
  });

  it("renders a loading placeholder without crashing", () => {
    isLoading = true;
    masteryData = undefined;
    render(<ConceptMastery />);
    expect(screen.getByText(/Chargement/i)).toBeInTheDocument();
  });
});
