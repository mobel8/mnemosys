/**
 * GitHub-style contribution heatmap covering the last 365 days.
 *
 * The grid is a single CSS-grid with 7 rows (one per weekday, Monday at the
 * top) and as many columns as weeks fit in the trailing year. The first
 * column is the partial week containing the start date and the last column
 * is the week containing today.
 *
 * Color buckets (graded `--success` token so the scale stays theme-aware and
 * on-brand — opacity steps stand in for the old raw Tailwind green ramp):
 *   - 0     reviews → `bg-muted`
 *   - 1-10           → `bg-success/25`
 *   - 11-50          → `bg-success/50`
 *   - 51-100         → `bg-success/75`
 *   - 100+           → `bg-success`
 *
 * Accessibility: the grid carries a `role="group"` `aria-label` summarising
 * the year so screen readers don't have to crawl 365 cells. Day cells follow
 * the ARIA grid roving-tabindex pattern: exactly **one** cell sits in the tab
 * order (today by default) and the arrow keys move focus day-to-day — ↑/↓ one
 * day, ←/→ one week (columns are weeks), Home/End first/last day — instead of
 * exposing 365 tab stops. Each cell exposes its date and count via
 * `aria-label` (not the unread native `title`), and the legend spells out
 * each bucket in text so colour is never the sole signal. The container
 * scrolls horizontally on narrow viewports.
 */

import { CalendarDays } from "lucide-react";
import { useMemo, useRef, useState } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { formatDateLong, isoDate } from "@/lib/date";
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
 * A `Date` pinned to 00:00:00 UTC of the given UTC calendar day. Iterating
 * with `setUTCDate(+1)` keeps every cursor aligned to a UTC midnight so
 * `isoDate` (a UTC slice) yields a `YYYY-MM-DD` that matches the backend
 * aggregate, which buckets reviews by UTC day. Keying off local midnight
 * instead would shift counts onto the neighbouring cell for users away from
 * UTC.
 */
function utcMidnight(year: number, month: number, day: number): Date {
  return new Date(Date.UTC(year, month, day, 0, 0, 0, 0));
}

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

/**
 * Ordered colour buckets. Each entry pairs the Tailwind swatch class with a
 * French text label so colour is never the only carrier of meaning — the
 * label feeds both the legend and per-cell `aria-label`s.
 */
const BUCKETS = [
  { max: 0, className: "bg-muted", label: "aucune révision" },
  { max: 10, className: "bg-success/25", label: "1 à 10 révisions" },
  { max: 50, className: "bg-success/50", label: "11 à 50 révisions" },
  { max: 100, className: "bg-success/75", label: "51 à 100 révisions" },
  {
    max: Number.POSITIVE_INFINITY,
    className: "bg-success",
    label: "plus de 100 révisions",
  },
] as const;

/** Tailwind class for a given review count. */
function colorFor(count: number): string {
  const bucket = BUCKETS.find((b) => count <= b.max) ?? BUCKETS[BUCKETS.length - 1];
  return bucket?.className ?? "bg-muted";
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
 *
 * The whole grid is keyed and iterated in **UTC**. The stats backend buckets
 * reviews by UTC day, so anchoring the cursor to local midnight (and then
 * keying with `isoDate`, which slices the UTC date) would shift counts onto
 * the neighbouring cell for any user away from UTC. Using UTC midnights end
 * to end keeps each cell's key identical to the backend aggregate.
 */
function buildGrid(counts: Map<string, number>): WeekColumn[] {
  const nowUtc = new Date();
  const today = utcMidnight(nowUtc.getUTCFullYear(), nowUtc.getUTCMonth(), nowUtc.getUTCDate());

  const start = utcMidnight(
    today.getUTCFullYear(),
    today.getUTCMonth(),
    today.getUTCDate() - (TOTAL_DAYS - 1),
  );

  // Shift the start back to the previous Monday so the first column begins
  // on a Monday. `getUTCDay()` returns 0 for Sunday, 1 for Monday, …, 6 for
  // Saturday — normalise to Monday-first (Mon=0..Sun=6).
  const startWeekdayMonFirst = (start.getUTCDay() + 6) % 7;
  const gridStart = new Date(start);
  gridStart.setUTCDate(gridStart.getUTCDate() - startWeekdayMonFirst);

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
      cursor.setUTCDate(cursor.getUTCDate() + 1);
    }
    columns.push({ weekStart, days });
  }

  return columns;
}

/**
 * ISO day shifted by `delta` days, computed in UTC so the result keeps
 * matching the grid's UTC-keyed cells.
 */
function shiftIsoDay(iso: string, delta: number): string {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + delta);
  return isoDate(d);
}

/**
 * For each column, return the month label that should appear above it.
 * We label only the first column of every month so the row stays sparse.
 */
function monthLabels(columns: WeekColumn[]): (string | null)[] {
  let lastMonth = -1;
  return columns.map((col) => {
    // Read months in UTC to stay consistent with the UTC-keyed grid.
    const month = col.weekStart.getUTCMonth();
    if (month !== lastMonth) {
      lastMonth = month;
      // Pull a representative day inside the column (first non-pad) so the
      // label aligns with the actual month rather than the padded Monday.
      const sample = col.days.find((d) => d.date) ?? col.days[0];
      if (sample?.date) {
        return MONTH_LABELS[sample.date.getUTCMonth()] ?? null;
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

  // Roving tabindex (ARIA grid pattern): exactly one cell is tabbable and the
  // arrow keys move focus between days — instead of 365 individual tab stops.
  const dayIndex = useMemo(() => {
    const isos: string[] = [];
    for (const col of grid) {
      for (const day of col.days) {
        if (day.isoDay) isos.push(day.isoDay);
      }
    }
    return {
      set: new Set(isos),
      first: isos[0] ?? null,
      last: isos[isos.length - 1] ?? null,
    };
  }, [grid]);

  const gridRef = useRef<HTMLDivElement>(null);
  const [focusedIso, setFocusedIso] = useState<string | null>(null);
  // Default tab stop = today (the last cell). If the grid rebuilt and the
  // previously focused day fell out of range (midnight rollover), fall back.
  const activeIso = focusedIso && dayIndex.set.has(focusedIso) ? focusedIso : dayIndex.last;

  function moveFocus(next: string | null) {
    if (!next || !dayIndex.set.has(next)) return;
    setFocusedIso(next);
    gridRef.current?.querySelector<HTMLButtonElement>(`[data-iso="${next}"]`)?.focus();
  }

  function handleGridKeyDown(event: React.KeyboardEvent<HTMLDivElement>) {
    if (!activeIso) return;
    // The grid is column-major (one column per week, Monday at the top), so
    // ←/→ jump a whole week (±7 days) and ↑/↓ step a single day. Stepping
    // past a column edge simply continues chronologically into the next one.
    let next: string | null;
    switch (event.key) {
      case "ArrowRight":
        next = shiftIsoDay(activeIso, 7);
        break;
      case "ArrowLeft":
        next = shiftIsoDay(activeIso, -7);
        break;
      case "ArrowDown":
        next = shiftIsoDay(activeIso, 1);
        break;
      case "ArrowUp":
        next = shiftIsoDay(activeIso, -1);
        break;
      case "Home":
        next = dayIndex.first;
        break;
      case "End":
        next = dayIndex.last;
        break;
      default:
        return;
    }
    // Swallow the key (no page scroll) even when the move clamps at an edge.
    event.preventDefault();
    moveFocus(next);
  }

  return (
    <Card className={cn(error && "border-destructive/40")}>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <CalendarDays className="h-5 w-5 text-brand-500" />
          Activité sur 365 jours
        </CardTitle>
        <CardDescription
          className={cn(error && "text-destructive")}
          role={error ? "alert" : undefined}
          aria-live={error ? "assertive" : undefined}
        >
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
            {/* biome-ignore lint/a11y/useSemanticElements: grille heatmap — aucun élément sémantique adapté (<fieldset> inapproprié pour une grille de cases focusables) */}
            <div
              ref={gridRef}
              role="group"
              aria-label={`Carte d'activité des révisions sur les 365 derniers jours : ${totalReviews} révision(s) au total. Chaque case est un jour ; utilise les flèches pour passer d'un jour à l'autre et entendre la date et le nombre de révisions.`}
              onKeyDown={handleGridKeyDown}
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
                  // `cell.isoDay` is unique across the whole grid. For
                  // padding cells we fall back to `<weekStart>-pad-<row>`,
                  // which is also globally unique because weekStart is
                  // unique per column.
                  const key = cell.isoDay ?? `${weekKey}-pad-${row}`;
                  // Padding slots carry no information — keep them out of the
                  // accessibility tree and the tab order entirely.
                  if (!cell.isoDay) {
                    return (
                      <div
                        key={key}
                        aria-hidden="true"
                        className="h-3 w-3 rounded-sm bg-transparent"
                        style={{ gridColumn: colIdx + 2, gridRow: row + 1 }}
                      />
                    );
                  }
                  const label = `${formatDateLong(cell.isoDay)} : ${cell.count} révision${
                    cell.count > 1 ? "s" : ""
                  }`;
                  return (
                    <button
                      type="button"
                      key={key}
                      aria-label={label}
                      // Roving tabindex: only the active day is tabbable.
                      tabIndex={cell.isoDay === activeIso ? 0 : -1}
                      // Keep the roving state in sync however focus arrives
                      // (mouse click, programmatic move, Tab into the grid).
                      onFocus={() => setFocusedIso(cell.isoDay)}
                      className={cn(
                        "h-3 w-3 rounded-sm ring-1 ring-inset ring-border/30",
                        "focus:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                        colorFor(cell.count),
                      )}
                      style={{ gridColumn: colIdx + 2, gridRow: row + 1 }}
                      data-testid="heatmap-cell"
                      data-iso={cell.isoDay}
                      data-count={cell.count}
                    />
                  );
                });
              })}
            </div>

            {/* Legend — each swatch is paired with its text label so the
                meaning of a colour is also available without seeing it. */}
            <ul className="mt-2 flex flex-wrap items-center justify-end gap-x-3 gap-y-1 text-[10px] text-muted-foreground">
              <li aria-hidden="true">Moins</li>
              {BUCKETS.map((bucket) => (
                <li key={bucket.label} className="flex items-center gap-1">
                  <span
                    aria-hidden="true"
                    className={cn(
                      "h-3 w-3 rounded-sm ring-1 ring-inset ring-border/30",
                      bucket.className,
                    )}
                  />
                  <span>{bucket.label}</span>
                </li>
              ))}
              <li aria-hidden="true">Plus</li>
            </ul>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
