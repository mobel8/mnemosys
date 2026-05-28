/**
 * Smoke tests for `<MasteryTimeline />` (Vague 23 — Temporal Mastery Graph).
 *
 * Targets:
 *  - the empty-state copy shows when the backend returns no series.
 *  - with real series + enough weeks, one chart line renders per tag.
 *
 * `recharts` renders nothing measurable under jsdom (its ResponsiveContainer
 * reports a 0×0 box), so we replace the few primitives we use with thin
 * passthroughs that expose `dataKey` as a `data-*` attribute. That lets us
 * assert "one <Line> per tag" without a real layout pass.
 */

import { render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { MasteryTimeline as MasteryTimelineData } from "@/lib/tauri";

let timelineData: MasteryTimelineData | undefined;
let isLoading = false;
const error: Error | null = null;

vi.mock("@/lib/queries", () => ({
  useMasteryTimeline: () => ({ data: timelineData, isLoading, error }),
}));

// Passthrough recharts so children mount in jsdom; surface `dataKey` so the
// per-tag <Line> elements are countable/inspectable.
vi.mock("recharts", () => {
  const Pass = ({ children }: { children?: React.ReactNode }) => <div>{children}</div>;
  return {
    ResponsiveContainer: Pass,
    LineChart: Pass,
    CartesianGrid: () => null,
    XAxis: () => null,
    YAxis: () => null,
    Tooltip: () => null,
    Legend: () => null,
    Line: ({ dataKey }: { dataKey: string }) => <div data-testid="chart-line" data-key={dataKey} />,
  };
});

import { MasteryTimeline } from "@/components/stats/MasteryTimeline";

beforeEach(() => {
  timelineData = { weeks: [], series: [] };
  isLoading = false;
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("MasteryTimeline", () => {
  it("shows the empty-state copy when there are no series", () => {
    timelineData = { weeks: [], series: [] };
    render(<MasteryTimeline />);
    expect(screen.getByText(/Pas encore assez de révisions taguées/i)).toBeInTheDocument();
    // No chart lines drawn in the empty state.
    expect(screen.queryAllByTestId("chart-line")).toHaveLength(0);
  });

  it("renders one line per tag when given series over enough weeks", () => {
    timelineData = {
      weeks: ["2026-W16", "2026-W17", "2026-W18"],
      series: [
        { tag: "anatomie", points: [null, 0.5, 1.0] },
        { tag: "physio", points: [0.0, null, 0.75] },
      ],
    };
    render(<MasteryTimeline />);

    const lines = screen.getAllByTestId("chart-line");
    expect(lines).toHaveLength(2);
    const keys = lines.map((l) => l.getAttribute("data-key"));
    expect(keys).toContain("anatomie");
    expect(keys).toContain("physio");

    // The empty copy is absent once data is present.
    expect(screen.queryByText(/Pas encore assez de révisions taguées/i)).not.toBeInTheDocument();
  });
});
