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

/** Map a mastery probability to a label + bar colour. */
function masteryLevel(mastery: number): { label: string; bar: string; text: string } {
  if (mastery >= 0.85)
    return { label: "Maîtrisé", bar: "bg-emerald-500", text: "text-emerald-600" };
  if (mastery >= 0.6) return { label: "Solide", bar: "bg-lime-500", text: "text-lime-600" };
  if (mastery >= 0.4) return { label: "En cours", bar: "bg-amber-500", text: "text-amber-600" };
  return { label: "Fragile", bar: "bg-red-500", text: "text-red-500" };
}

export function ConceptMastery() {
  const { data: concepts, isLoading } = useConceptMastery();

  if (isLoading) {
    return (
      <Card>
        <CardContent className="py-8 text-center text-sm text-muted-foreground">
          Chargement…
        </CardContent>
      </Card>
    );
  }

  if (!concepts || concepts.length === 0) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <GraduationCap className="h-5 w-5" />
            Maîtrise par concept
          </CardTitle>
          <CardDescription>
            Estimation bayésienne (BKT, Corbett &amp; Anderson 1995) de ta maîtrise par tag. Ajoute
            des tags à tes notes et révise pour voir tes concepts progresser.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-muted-foreground">
            Aucun concept tagué révisé pour l'instant.
          </p>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <GraduationCap className="h-5 w-5" />
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
              <div className="relative h-5 flex-1 overflow-hidden rounded bg-muted">
                <div
                  className={cn("h-full rounded transition-all", level.bar)}
                  style={{ width: `${pct}%` }}
                />
                <span className="absolute inset-y-0 right-2 flex items-center font-mono text-[11px] text-foreground/80">
                  {pct}%
                </span>
              </div>
              <span className={cn("w-20 shrink-0 text-right text-xs", level.text)}>
                {level.label}
              </span>
              <span className="w-14 shrink-0 text-right text-xs text-muted-foreground">
                {c.reviews} rev.
              </span>
            </div>
          );
        })}
      </CardContent>
    </Card>
  );
}
