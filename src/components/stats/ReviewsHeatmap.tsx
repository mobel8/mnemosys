/**
 * GitHub-style contribution heatmap covering the last 365 days.
 *
 * The grid is a single CSS-grid with 7 rows (one per weekday, Monday at the
 * top) and as many columns as weeks fit in the trailing year. The first
 * column is the partial week containing the start date and the last column
 * is the week containing today.
 *
 * Color buckets:
 *   - 0     reviews → `bg-muted`
 *   - 1-10           → `bg-green-200`  / dark:bg-green-900
 *   - 11-50          → `bg-green-400`  / dark:bg-green-700
 *   - 51-100         → `bg-green-600`  / dark:bg-green-500
 *   - 100+           → `bg-green-800`  / dark:bg-green-300
 *
 * Hover surface uses the native `title` attribute so we don't need to add
 * a popper library just for this view. The container scrolls horizontally
 * on narrow viewports.
 */

import { CalendarDays } from "lucide-react";
import { useMemo } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { daysAgo, formatDateLong, isoDate } from "@/lib/date";
import { useReviewsByDay } from "@/lib/queries";
import { cn } from "@/lib/utils";

const TOTAL_DAYS = 365;
const ROWS = 7; // weekdays (Mon..Sun)

const WEEKDAY_LABELS = ["Lun", "Mar", "Mer", "Jeu", "Ven", "Sam", "Dim"];
const MONTH_LABELS = [
  "Jan",
  "Fév",
  "Mar",
  "Avr",
  "Mai",
  "Juin",
  "Juil",
  "Août",
  "Sep",
  "Oct",
  "Nov",
  "Déc",
];

/**
 * Map a unique ISO day to its review count. Returns a fresh map every call
 * so callers can mutate freely without affecting upstream caches.
 */
function indexCounts(rows: { date: string; count: number }[] | undefined): Map<string, number> {
  const map = new Map<string, number>();
  if (!rows) return map;
  for (const row of rows) {
    map.set(row.date, row.count);
  }
  return map;
}

/** Tailwind class for a given review count. */
function colorFor(count: number): string {
  if (count <= 0) return "bg-muted";
  if (count <= 10) return "bg-green-200 dark:bg-green-900";
  if (count <= 50) return "bg-green-400 dark:bg-green-700";
  if (count <= 100) return "bg-green-600 dark:bg-green-500";
  return "bg-green-800 dark:bg-green-300";
}

interface DayCell {
  /** YYYY-MM-DD, or null when the slot pads the start of the first column. */
  isoDay: string | null;
  date: Date | null;
  count: number;
}

interface WeekColumn {
  /** First day of the column (Monday). Used for month-label placement. */
  weekStart: Date;
  days: DayCell[];
}

/**
 * Build the column-major grid covering the last `TOTAL_DAYS` days, aligned
 * so each column starts on Monday.
 */
function buildGrid(counts: Map<string, number>): WeekColumn[] {
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  const start = daysAgo(TOTAL_DAYS - 1);
  start.setHours(0, 0, 0, 0);

  // Shift the start back to the previous Monday so the first column begins
  // on a Monday. `getDay()` returns 0 for Sunday, 1 for Monday, …, 6 for
  // Saturday — normalise to Monday-first (Mon=0..Sun=6).
  const startWeekdayMonFirst = (start.getDay() + 6) % 7;
  const gridStart = new Date(start);
  gridStart.setDate(gridStart.getDate() - startWeekdayMonFirst);

  const columns: WeekColumn[] = [];
  const cursor = new Date(gridStart);

  while (cursor <= today) {
    const weekStart = new Date(cursor);
    const days: DayCell[] = [];
    for (let row = 0; row < ROWS; row += 1) {
      const isPad = cursor < start || cursor > today;
      if (isPad) {
        days.push({ isoDay: null, date: null, count: 0 });
      } else {
        const iso = isoDate(cursor);
        days.push({
          isoDay: iso,
          date: new Date(cursor),
          count: counts.get(iso) ?? 0,
        });
      }
      cursor.setDate(cursor.getDate() + 1);
    }
    columns.push({ weekStart, days });
  }

  return columns;
}

/**
 * For each column, return the month label that should appear above it.
 * We label only the first column of every month so the row stays sparse.
 */
function monthLabels(columns: WeekColumn[]): (string | null)[] {
  let lastMonth = -1;
  return columns.map((col) => {
    const month = col.weekStart.getMonth();
    if (month !== lastMonth) {
      lastMonth = month;
      // Pull a representative day inside the column (first non-pad) so the
      // label aligns with the actual month rather than the padded Monday.
      const sample = col.days.find((d) => d.date) ?? col.days[0];
      if (sample?.date) {
        return MONTH_LABELS[sample.date.getMonth()] ?? null;
      }
      return MONTH_LABELS[month] ?? null;
    }
    return null;
  });
}

export function ReviewsHeatmap() {
  const { data, isLoading, error } = useReviewsByDay(TOTAL_DAYS);

  const grid = useMemo(() => buildGrid(indexCounts(data)), [data]);
  const labels = useMemo(() => monthLabels(grid), [grid]);
  const totalReviews = useMemo(
    () => grid.reduce((sum, col) => sum + col.days.reduce((s, d) => s + d.count, 0), 0),
    [grid],
  );

  return (
    <Card className={cn(error && "border-destructive/40")}>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <CalendarDays className="h-5 w-5 text-brand-500" />
          Activité sur 365 jours
        </CardTitle>
        <CardDescription className={cn(error && "text-destructive")}>
          {isLoading
            ? "Chargement…"
            : error
              ? `Erreur : ${error.message}`
              : `${totalReviews} révision(s) sur l'année`}
        </CardDescription>
      </CardHeader>
      <CardContent>
        <div
          className={cn("overflow-x-auto", isLoading && "animate-pulse")}
          data-testid="heatmap-scroll"
        >
          <div className="inline-flex flex-col gap-1">
            {/* Month labels */}
            <div
              className="grid gap-1"
              style={{ gridTemplateColumns: `1.5rem repeat(${grid.length}, 0.75rem)` }}
            >
              <div />
              {labels.map((label, idx) => (
                <div
                  // The column index is the only stable identity here — two
                  // adjacent columns can share `null` and that's intentional.
                  // biome-ignore lint/suspicious/noArrayIndexKey: column index is the natural key.
                  key={`m-${idx}`}
                  className="text-[10px] leading-none text-muted-foreground"
                >
                  {label ?? ""}
                </div>
              ))}
            </div>

            {/* Day rows + grid */}
            <div
              className="grid gap-1"
              style={{
                gridTemplateColumns: `1.5rem repeat(${grid.length}, 0.75rem)`,
                gridTemplateRows: `repeat(${ROWS}, 0.75rem)`,
                gridAutoFlow: "column",
              }}
            >
              {/* Weekday labels (left column) */}
              {WEEKDAY_LABELS.map((label, row) => (
                <div
                  key={label}
                  className="pr-1 text-right text-[10px] leading-none text-muted-foreground"
                  style={{ gridColumn: 1, gridRow: row + 1 }}
                >
                  {row % 2 === 0 ? label : ""}
                </div>
              ))}

              {grid.map((col, colIdx) => {
                const weekKey = isoDate(col.weekStart);
                return col.days.map((cell, row) => {
                  const colorClass = cell.isoDay ? colorFor(cell.count) : "bg-transparent";
                  const titleStr = cell.isoDay
                    ? `${formatDateLong(cell.isoDay)} : ${cell.count} review${cell.count > 1 ? "s" : ""}`
                    : undefined;
                  // `cell.isoDay` is unique across the whole grid. For
                  // padding cells we fall back to `<weekStart>-pad-<row>`,
                  // which is also globally unique because weekStart is
                  // unique per column.
                  const key = cell.isoDay ?? `${weekKey}-pad-${row}`;
                  return (
                    <div
                      key={key}
                      title={titleStr}
                      className={cn(
                        "h-3 w-3 rounded-sm",
                        colorClass,
                        cell.isoDay && "ring-1 ring-inset ring-border/30",
                      )}
                      style={{ gridColumn: colIdx + 2, gridRow: row + 1 }}
                      data-testid={cell.isoDay ? "heatmap-cell" : undefined}
                      data-iso={cell.isoDay ?? undefined}
                      data-count={cell.isoDay ? cell.count : undefined}
                    />
                  );
                });
              })}
            </div>

            {/* Legend */}
            <div className="mt-2 flex items-center justify-end gap-2 text-[10px] text-muted-foreground">
              <span>Moins</span>
              <span className="h-3 w-3 rounded-sm bg-muted ring-1 ring-inset ring-border/30" />
              <span className="h-3 w-3 rounded-sm bg-green-200 dark:bg-green-900" />
              <span className="h-3 w-3 rounded-sm bg-green-400 dark:bg-green-700" />
              <span className="h-3 w-3 rounded-sm bg-green-600 dark:bg-green-500" />
              <span className="h-3 w-3 rounded-sm bg-green-800 dark:bg-green-300" />
              <span>Plus</span>
            </div>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
