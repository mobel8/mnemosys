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
import { memo, useMemo } from "react";
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
 * Eight visually distinct hues for up to eight concurrent tag lines, all drawn
 * from the design-system runtime tokens (chart palette + brand scale) so the
 * lines stay on-brand and theme-aware. The chart's grid/axes use theme tokens
 * too; these resolve against the `:root` / `.dark` custom properties.
 */
const LINE_COLORS = [
  "var(--chart-1)", // indigo
  "var(--chart-2)", // cyan
  "var(--chart-3)", // green
  "var(--chart-4)", // amber
  "var(--chart-5)", // magenta
  "var(--brand-400)", // light indigo
  "var(--brand-700)", // deep indigo
  "var(--brand-200)", // pale indigo
] as const;

/** A recharts row: one ISO week plus a retention value per tag key. */
type ChartRow = { week: string } & Record<string, number | string | null>;

/** Shorten `"2026-W18"` → `"W18"` for compact axis ticks. */
function shortWeek(label: string): string {
  const idx = label.indexOf("-W");
  return idx >= 0 ? label.slice(idx + 1) : label;
}

function MasteryTimelineImpl() {
  const { data, isLoading, error } = useMasteryTimeline(TIMELINE_WEEKS);

  const weeks = data?.weeks ?? [];
  const series = data?.series ?? [];

  // Pivot {weeks, series[]} into recharts' row-per-week shape. Each tag becomes
  // a numeric key on the row; a `null` point stays null so the line gaps.
  // Memoised so recharts keeps a stable `rows` reference across re-renders.
  const rows: ChartRow[] = useMemo(
    () =>
      weeks.map((week, i) => {
        const row: ChartRow = { week };
        for (const s of series) {
          row[s.tag] = s.points[i] ?? null;
        }
        return row;
      }),
    [weeks, series],
  );

  const hasSeries = series.length > 0;
  const enoughWeeks = weeks.length >= MIN_WEEKS_FOR_CHART;

  return (
    <Card className="flex flex-col">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <TrendingUp className="h-5 w-5 text-brand-500" />
          Évolution de la maîtrise
        </CardTitle>
        <CardDescription
          className={error ? "text-destructive" : undefined}
          role={error ? "alert" : undefined}
          aria-live={error ? "assertive" : undefined}
        >
          {isLoading
            ? "Chargement…"
            : error
              ? `Erreur : ${error.message}`
              : `Rétention hebdomadaire par concept (tag) sur ${TIMELINE_WEEKS} semaines — top ${LINE_COLORS.length} par volume.`}
        </CardDescription>
      </CardHeader>
      <CardContent className="flex-1">
        {isLoading ? (
          <ChartSkeleton />
        ) : !hasSeries || !enoughWeeks ? (
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

/**
 * Memoised: the timeline takes no props and is pure over its query result, so
 * a parent re-render (e.g. period change elsewhere on the page) shouldn't force
 * the recharts subtree to rebuild.
 */
export const MasteryTimeline = memo(MasteryTimelineImpl);

/** Loading placeholder mimicking the chart footprint with soft pulsing bars. */
function ChartSkeleton() {
  const heights = [55, 70, 45, 80, 60, 90, 50, 75, 65, 85, 58, 72];
  return (
    <div className="flex h-[320px] w-full items-end gap-2 px-2 pb-6" aria-hidden>
      {heights.map((h, i) => (
        <div
          // Static decorative placeholder; the list never reorders.
          // biome-ignore lint/suspicious/noArrayIndexKey: fixed skeleton bars.
          key={i}
          className="flex-1 animate-pulse rounded-lg bg-muted"
          style={{ height: `${h}%` }}
        />
      ))}
    </div>
  );
}

function EmptyState() {
  return (
    <div className="flex h-[320px] flex-col items-center justify-center gap-4 text-center">
      <span className="flex h-14 w-14 items-center justify-center rounded-2xl bg-brand-50 text-brand-500">
        <TrendingUp className="h-7 w-7" />
      </span>
      <p className="mx-auto max-w-sm text-sm text-muted-foreground">
        Pas encore assez de révisions taguées pour tracer une évolution. Ajoute des tags à tes notes
        et révise sur plusieurs semaines.
      </p>
    </div>
  );
}
