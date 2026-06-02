/**
 * Bar chart of reviews completed per day across the selected period.
 *
 * Backed by `useReviewsByDay(periodToDays(period))` and rendered with
 * recharts' `BarChart` inside a `ResponsiveContainer` so the chart fills
 * its parent card width while keeping a fixed 300 px height.
 *
 * Days with zero reviews are omitted by the backend — that's fine; the
 * X-axis stays sparse but the visual scale across periods is still
 * comparable thanks to the consistent bar color.
 */

import { BarChart3 } from "lucide-react";
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { formatDate, formatDateLong, type Period, periodToDays } from "@/lib/date";
import { useReviewsByDay } from "@/lib/queries";
import { cn } from "@/lib/utils";

interface ReviewsByDayChartProps {
  period: Period;
}

interface ChartDatum {
  date: string;
  count: number;
}

export function ReviewsByDayChart({ period }: ReviewsByDayChartProps) {
  const days = periodToDays(period);
  const { data, isLoading, error } = useReviewsByDay(days);

  const chartData: ChartDatum[] = (data ?? []).map((row) => ({
    date: row.date,
    count: row.count,
  }));

  return (
    <Card className={cn("flex flex-col", error && "border-destructive/40")}>
      <CardHeader>
        <CardTitle>Révisions par jour</CardTitle>
        <CardDescription className={cn(error && "text-destructive")}>
          {isLoading
            ? "Chargement…"
            : error
              ? `Erreur : ${error.message}`
              : `${chartData.length} jour(s) avec activité sur ${days}`}
        </CardDescription>
      </CardHeader>
      <CardContent className="flex-1">
        {isLoading ? (
          <ChartSkeleton />
        ) : error ? (
          <ErrorState />
        ) : chartData.length === 0 ? (
          <EmptyState />
        ) : (
          <div className="h-[300px] w-full">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart
                data={chartData}
                margin={{ top: 8, right: 16, left: 0, bottom: 0 }}
                accessibilityLayer
              >
                <CartesianGrid
                  stroke="var(--color-border)"
                  strokeDasharray="3 3"
                  vertical={false}
                />
                <XAxis
                  dataKey="date"
                  stroke="var(--color-muted-foreground)"
                  fontSize={11}
                  tickLine={false}
                  axisLine={{ stroke: "var(--color-border)" }}
                  tickFormatter={(value: string) => formatDate(value)}
                  minTickGap={20}
                />
                <YAxis
                  stroke="var(--color-muted-foreground)"
                  fontSize={11}
                  tickLine={false}
                  axisLine={{ stroke: "var(--color-border)" }}
                  allowDecimals={false}
                  width={32}
                />
                <Tooltip
                  cursor={{ fill: "var(--color-accent)", opacity: 0.4 }}
                  contentStyle={{
                    backgroundColor: "var(--color-popover)",
                    border: "1px solid var(--color-border)",
                    borderRadius: "var(--radius-md)",
                    color: "var(--color-popover-foreground)",
                    fontSize: "0.8rem",
                  }}
                  labelFormatter={(label) =>
                    typeof label === "string" ? formatDateLong(label) : String(label ?? "")
                  }
                  formatter={(value) => {
                    const n = typeof value === "number" ? value : Number(value ?? 0);
                    return [`${n} review${n > 1 ? "s" : ""}`, "Total"];
                  }}
                />
                <Bar dataKey="count" fill="var(--color-primary)" radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function EmptyState() {
  return (
    <div className="flex h-[300px] flex-col items-center justify-center gap-4 text-center">
      <span className="flex h-12 w-12 items-center justify-center rounded-2xl bg-brand-50 text-brand-500">
        <BarChart3 className="h-6 w-6" />
      </span>
      <p className="mx-auto max-w-xs text-sm text-muted-foreground">
        Pas encore de révisions sur cette période.
      </p>
    </div>
  );
}

function ErrorState() {
  return (
    <div className="flex h-[300px] items-center justify-center text-center text-sm text-destructive">
      Impossible de charger les révisions.
    </div>
  );
}

/** Soft pulsing bar-chart placeholder used while data loads. */
function ChartSkeleton() {
  const heights = [55, 70, 45, 80, 60, 90, 50, 75, 65];
  return (
    <div className="flex h-[300px] w-full items-end gap-2 px-2 pb-6" aria-hidden>
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
