/**
 * Stats dashboard page component — extracted from `src/routes/stats.tsx` for
 * code-splitting via `lazyRouteComponent`. Pulls in `recharts`, which is
 * heavy (~200 KB), so isolating it in its own chunk keeps the initial
 * bundle small.
 *
 * Orchestrates the period selector, today's KPIs, the year-long activity
 * heatmap, and the per-day reviews + retention charts. Each visual is its
 * own component under `src/components/stats/`; this file is intentionally
 * thin and just wires data + layout.
 *
 * Period selection lives in local state (default 30 days). The selector
 * tracks `Period = "7d" | "30d" | "90d" | "365d"` and both per-day charts
 * re-query through TanStack Query whenever it changes.
 *
 * Empty-state policy: when the user has zero reviews ever, we still render
 * the KPI tiles (all zeros) and the empty heatmap. The two day-by-day
 * charts switch to a soft empty message + a CTA back to the deck list so
 * the user always has somewhere to go.
 */

import { Link } from "@tanstack/react-router";
import { BarChart3 } from "lucide-react";
import { type ReactNode, useEffect, useRef, useState } from "react";
import { CalibrationDashboard } from "@/components/CalibrationDashboard";
import { ConceptMastery } from "@/components/stats/ConceptMastery";
import { MasteryTimeline } from "@/components/stats/MasteryTimeline";
import { PeriodSelector } from "@/components/stats/PeriodSelector";
import { RetentionChart } from "@/components/stats/RetentionChart";
import { ReviewsByDayChart } from "@/components/stats/ReviewsByDayChart";
import { ReviewsHeatmap } from "@/components/stats/ReviewsHeatmap";
import { TodayCard } from "@/components/stats/TodayCard";
import { WellnessHistory } from "@/components/stats/WellnessHistory";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import type { Period } from "@/lib/date";
import { useReviewsByDay, useTodayStats } from "@/lib/queries";

export default function StatsPage() {
  const [period, setPeriod] = useState<Period>("30d");
  const today = useTodayStats();

  // Used purely to detect the "never reviewed anything" state so we can
  // render an onboarding CTA at the bottom of the page. We piggy-back on
  // the 365d query that the heatmap is already firing, so this doesn't add
  // extra IPC traffic thanks to TanStack Query deduplication.
  const yearReviews = useReviewsByDay(365);
  const totalReviews = yearReviews.data?.reduce((sum, row) => sum + row.count, 0) ?? 0;
  const hasNoData =
    !yearReviews.isLoading && totalReviews === 0 && (today.data?.reviews_done_today ?? 0) === 0;

  return (
    <div className="space-y-6 p-6">
      <header className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h1 className="font-display text-2xl font-semibold tracking-tight">Statistiques</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Vue d'ensemble de ton activité et de tes performances de mémorisation.
          </p>
        </div>
        <PeriodSelector value={period} onChange={setPeriod} />
      </header>

      <TodayCard data={today.data} isLoading={today.isLoading} />

      <ReviewsHeatmap />

      <div className="grid gap-6 lg:grid-cols-2">
        <ReviewsByDayChart period={period} />
        <RetentionChart period={period} />
      </div>

      {/*
        P061 — these panels each trigger a full-history scan behind the single
        DB Mutex (calibration γ/bias, BKT concept mastery, weekly retention
        pivot, wellness log). Firing all of them on mount serialises behind the
        KPI/heatmap queries that are actually visible. We gate each one behind
        an IntersectionObserver so its query only runs once the panel is about
        to scroll into view, keeping the above-the-fold data responsive.
      */}
      <DeferredPanel minHeight={280}>
        <CalibrationDashboard />
      </DeferredPanel>

      <DeferredPanel minHeight={280}>
        <ConceptMastery />
      </DeferredPanel>

      <DeferredPanel minHeight={360}>
        <MasteryTimeline />
      </DeferredPanel>

      <DeferredPanel minHeight={280}>
        <WellnessHistory />
      </DeferredPanel>

      {hasNoData && <NoDataCallout />}
    </div>
  );
}

/**
 * Mounts `children` only once the placeholder scrolls within `rootMargin` of
 * the viewport, then keeps them mounted. Until then it reserves `minHeight` so
 * the scrollbar stays stable and the panel doesn't pop the layout when it
 * appears. This defers the heavy analytics queries each child fires (all
 * serialised behind the DB Mutex) so they never compete with the above-the-fold
 * KPI row + heatmap. If `IntersectionObserver` is unavailable, we render the
 * children eagerly rather than hiding content.
 */
function DeferredPanel({ children, minHeight }: { children: ReactNode; minHeight: number }) {
  const ref = useRef<HTMLDivElement>(null);
  const [visible, setVisible] = useState(() => typeof IntersectionObserver === "undefined");

  useEffect(() => {
    if (visible) return;
    const node = ref.current;
    if (!node) return;

    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) {
          setVisible(true);
          observer.disconnect();
        }
      },
      // Start loading a little before the panel enters the viewport so the
      // data is usually ready by the time the user scrolls to it.
      { rootMargin: "200px 0px" },
    );
    observer.observe(node);
    return () => observer.disconnect();
  }, [visible]);

  if (visible) return <>{children}</>;

  return (
    <div
      ref={ref}
      aria-hidden="true"
      style={{ minHeight }}
      className="animate-pulse rounded-xl border border-dashed bg-muted/30"
    />
  );
}

function NoDataCallout() {
  return (
    <Card className="border-dashed">
      <CardContent className="flex flex-col items-center gap-4 py-12 text-center">
        <span className="flex h-14 w-14 items-center justify-center rounded-2xl bg-brand-50 text-brand-500">
          <BarChart3 className="h-7 w-7" />
        </span>
        <div className="space-y-1.5">
          <h3 className="font-display text-lg font-semibold tracking-tight">
            Pas encore de statistiques
          </h3>
          <p className="mx-auto max-w-sm text-sm text-muted-foreground">
            Commence une session de révision pour voir ton activité et tes performances de
            mémorisation prendre vie.
          </p>
        </div>
        <Button asChild>
          <Link to="/">Voir les decks</Link>
        </Button>
      </CardContent>
    </Card>
  );
}
