/**
 * Streak widget — flame icon + counter rendered in the top bar.
 *
 * White Hat design: never punitive. Tap the chip to open a modal that
 * exposes the *positive* aspects (current streak, best, total reviews,
 * accuracy, 30-day mini-heatmap) and a single explicit action — burning a
 * monthly freeze to rescue yesterday's miss.
 *
 * Visual rules:
 * - `streak_current === 0` → grey flame, "—" label.
 * - `streak_current < 7`   → muted-orange flame.
 * - `streak_current >= 7`  → full orange flame with a subtle pulse.
 *
 * The 30-day strip is derived locally from `useReviewsByDay(30)`. Days with
 * `count > 0` glow green; days marked as a freeze (today's `last_review_date`
 * coincides AND `freeze_remaining` dropped today vs prev) blue; otherwise
 * grey. Computing the freeze annotation precisely requires server-side
 * history, so we approximate by lighting up `last_review_date` blue when no
 * review was logged that day.
 */

import { Flame, Snowflake, Trophy } from "lucide-react";
import { useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { toast } from "@/components/ui/use-toast";
import { useReviewsByDay, useStreakFreeze, useUserStats } from "@/lib/queries";
import { cn } from "@/lib/utils";

const STREAK_HOT_THRESHOLD = 7;

export function StreakWidget() {
  const userStats = useUserStats();
  const [open, setOpen] = useState(false);
  const reviewsByDay = useReviewsByDay(30, { enabled: open });
  const freeze = useStreakFreeze({
    onSuccess: () => {
      toast({
        title: "Freeze utilisé",
        description: "Ton streak est sauvé pour aujourd'hui.",
      });
    },
    onError: (err) => {
      toast({
        title: "Impossible d'utiliser un freeze",
        description: err.message,
        variant: "destructive",
      });
    },
  });

  const stats = userStats.data;
  const current = stats?.streak_current ?? 0;
  const hot = current >= STREAK_HOT_THRESHOLD;

  // Eligibility for the "save my streak" button: at least one freeze
  // remaining AND user missed yesterday (`last_review_date` is older than
  // yesterday). Same-day reviews don't need rescuing.
  const canFreeze = useMemo(() => {
    if (!stats) return false;
    if (stats.freeze_remaining <= 0) return false;
    if (!stats.last_review_date) return false;
    const todayIso = new Date().toISOString().slice(0, 10);
    const yesterdayIso = new Date(Date.now() - 24 * 3_600_000).toISOString().slice(0, 10);
    return stats.last_review_date !== todayIso && stats.last_review_date !== yesterdayIso;
  }, [stats]);

  const accuracy =
    stats && stats.total_reviews > 0
      ? Math.round((stats.total_correct / stats.total_reviews) * 100)
      : null;

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button
          variant="ghost"
          size="sm"
          className="gap-1.5 px-2"
          aria-label={`Streak ${current} jours`}
          title={
            stats
              ? `Streak ${current} jours • Meilleur ${stats.streak_best} • ${stats.freeze_remaining} freeze restants ce mois`
              : "Streak"
          }
        >
          <Flame
            className={cn(
              "h-4 w-4 transition-colors",
              current === 0 && "text-muted-foreground",
              current > 0 && current < STREAK_HOT_THRESHOLD && "text-orange-400",
              hot && "text-orange-500 drop-shadow-[0_0_4px_rgba(249,115,22,0.6)]",
            )}
            aria-hidden
          />
          <span className="font-mono text-sm font-medium tabular-nums">
            {current === 0 ? "—" : current}
          </span>
        </Button>
      </DialogTrigger>

      <DialogContent>
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Flame className="h-5 w-5 text-orange-500" aria-hidden />
            Ton streak
          </DialogTitle>
          <DialogDescription>
            Une carte par jour suffit. Pas de pression — juste un repère pour entretenir l'habitude.
          </DialogDescription>
        </DialogHeader>

        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <StatTile label="Actuel" value={String(current)} icon={<Flame className="h-4 w-4" />} />
          <StatTile
            label="Meilleur"
            value={String(stats?.streak_best ?? 0)}
            icon={<Trophy className="h-4 w-4" />}
          />
          <StatTile label="Reviews" value={String(stats?.total_reviews ?? 0)} />
          <StatTile label="Réussite" value={accuracy !== null ? `${accuracy}%` : "—"} />
        </div>

        <section aria-label="Activité des 30 derniers jours" className="space-y-2">
          <h3 className="text-sm font-medium text-muted-foreground">30 derniers jours</h3>
          <HeatStrip data={reviewsByDay.data} lastReviewDate={stats?.last_review_date ?? null} />
        </section>

        <div className="flex items-center justify-between gap-3 rounded-md border border-dashed bg-muted/40 p-3 text-sm">
          <div className="flex items-center gap-2">
            <Snowflake className="h-4 w-4 text-sky-500" aria-hidden />
            <span>
              <strong className="font-medium">{stats?.freeze_remaining ?? 0}</strong> freeze
              {(stats?.freeze_remaining ?? 0) > 1 ? "s" : ""} ce mois
            </span>
          </div>
          <Button
            size="sm"
            variant="secondary"
            disabled={!canFreeze || freeze.isPending}
            onClick={() => freeze.mutate()}
          >
            {freeze.isPending ? "…" : "Sauver mon streak"}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

interface StatTileProps {
  label: string;
  value: string;
  icon?: React.ReactNode;
}

function StatTile({ label, value, icon }: StatTileProps) {
  return (
    <div className="rounded-md border bg-card/50 p-3">
      <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
        {icon}
        {label}
      </div>
      <div className="mt-1 font-mono text-xl font-semibold tabular-nums">{value}</div>
    </div>
  );
}

interface HeatStripProps {
  data: Array<{ date: string; count: number }> | undefined;
  lastReviewDate: string | null;
}

/**
 * 30-cell strip. Each cell represents one calendar day. Colour rules:
 * - count > 0 → green (review happened)
 * - count == 0 AND date == last_review_date → blue (freeze "saved" the day)
 * - otherwise → grey
 *
 * The data array comes from `useReviewsByDay(30)` which already covers a
 * trailing 30-day window (most-recent last).
 */
function HeatStrip({ data, lastReviewDate }: HeatStripProps) {
  if (!data) {
    return <div className="h-7 animate-pulse rounded-md bg-muted/60" aria-hidden />;
  }
  return (
    <div className="grid grid-cols-15 gap-1 sm:grid-cols-30">
      {data.map((row) => {
        const reviewed = row.count > 0;
        const frozen = !reviewed && lastReviewDate === row.date;
        return (
          <div
            key={row.date}
            role="img"
            title={`${row.date} — ${row.count} reviews`}
            className={cn(
              "h-3 w-full rounded-sm sm:h-4",
              reviewed && "bg-emerald-500/80",
              frozen && "bg-sky-400/70",
              !reviewed && !frozen && "bg-muted/70",
            )}
            aria-label={`${row.date}: ${row.count} reviews`}
          />
        );
      })}
    </div>
  );
}
