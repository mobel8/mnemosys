/**
 * Temporal Mastery Graph (Vague 23).
 *
 * Where `<ConceptMastery />` shows a single BKT snapshot per tag, this chart
 * shows the *trajectory*: weekly retention (correct / total reviews) for the
 * busiest tags, one line per concept. The X-axis is ISO weeks (oldest →
 * newest), the Y-axis retention %. A `null` week breaks the line into a gap
 * (`connectNulls={false}`) rather than implying a misleading 0%.
 *
 * The backend (`get_mastery_timeline`) already caps the series to the top ~8
 * tags by volume, so the palette below only needs 8 distinct hues. Reuses the
 * `recharts` bundle the stats page already loads.
 */

import { TrendingUp } from "lucide-react";
import {
  CartesianGrid,
  Legend,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { useMasteryTimeline } from "@/lib/queries";

/** How many weeks of history to chart. ~3 months reads well without crowding. */
const TIMELINE_WEEKS = 12;
/** Below this, a line chart through a couple of dots is noise, not signal. */
const MIN_WEEKS_FOR_CHART = 3;

/**
 * Eight visually distinct hues for up to eight concurrent tag lines. Fixed
 * literals (not CSS vars) so the lines stay distinguishable from one another
 * regardless of theme — the chart's own grid/axes use the theme tokens.
 */
const LINE_COLORS = [
  "#3b82f6", // blue
  "#ef4444", // red
  "#10b981", // emerald
  "#f59e0b", // amber
  "#8b5cf6", // violet
  "#ec4899", // pink
  "#14b8a6", // teal
  "#a3a30f", // olive
] as const;

/** A recharts row: one ISO week plus a retention value per tag key. */
type ChartRow = { week: string } & Record<string, number | string | null>;

/** Shorten `"2026-W18"` → `"W18"` for compact axis ticks. */
function shortWeek(label: string): string {
  const idx = label.indexOf("-W");
  return idx >= 0 ? label.slice(idx + 1) : label;
}

export function MasteryTimeline() {
  const { data, isLoading, error } = useMasteryTimeline(TIMELINE_WEEKS);

  const weeks = data?.weeks ?? [];
  const series = data?.series ?? [];

  // Pivot {weeks, series[]} into recharts' row-per-week shape. Each tag becomes
  // a numeric key on the row; a `null` point stays null so the line gaps.
  const rows: ChartRow[] = weeks.map((week, i) => {
    const row: ChartRow = { week };
    for (const s of series) {
      row[s.tag] = s.points[i] ?? null;
    }
    return row;
  });

  const hasSeries = series.length > 0;
  const enoughWeeks = weeks.length >= MIN_WEEKS_FOR_CHART;

  return (
    <Card className="flex flex-col">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <TrendingUp className="h-5 w-5" />
          Évolution de la maîtrise
        </CardTitle>
        <CardDescription>
          {isLoading
            ? "Chargement…"
            : error
              ? `Erreur : ${error.message}`
              : `Rétention hebdomadaire par concept (tag) sur ${TIMELINE_WEEKS} semaines — top ${LINE_COLORS.length} par volume.`}
        </CardDescription>
      </CardHeader>
      <CardContent className="flex-1">
        {!isLoading && (!hasSeries || !enoughWeeks) ? (
          <EmptyState />
        ) : (
          <div className="h-[320px] w-full">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart
                data={rows}
                margin={{ top: 8, right: 16, left: 0, bottom: 0 }}
                accessibilityLayer
              >
                <CartesianGrid
                  stroke="var(--color-border)"
                  strokeDasharray="3 3"
                  vertical={false}
                />
                <XAxis
                  dataKey="week"
                  stroke="var(--color-muted-foreground)"
                  fontSize={11}
                  tickLine={false}
                  axisLine={{ stroke: "var(--color-border)" }}
                  tickFormatter={shortWeek}
                  minTickGap={16}
                />
                <YAxis
                  stroke="var(--color-muted-foreground)"
                  fontSize={11}
                  tickLine={false}
                  axisLine={{ stroke: "var(--color-border)" }}
                  domain={[0, 1]}
                  ticks={[0, 0.25, 0.5, 0.75, 1]}
                  tickFormatter={(value: number) => `${Math.round(value * 100)}%`}
                  width={40}
                />
                <Tooltip
                  contentStyle={{
                    backgroundColor: "var(--color-popover)",
                    border: "1px solid var(--color-border)",
                    borderRadius: "var(--radius-md)",
                    color: "var(--color-popover-foreground)",
                    fontSize: "0.8rem",
                  }}
                  formatter={(value) => {
                    const n = typeof value === "number" ? value : Number(value ?? 0);
                    return `${Math.round(n * 100)}%`;
                  }}
                />
                <Legend wrapperStyle={{ fontSize: "0.75rem" }} iconType="line" iconSize={12} />
                {series.map((s, idx) => (
                  <Line
                    key={s.tag}
                    type="monotone"
                    dataKey={s.tag}
                    name={s.tag}
                    stroke={LINE_COLORS[idx % LINE_COLORS.length]}
                    strokeWidth={2}
                    dot={{ r: 2, strokeWidth: 0 }}
                    activeDot={{ r: 4 }}
                    connectNulls={false}
                    isAnimationActive={false}
                  />
                ))}
              </LineChart>
            </ResponsiveContainer>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function EmptyState() {
  return (
    <div className="flex h-[320px] items-center justify-center text-center text-sm text-muted-foreground">
      Pas encore assez de révisions taguées pour tracer une évolution. Ajoute des tags à tes notes
      et révise sur plusieurs semaines.
    </div>
  );
}
