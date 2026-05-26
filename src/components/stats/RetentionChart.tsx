/**
 * Line chart of daily retention rate over the selected period.
 *
 * Y-axis is clamped between 0.5 and 1.0 — anything below 50 % is far enough
 * off-target to warrant a triage anyway, and the clamp keeps the line
 * variation legible. A dashed reference line sits at 0.9 (the canonical
 * FSRS target retention) to make over/under-shoots obvious at a glance.
 *
 * If the period has fewer than 7 sampled days the chart hides itself and
 * shows a soft "not enough data yet" message — drawing a line through
 * three dots is more noise than signal.
 */

import {
  CartesianGrid,
  Line,
  LineChart,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { formatDate, formatDateLong, type Period, periodToDays } from "@/lib/date";
import { useRetentionByDay } from "@/lib/queries";

const TARGET_RETENTION = 0.9;
const MIN_DAYS_FOR_CHART = 7;

interface RetentionChartProps {
  period: Period;
}

interface ChartDatum {
  date: string;
  rate: number;
  total: number;
  correct: number;
}

export function RetentionChart({ period }: RetentionChartProps) {
  const days = periodToDays(period);
  const { data, isLoading, error } = useRetentionByDay(days);

  const chartData: ChartDatum[] = (data ?? []).map((row) => ({
    date: row.date,
    rate: row.rate,
    total: row.total,
    correct: row.correct,
  }));

  const enoughData = chartData.length >= MIN_DAYS_FOR_CHART;
  const latestRate = chartData.at(-1)?.rate;

  return (
    <Card className="flex flex-col">
      <CardHeader>
        <CardTitle>Rétention</CardTitle>
        <CardDescription>
          {isLoading
            ? "Chargement…"
            : error
              ? `Erreur : ${error.message}`
              : latestRate !== undefined
                ? `Dernière mesure : ${Math.round(latestRate * 100)}% — cible ${Math.round(TARGET_RETENTION * 100)}%`
                : `Cible : ${Math.round(TARGET_RETENTION * 100)}%`}
        </CardDescription>
      </CardHeader>
      <CardContent className="flex-1">
        {!enoughData && !isLoading ? (
          <EmptyState />
        ) : (
          <div className="h-[300px] w-full">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart
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
                  domain={[0.5, 1]}
                  ticks={[0.5, 0.6, 0.7, 0.8, 0.9, 1]}
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
                  labelFormatter={(label) =>
                    typeof label === "string" ? formatDateLong(label) : String(label ?? "")
                  }
                  formatter={(value, _name, item) => {
                    const n = typeof value === "number" ? value : Number(value ?? 0);
                    const payload = (item as { payload?: ChartDatum } | undefined)?.payload;
                    const ratio = payload ? `${payload.correct}/${payload.total}` : "";
                    return [`${Math.round(n * 100)}%${ratio ? ` (${ratio})` : ""}`, "Rétention"];
                  }}
                />
                <ReferenceLine
                  y={TARGET_RETENTION}
                  stroke="var(--color-muted-foreground)"
                  strokeDasharray="4 4"
                  label={{
                    value: "Cible",
                    position: "right",
                    fill: "var(--color-muted-foreground)",
                    fontSize: 10,
                  }}
                />
                <Line
                  type="monotone"
                  dataKey="rate"
                  stroke="var(--color-primary)"
                  strokeWidth={2}
                  dot={{ r: 3, strokeWidth: 0, fill: "var(--color-primary)" }}
                  activeDot={{ r: 5 }}
                  isAnimationActive={false}
                />
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
    <div className="flex h-[300px] items-center justify-center text-center text-sm text-muted-foreground">
      Pas encore assez de reviews pour afficher la courbe (au moins {MIN_DAYS_FOR_CHART} jours
      requis).
    </div>
  );
}
