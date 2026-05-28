/**
 * Unit tests for the Vague 10 FrequencyCoverageCard.
 *
 * We mock `@/lib/queries`' `useFrequencyCoverage` so we can drive the card
 * with a fixed coverage payload (or an all-zero / untagged one) and assert
 * the rendered legend counts + the empty-state copy without a live backend.
 */

import { render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { FrequencyCoverage } from "@/lib/tauri";

const coverageMock = vi.fn();

vi.mock("@/lib/queries", () => ({
  useFrequencyCoverage: () => coverageMock(),
}));

import { FrequencyCoverageCard } from "@/components/FrequencyCoverageCard";

afterEach(() => {
  vi.restoreAllMocks();
  coverageMock.mockReset();
});

function withCoverage(data: FrequencyCoverage) {
  coverageMock.mockReturnValue({ data, isLoading: false });
}

describe("FrequencyCoverageCard", () => {
  it("renders the bands with their counts when notes are tagged", () => {
    withCoverage({
      top_100: 3,
      top_1k: 2,
      top_5k: 0,
      top_10k: 0,
      beyond: 1,
      untagged: 4,
    });
    render(<FrequencyCoverageCard deckId={1} />);

    // Legend rows show each band label.
    expect(screen.getByText("Top 100")).toBeInTheDocument();
    expect(screen.getByText("Non taggé")).toBeInTheDocument();
    // Counts are rendered (top_100 = 3, untagged = 4).
    expect(screen.getByText("3")).toBeInTheDocument();
    expect(screen.getByText("4")).toBeInTheDocument();
  });

  it("shows the untagged hint when the deck has notes but none are tagged", () => {
    withCoverage({
      top_100: 0,
      top_1k: 0,
      top_5k: 0,
      top_10k: 0,
      beyond: 0,
      untagged: 5,
    });
    render(<FrequencyCoverageCard deckId={1} />);
    expect(screen.getByText(/Aucune note taggée par fréquence/i)).toBeInTheDocument();
  });
});
