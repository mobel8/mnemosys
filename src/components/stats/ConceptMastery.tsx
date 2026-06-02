/**
 * Concept-mastery dashboard (Vague 20).
 *
 * Renders a per-tag mastery bar driven by Bayesian Knowledge Tracing
 * (Corbett & Anderson 1995). Each concept maps to a note tag; the bar shows
 * the posterior P(mastered) after replaying every review of the cards
 * carrying that tag. Mirrors the visual language of `CalibrationDashboard`
 * so the stats page stays cohesive.
 */

import { GraduationCap } from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { useConceptMastery } from "@/lib/queries";
import { cn } from "@/lib/utils";

/** Map a mastery probability to a label + bar colour (semantic tokens). */
function masteryLevel(mastery: number): { label: string; bar: string; text: string } {
  if (mastery >= 0.85) return { label: "Maîtrisé", bar: "bg-success", text: "text-success" };
  if (mastery >= 0.6) return { label: "Solide", bar: "bg-chart-2", text: "text-chart-2" };
  if (mastery >= 0.4) return { label: "En cours", bar: "bg-warning", text: "text-warning" };
  return { label: "Fragile", bar: "bg-destructive", text: "text-destructive" };
}

export function ConceptMastery() {
  const { data: concepts, isLoading } = useConceptMastery();

  if (isLoading) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <GraduationCap className="h-5 w-5 text-brand-500" />
            Maîtrise par concept
          </CardTitle>
          <CardDescription>
            <span className="sr-only">Chargement…</span>
            <span className="inline-block h-4 w-64 max-w-full animate-pulse rounded bg-muted align-middle" />
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-2.5">
          {[0, 1, 2, 3].map((i) => (
            <div key={i} className="flex items-center gap-3">
              <span className="h-4 w-32 shrink-0 animate-pulse rounded bg-muted" />
              <span className="h-5 flex-1 animate-pulse rounded-lg bg-muted" />
              <span className="h-4 w-20 shrink-0 animate-pulse rounded bg-muted" />
            </div>
          ))}
        </CardContent>
      </Card>
    );
  }

  if (!concepts || concepts.length === 0) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <GraduationCap className="h-5 w-5 text-brand-500" />
            Maîtrise par concept
          </CardTitle>
          <CardDescription>
            Estimation bayésienne (BKT, Corbett &amp; Anderson 1995) de ta maîtrise par tag. Ajoute
            des tags à tes notes et révise pour voir tes concepts progresser.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="flex flex-col items-center gap-4 py-10 text-center">
            <span className="flex h-14 w-14 items-center justify-center rounded-2xl bg-brand-50 text-brand-500">
              <GraduationCap className="h-7 w-7" />
            </span>
            <div className="space-y-1.5">
              <h3 className="font-display text-base font-semibold tracking-tight">
                Aucun concept tagué révisé
              </h3>
              <p className="mx-auto max-w-sm text-sm text-muted-foreground">
                Ajoute des tags à tes notes puis révise-les : chaque concept apparaîtra ici avec sa
                probabilité de maîtrise.
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
          <GraduationCap className="h-5 w-5 text-brand-500" />
          Maîtrise par concept
        </CardTitle>
        <CardDescription>
          Probabilité de maîtrise par tag estimée par Bayesian Knowledge Tracing (Corbett &amp;
          Anderson 1995), sur {concepts.length} concept{concepts.length > 1 ? "s" : ""}.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-2.5">
        {concepts.map((c) => {
          const pct = Math.round(c.mastery * 100);
          const level = masteryLevel(c.mastery);
          return (
            <div key={c.tag} className="flex items-center gap-3 text-sm">
              <span className="w-32 shrink-0 truncate font-medium" title={c.tag}>
                {c.tag}
              </span>
              <div className="relative h-5 flex-1 overflow-hidden rounded-lg bg-muted">
                <div
                  className={cn(
                    "h-full rounded-lg transition-[width] duration-300 ease-out",
                    level.bar,
                  )}
                  style={{ width: `${pct}%` }}
                />
                <span className="absolute inset-y-0 right-2 flex items-center font-mono text-[11px] tabular-nums text-foreground/80">
                  {pct}%
                </span>
              </div>
              <span className={cn("w-20 shrink-0 text-right text-xs font-medium", level.text)}>
                {level.label}
              </span>
              <span className="w-14 shrink-0 text-right font-mono text-xs tabular-nums text-muted-foreground">
                {c.reviews} rev.
              </span>
            </div>
          );
        })}
      </CardContent>
    </Card>
  );
}
