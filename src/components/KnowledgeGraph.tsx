/**
 * Knowledge Graph (Vague 11) — visualises tag co-occurrence as a 2D
 * force-directed graph rendered in plain SVG (no graph library).
 *
 * Layout: a small hand-rolled force simulation runs once inside a `useMemo`
 * (deterministic — nodes seed on a circle, then a fixed number of iterations
 * apply pairwise repulsion + spring attraction along edges). The result is a
 * static `{ x, y }` per node; we don't animate, which keeps the component
 * cheap and the output stable for tests.
 *
 * Visual encoding:
 *   - node radius ∝ √count (area roughly tracks count),
 *   - edge stroke width ∝ weight,
 *   - hovering a node fades every node/edge not adjacent to it.
 *
 * The SVG uses a fixed `viewBox` and scales responsively to its container.
 */

import { useMemo, useState } from "react";
import type { TagGraph } from "@/lib/tauri";
import { cn } from "@/lib/utils";

/** Internal layout coordinate space (the SVG `viewBox`). */
const WIDTH = 800;
const HEIGHT = 600;
const ITERATIONS = 220;

interface PositionedNode {
  tag: string;
  count: number;
  x: number;
  y: number;
  r: number;
}

interface LayoutResult {
  nodes: PositionedNode[];
  /** Adjacency: tag → set of neighbour tags (for hover highlighting). */
  adjacency: Map<string, Set<string>>;
}

/**
 * Deterministic force-directed layout. Pure function of the graph so the same
 * input always yields the same coordinates (seedable, test-friendly).
 */
/** A mutable particle in the simulation — position + accumulated force. */
interface Particle {
  tag: string;
  count: number;
  x: number;
  y: number;
  fx: number;
  fy: number;
}

function computeLayout(graph: TagGraph): LayoutResult {
  const n = graph.nodes.length;
  const cx = WIDTH / 2;
  const cy = HEIGHT / 2;
  const maxCount = Math.max(1, ...graph.nodes.map((node) => node.count));

  // Seed positions evenly on a circle (deterministic, avoids RNG). A single
  // node sits dead-centre. We model particles as objects so all the inner
  // loops iterate over references — no index-into-array (which would be
  // `T | undefined` under `noUncheckedIndexedAccess`).
  const particles: Particle[] = graph.nodes.map((node, i) => {
    if (n === 1) {
      return { tag: node.tag, count: node.count, x: cx, y: cy, fx: 0, fy: 0 };
    }
    const angle = (2 * Math.PI * i) / n;
    const radius = Math.min(WIDTH, HEIGHT) * 0.35;
    return {
      tag: node.tag,
      count: node.count,
      x: cx + radius * Math.cos(angle),
      y: cy + radius * Math.sin(angle),
      fx: 0,
      fy: 0,
    };
  });

  // Resolve each edge to the two particles it connects, once.
  const byTag = new Map(particles.map((p) => [p.tag, p]));
  const springs = graph.edges
    .map((e) => ({ a: byTag.get(e.source), b: byTag.get(e.target), weight: e.weight }))
    .filter((e): e is { a: Particle; b: Particle; weight: number } => !!e.a && !!e.b);

  // Force constants tuned for the 800×600 box; cooled linearly over the run.
  const repulsion = 9000;
  const springLength = 90;
  const springK = 0.02;

  for (let iter = 0; iter < ITERATIONS && n > 1; iter++) {
    const cooling = 1 - iter / ITERATIONS;
    for (const p of particles) {
      p.fx = 0;
      p.fy = 0;
    }

    // Pairwise repulsion (O(n²) — fine for ≤50 nodes).
    for (let i = 0; i < particles.length; i++) {
      const a = particles[i];
      if (!a) continue;
      for (let j = i + 1; j < particles.length; j++) {
        const b = particles[j];
        if (!b) continue;
        let vx = a.x - b.x;
        let vy = a.y - b.y;
        let distSq = vx * vx + vy * vy;
        if (distSq < 0.01) {
          // Coincident nodes: nudge deterministically apart.
          vx = (i - j) * 0.1 + 0.1;
          vy = (i + j) * 0.1 + 0.1;
          distSq = vx * vx + vy * vy;
        }
        const dist = Math.sqrt(distSq);
        const force = repulsion / distSq;
        const fx = (vx / dist) * force;
        const fy = (vy / dist) * force;
        a.fx += fx;
        a.fy += fy;
        b.fx -= fx;
        b.fy -= fy;
      }
    }

    // Spring attraction along edges (heavier edges pull harder).
    for (const { a, b, weight } of springs) {
      const vx = a.x - b.x;
      const vy = a.y - b.y;
      const dist = Math.sqrt(vx * vx + vy * vy) || 0.01;
      const force = springK * (dist - springLength) * Math.min(weight, 5);
      const fx = (vx / dist) * force;
      const fy = (vy / dist) * force;
      a.fx -= fx;
      a.fy -= fy;
      b.fx += fx;
      b.fy += fy;
    }

    // Apply displacement (capped per step) and keep nodes inside the box.
    const margin = 40;
    const step = 6 * cooling;
    for (const p of particles) {
      const len = Math.sqrt(p.fx * p.fx + p.fy * p.fy) || 1;
      const capped = Math.min(len, step * 5);
      p.x = Math.max(margin, Math.min(WIDTH - margin, p.x + (p.fx / len) * capped));
      p.y = Math.max(margin, Math.min(HEIGHT - margin, p.y + (p.fy / len) * capped));
    }
  }

  const nodes: PositionedNode[] = particles.map((p) => ({
    tag: p.tag,
    count: p.count,
    x: p.x,
    y: p.y,
    // Radius 8..30 scaled by √(count / maxCount).
    r: 8 + 22 * Math.sqrt(p.count / maxCount),
  }));

  const adjacency = new Map<string, Set<string>>();
  for (const node of graph.nodes) adjacency.set(node.tag, new Set());
  for (const edge of graph.edges) {
    adjacency.get(edge.source)?.add(edge.target);
    adjacency.get(edge.target)?.add(edge.source);
  }

  return { nodes, adjacency };
}

/** Map a tag string to a stable hue so clusters are visually distinguishable. */
function tagColor(tag: string): string {
  let hash = 0;
  for (let i = 0; i < tag.length; i++) {
    hash = (hash * 31 + tag.charCodeAt(i)) % 360;
  }
  return `hsl(${hash}, 65%, 55%)`;
}

export interface KnowledgeGraphProps {
  graph: TagGraph;
  className?: string;
}

export function KnowledgeGraph({ graph, className }: KnowledgeGraphProps) {
  const [hovered, setHovered] = useState<string | null>(null);

  const layout = useMemo(() => computeLayout(graph), [graph]);
  const maxWeight = useMemo(() => Math.max(1, ...graph.edges.map((e) => e.weight)), [graph.edges]);
  // Position lookup only depends on the (memoised) layout, not on `hovered`.
  // Hoisting it out of the render body avoids rebuilding the Map on every
  // mouse-move hover state change.
  const posByTag = useMemo(() => new Map(layout.nodes.map((node) => [node.tag, node])), [layout]);

  if (graph.nodes.length === 0) {
    return (
      <div
        className={cn(
          "flex h-[420px] flex-col items-center justify-center gap-2 rounded-lg border border-dashed text-center",
          className,
        )}
        data-testid="knowledge-graph-empty"
      >
        <p className="text-sm text-muted-foreground">
          Aucun tag à afficher. Ajoute des tags à tes cartes pour voir leurs liens.
        </p>
      </div>
    );
  }

  function isActive(tag: string): boolean {
    if (hovered === null) return true;
    return tag === hovered || (layout.adjacency.get(hovered)?.has(tag) ?? false);
  }

  function isEdgeActive(source: string, target: string): boolean {
    if (hovered === null) return true;
    return source === hovered || target === hovered;
  }

  return (
    <div className={cn("w-full overflow-hidden rounded-lg border bg-card", className)}>
      <svg
        viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
        className="h-auto w-full"
        role="img"
        aria-label="Graphe des tags"
        data-testid="knowledge-graph-svg"
      >
        <title>Graphe des liens entre tags</title>

        {/* Edges first so nodes render on top. */}
        <g>
          {graph.edges.map((edge) => {
            const a = posByTag.get(edge.source);
            const b = posByTag.get(edge.target);
            if (!a || !b) return null;
            const active = isEdgeActive(edge.source, edge.target);
            return (
              <line
                key={`${edge.source}--${edge.target}`}
                x1={a.x}
                y1={a.y}
                x2={b.x}
                y2={b.y}
                stroke="currentColor"
                className="text-muted-foreground"
                strokeWidth={1 + 4 * (edge.weight / maxWeight)}
                strokeOpacity={active ? 0.45 : 0.07}
              />
            );
          })}
        </g>

        {/* Nodes + labels. */}
        <g>
          {layout.nodes.map((node) => {
            const active = isActive(node.tag);
            return (
              // biome-ignore lint/a11y/useSemanticElements: SVG node — a real <button> can't be a child of <svg>; role="button" + keyboard focus is the documented ARIA fallback for interactive SVG shapes.
              <g
                key={node.tag}
                transform={`translate(${node.x}, ${node.y})`}
                role="button"
                tabIndex={0}
                aria-label={`${node.tag} (${node.count} cartes)`}
                onMouseEnter={() => setHovered(node.tag)}
                onMouseLeave={() => setHovered(null)}
                onFocus={() => setHovered(node.tag)}
                onBlur={() => setHovered(null)}
                style={{ cursor: "pointer" }}
                data-testid="knowledge-graph-node"
                data-tag={node.tag}
              >
                <circle
                  r={node.r}
                  fill={tagColor(node.tag)}
                  fillOpacity={active ? 0.85 : 0.2}
                  stroke="white"
                  strokeWidth={1.5}
                  strokeOpacity={active ? 0.8 : 0.2}
                />
                <text
                  textAnchor="middle"
                  dy={node.r + 14}
                  className="fill-foreground text-[13px] font-medium"
                  opacity={active ? 1 : 0.25}
                >
                  {node.tag}
                </text>
                <text
                  textAnchor="middle"
                  dy={4}
                  className="fill-white text-[11px] font-semibold"
                  opacity={active ? 1 : 0.4}
                  pointerEvents="none"
                >
                  {node.count}
                </text>
              </g>
            );
          })}
        </g>
      </svg>
    </div>
  );
}
