/**
 * Stats hub page — extracted from `src/routes/stats.tsx` for code-splitting
 * via `lazyRouteComponent`. Pulls in `recharts`, which is heavy (~200 KB),
 * so isolating it in its own chunk keeps the initial bundle small.
 *
 * v0.11 restructure: the standalone `/achievements` and `/graph` routes are
 * gone; this page absorbs them as tabs. Four tabs:
 *   - « Vue d'ensemble » — today's KPIs, year heatmap, per-day reviews +
 *     retention charts, BKT concept mastery, mastery timeline.
 *   - « Calibration »    — metacognitive calibration dashboard (CBM).
 *   - « Succès »         — achievements grid + gamification KPIs.
 *   - « Graphe »         — tag co-occurrence graph with a deck scope picker.
 *
 * Radix Tabs mounts only the active panel, so each tab's queries fire on
 * first activation — inactive tabs cost nothing. Inside « Vue d'ensemble »
 * the heavy below-the-fold panels stay gated behind `DeferredPanel`
 * (IntersectionObserver) so they never compete with the visible KPI row.
 *
 * Period selection lives in page-level state (default 30 days) and renders
 * next to the tab list only while « Vue d'ensemble » is active — it's the
 * only tab it applies to. `Period = "7d" | "30d" | "90d" | "365d"`; both
 * per-day charts re-query through TanStack Query whenever it changes.
 *
 * Empty-state policy: when the user has zero reviews ever, we still render
 * the KPI tiles (all zeros) and the empty heatmap. The two day-by-day
 * charts switch to a soft empty message + a CTA back to the deck list so
 * the user always has somewhere to go.
 */

import { Link } from "@tanstack/react-router";
import { BarChart3, Brain, Network, Trophy } from "lucide-react";
import { type ReactNode, useEffect, useMemo, useRef, useState } from "react";
import { Achievements } from "@/components/Achievements";
import { CalibrationDashboard } from "@/components/CalibrationDashboard";
import { KnowledgeGraph } from "@/components/KnowledgeGraph";
import { ConceptMastery } from "@/components/stats/ConceptMastery";
import { MasteryTimeline } from "@/components/stats/MasteryTimeline";
import { PeriodSelector } from "@/components/stats/PeriodSelector";
import { RetentionChart } from "@/components/stats/RetentionChart";
import { ReviewsByDayChart } from "@/components/stats/ReviewsByDayChart";
import { ReviewsHeatmap } from "@/components/stats/ReviewsHeatmap";
import { TodayCard } from "@/components/stats/TodayCard";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import type { Period } from "@/lib/date";
import {
  useAchievements,
  useDecks,
  useReviewsByDay,
  useTagGraph,
  useTodayStats,
  useUserStats,
} from "@/lib/queries";

type StatsTab = "overview" | "calibration" | "achievements" | "graph";

export default function StatsPage() {
  const [tab, setTab] = useState<StatsTab>("overview");
  const [period, setPeriod] = useState<Period>("30d");

  return (
    <div className="space-y-6 p-6">
      <header>
        <h1 className="font-display text-2xl font-semibold tracking-tight">Statistiques</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Activité, calibration, succès et graphe de connaissances.
        </p>
      </header>

      <Tabs value={tab} onValueChange={(value) => setTab(value as StatsTab)}>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <TabsList>
            <TabsTrigger value="overview" className="gap-1.5">
              <BarChart3 className="h-4 w-4" aria-hidden />
              Vue d'ensemble
            </TabsTrigger>
            <TabsTrigger value="calibration" className="gap-1.5">
              <Brain className="h-4 w-4" aria-hidden />
              Calibration
            </TabsTrigger>
            <TabsTrigger value="achievements" className="gap-1.5">
              <Trophy className="h-4 w-4" aria-hidden />
              Succès
            </TabsTrigger>
            <TabsTrigger value="graph" className="gap-1.5">
              <Network className="h-4 w-4" aria-hidden />
              Graphe
            </TabsTrigger>
          </TabsList>
          {/* The period only drives the overview charts — hide it elsewhere. */}
          {tab === "overview" && <PeriodSelector value={period} onChange={setPeriod} />}
        </div>

        <TabsContent value="overview" className="mt-6">
          <OverviewTab period={period} />
        </TabsContent>

        {/*
          Radix mounts this panel on first activation only, so the calibration
          full-history scan (serialised behind the DB Mutex) never runs while
          the user is looking at another tab — same effect as a DeferredPanel.
        */}
        <TabsContent value="calibration" className="mt-6">
          <CalibrationDashboard />
        </TabsContent>

        <TabsContent value="achievements" className="mt-6">
          <AchievementsTab />
        </TabsContent>

        <TabsContent value="graph" className="mt-6">
          <GraphTab />
        </TabsContent>
      </Tabs>
    </div>
  );
}

/**
 * « Vue d'ensemble » — the original stats dashboard minus calibration (now
 * its own tab). Hooks live here rather than in the page so the queries only
 * run while the tab is mounted.
 */
function OverviewTab({ period }: { period: Period }) {
  const today = useTodayStats();

  // Used purely to detect the "never reviewed anything" state so we can
  // render an onboarding CTA at the bottom of the tab. We piggy-back on
  // the 365d query that the heatmap is already firing, so this doesn't add
  // extra IPC traffic thanks to TanStack Query deduplication.
  const yearReviews = useReviewsByDay(365);
  const totalReviews = yearReviews.data?.reduce((sum, row) => sum + row.count, 0) ?? 0;
  const hasNoData =
    !yearReviews.isLoading && totalReviews === 0 && (today.data?.reviews_done_today ?? 0) === 0;

  return (
    <div className="space-y-6">
      <TodayCard data={today.data} isLoading={today.isLoading} />

      <ReviewsHeatmap />

      <div className="grid gap-6 lg:grid-cols-2">
        <ReviewsByDayChart period={period} />
        <RetentionChart period={period} />
      </div>

      {/*
        P061 — these panels each trigger a full-history scan behind the single
        DB Mutex (BKT concept mastery, weekly retention pivot). Firing them on
        mount serialises behind the KPI/heatmap queries that are actually
        visible. We gate each one behind an IntersectionObserver so its query
        only runs once the panel is about to scroll into view, keeping the
        above-the-fold data responsive.
      */}
      <DeferredPanel minHeight={280}>
        <ConceptMastery />
      </DeferredPanel>

      <DeferredPanel minHeight={360}>
        <MasteryTimeline />
      </DeferredPanel>

      {hasNoData && <NoDataCallout />}
    </div>
  );
}

/**
 * « Succès » — content of the former `/achievements` route: the badge grid
 * plus the gamification KPI footer (badges, streaks, accuracy).
 */
function AchievementsTab() {
  const stats = useUserStats();
  const unlocked = useAchievements();

  const totalUnlocked = unlocked.data?.length ?? 0;
  const accuracy =
    stats.data && stats.data.total_reviews > 0
      ? Math.round((stats.data.total_correct / stats.data.total_reviews) * 100)
      : null;

  return (
    <div className="space-y-6">
      <p className="max-w-prose text-sm text-muted-foreground">
        Chaque badge se débloque une fois et reste acquis — aucune pénalité, aucun classement.
      </p>

      <Achievements />

      <Card>
        <CardContent className="grid grid-cols-2 gap-3 p-4 sm:grid-cols-4">
          <KpiTile label="Badges" value={String(totalUnlocked)} />
          <KpiTile label="Streak actuel" value={String(stats.data?.streak_current ?? 0)} />
          <KpiTile label="Meilleur streak" value={String(stats.data?.streak_best ?? 0)} />
          <KpiTile label="Réussite" value={accuracy !== null ? `${accuracy}%` : "—"} />
        </CardContent>
      </Card>
    </div>
  );
}

function KpiTile({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border bg-muted/40 p-3">
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className="mt-1 font-mono text-xl font-semibold tabular-nums">{value}</div>
    </div>
  );
}

const ALL_DECKS = "all";

/**
 * « Graphe » — content of the former `/graph` route: deck scope selector +
 * loading / error handling around the reusable `<KnowledgeGraph>`. The scope
 * lives in local state ("all decks" = `null`); switching re-queries through
 * TanStack Query (`useTagGraph`), which caches per deck.
 */
function GraphTab() {
  const decksQuery = useDecks();
  const decks = useMemo(() => decksQuery.data ?? [], [decksQuery.data]);

  // null = "all decks".
  const [deckId, setDeckId] = useState<number | null>(null);
  const graphQuery = useTagGraph(deckId);

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <p className="max-w-prose text-sm text-muted-foreground">
          Les liens entre tes cartes via leurs tags partagés. Survole un tag pour mettre en évidence
          ses connexions.
        </p>
        <div className="space-y-1.5">
          <Label htmlFor="graph-deck" className="text-xs">
            Portée
          </Label>
          <Select
            value={deckId === null ? ALL_DECKS : String(deckId)}
            onValueChange={(value) => setDeckId(value === ALL_DECKS ? null : Number(value))}
          >
            <SelectTrigger id="graph-deck" className="sm:w-56">
              <SelectValue placeholder="Tous les decks" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={ALL_DECKS}>Tous les decks</SelectItem>
              {decks.map((deck) => (
                <SelectItem key={deck.id} value={String(deck.id)}>
                  {deck.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>

      {graphQuery.isLoading ? (
        <Card>
          <CardContent className="space-y-4 p-6">
            <div className="h-[372px] animate-pulse rounded-lg bg-muted" />
            <div className="flex flex-wrap gap-2">
              {Array.from({ length: 5 }).map((_, i) => (
                // biome-ignore lint/suspicious/noArrayIndexKey: skeleton placeholders, order is stable
                <div key={i} className="h-6 w-20 animate-pulse rounded-full bg-muted" />
              ))}
            </div>
          </CardContent>
        </Card>
      ) : graphQuery.isError ? (
        <Card className="border-destructive/40">
          <CardContent className="flex h-[420px] items-center justify-center text-center">
            <p className="text-sm text-muted-foreground">
              Impossible de charger le graphe :{" "}
              {graphQuery.error instanceof Error ? graphQuery.error.message : "erreur inconnue"}.
            </p>
          </CardContent>
        </Card>
      ) : (
        <KnowledgeGraph graph={graphQuery.data ?? { nodes: [], edges: [] }} />
      )}
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
