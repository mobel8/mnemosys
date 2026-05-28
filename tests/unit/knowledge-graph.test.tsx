/**
 * Unit tests for `<KnowledgeGraph />` (Vague 11).
 *
 * The component is pure (graph in → SVG out), so no Tauri/query mocks are
 * needed — we feed it a `TagGraph` prop directly and assert the rendered
 * SVG structure.
 */

import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { KnowledgeGraph } from "@/components/KnowledgeGraph";
import type { TagGraph } from "@/lib/tauri";

describe("KnowledgeGraph", () => {
  it("renders an empty state when there are no nodes", () => {
    const empty: TagGraph = { nodes: [], edges: [] };
    render(<KnowledgeGraph graph={empty} />);
    expect(screen.getByTestId("knowledge-graph-empty")).toBeInTheDocument();
    expect(screen.queryByTestId("knowledge-graph-svg")).not.toBeInTheDocument();
  });

  it("renders one node per tag and the edges between them", () => {
    const graph: TagGraph = {
      nodes: [
        { tag: "french", count: 3 },
        { tag: "verb", count: 2 },
        { tag: "noun", count: 1 },
      ],
      edges: [
        { source: "french", target: "verb", weight: 2 },
        { source: "french", target: "noun", weight: 1 },
      ],
    };
    render(<KnowledgeGraph graph={graph} />);

    // The SVG renders; each tag becomes a node group with its label.
    expect(screen.getByTestId("knowledge-graph-svg")).toBeInTheDocument();
    const nodes = screen.getAllByTestId("knowledge-graph-node");
    expect(nodes).toHaveLength(3);
    expect(screen.getByText("french")).toBeInTheDocument();
    expect(screen.getByText("verb")).toBeInTheDocument();
    expect(screen.getByText("noun")).toBeInTheDocument();

    // Node groups carry their tag in a data attribute for hover targeting.
    const tags = nodes.map((n) => n.getAttribute("data-tag")).sort();
    expect(tags).toEqual(["french", "noun", "verb"]);
  });
});
