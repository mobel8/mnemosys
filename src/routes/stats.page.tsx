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
import { useState } from "react";
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
          <h2 className="text-2xl font-semibold tracking-tight">Statistiques</h2>
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

      <CalibrationDashboard />

      <ConceptMastery />

      <MasteryTimeline />

      <WellnessHistory />

      {hasNoData && <NoDataCallout />}
    </div>
  );
}

function NoDataCallout() {
  return (
    <Card className="border-dashed">
      <CardContent className="flex flex-col items-center gap-3 py-8 text-center">
        <p className="text-sm text-muted-foreground">
          Pas encore assez de données. Commence une session de review pour voir tes statistiques
          prendre vie.
        </p>
        <Button asChild>
          <Link to="/">Voir les decks</Link>
        </Button>
      </CardContent>
    </Card>
  );
}
