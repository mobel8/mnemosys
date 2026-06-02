/**
 * Wellness history strip (Vague 3 — neuro modes, opt-in).
 *
 * Replays the last `DAYS` daily check-ins logged by `<MoodCheckIn>` (mood,
 * sleep hours, stress). The data is purely descriptive — we never diagnose or
 * prescribe — so the panel just surfaces what the learner reported, newest
 * first, with the same mood emoji vocabulary as the check-in dialog.
 *
 * Empty-state policy: when nothing was ever logged we show an invitation to
 * enable the neuro modes (the check-in is opt-in via settings), rather than a
 * bare "no data" line.
 */

import { HeartPulse, Moon } from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { useRecentWellness } from "@/lib/queries";
import type { WellnessLog } from "@/lib/tauri";
import { cn } from "@/lib/utils";

/** How many recent check-ins to surface. */
const DAYS = 14;

/** Mood `[1..5]` → emoji, mirroring `MOOD_OPTIONS` in `<MoodCheckIn>`. */
const MOOD_EMOJI: Record<number, string> = {
  1: "😞",
  2: "😟",
  3: "😐",
  4: "🙂",
  5: "😄",
};

/** Stress `[1..5]` → label + dot colour (higher = redder), via semantic tokens. */
function stressTone(level: number): { label: string; dot: string } {
  if (level >= 4) return { label: "Élevé", dot: "bg-destructive" };
  if (level === 3) return { label: "Moyen", dot: "bg-warning" };
  return { label: "Bas", dot: "bg-success" };
}

/** Render an ISO `YYYY-MM-DD` as a short localized date; raw string on garbage. */
function formatDay(iso: string): string {
  const date = new Date(`${iso}T00:00:00`);
  if (Number.isNaN(date.getTime())) return iso;
  return new Intl.DateTimeFormat(undefined, {
    weekday: "short",
    day: "numeric",
    month: "short",
  }).format(date);
}

function MoodCell({ mood }: { mood: number | null }) {
  if (mood == null) return <span className="text-muted-foreground">—</span>;
  // The emoji *is* the meaning here, so expose it as an image with a label.
  return (
    <span role="img" title={`Humeur ${mood}/5`} aria-label={`Humeur ${mood} sur 5`}>
      {MOOD_EMOJI[mood] ?? "•"}
    </span>
  );
}

function SleepCell({ hours }: { hours: number | null }) {
  if (hours == null) return <span className="text-muted-foreground">—</span>;
  return (
    <span className="inline-flex items-center gap-1 tabular-nums">
      <Moon className="h-3.5 w-3.5 text-muted-foreground" />
      {hours} h
    </span>
  );
}

function StressCell({ level }: { level: number | null }) {
  if (level == null) return <span className="text-muted-foreground">—</span>;
  const tone = stressTone(level);
  return (
    <span className="inline-flex items-center gap-1.5">
      <span className={cn("h-2 w-2 rounded-full", tone.dot)} aria-hidden />
      {tone.label}
    </span>
  );
}

export function WellnessHistory() {
  const { data: logs, isLoading } = useRecentWellness(DAYS);

  if (isLoading) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <HeartPulse className="h-5 w-5 text-brand-500" />
            Bien-être
          </CardTitle>
          <CardDescription>
            <span className="sr-only">Chargement…</span>
            <span className="inline-block h-4 w-72 max-w-full animate-pulse rounded bg-muted align-middle" />
          </CardDescription>
        </CardHeader>
        <CardContent>
          <ul className="divide-y divide-border/60">
            {[0, 1, 2, 3].map((i) => (
              <li key={i} className="grid grid-cols-[1fr_auto_auto_auto] items-center gap-3 py-2.5">
                <span className="h-4 w-28 animate-pulse rounded bg-muted" />
                <span className="h-4 w-5 animate-pulse rounded bg-muted" />
                <span className="h-4 w-12 animate-pulse rounded bg-muted" />
                <span className="h-4 w-16 animate-pulse rounded bg-muted" />
              </li>
            ))}
          </ul>
        </CardContent>
      </Card>
    );
  }

  if (!logs || logs.length === 0) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <HeartPulse className="h-5 w-5 text-brand-500" />
            Bien-être
          </CardTitle>
          <CardDescription>
            Suivi opt-in de ton humeur, de ton sommeil et de ton stress (modes « neuro »).
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="flex flex-col items-center gap-4 py-10 text-center">
            <span className="flex h-14 w-14 items-center justify-center rounded-2xl bg-brand-50 text-brand-500">
              <HeartPulse className="h-7 w-7" />
            </span>
            <div className="space-y-1.5">
              <h3 className="font-display text-base font-semibold tracking-tight">
                Aucun check-in pour l'instant
              </h3>
              <p className="mx-auto max-w-sm text-sm text-muted-foreground">
                Active les modes « neuro » dans les réglages pour enregistrer ton humeur, ton
                sommeil et ton stress avant chaque session.
              </p>
            </div>
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <HeartPulse className="h-5 w-5 text-brand-500" />
          Bien-être
        </CardTitle>
        <CardDescription>
          Tes {logs.length} dernier{logs.length > 1 ? "s" : ""} check-in
          {logs.length > 1 ? "s" : ""} (humeur, sommeil, stress), du plus récent au plus ancien.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <ul className="divide-y divide-border/60">
          {logs.map((log: WellnessLog) => (
            <li
              key={log.id}
              className="grid grid-cols-[1fr_auto_auto_auto] items-center gap-3 py-2 text-sm"
              data-testid="wellness-row"
            >
              <span className="font-medium text-foreground">{formatDay(log.date)}</span>
              <span className="text-lg leading-none">
                <MoodCell mood={log.mood} />
              </span>
              <span className="w-16 text-right text-xs text-muted-foreground">
                <SleepCell hours={log.sleep_hours} />
              </span>
              <span className="w-20 text-right text-xs text-muted-foreground">
                <StressCell level={log.stress_level} />
              </span>
            </li>
          ))}
        </ul>
      </CardContent>
    </Card>
  );
}
