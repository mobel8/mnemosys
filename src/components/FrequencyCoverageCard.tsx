/**
 * Vague 10 — vocabulary-coverage card for a language deck.
 *
 * Renders the deck's notes bucketed by Zipf frequency band as a single
 * stacked bar (most-frequent → long tail), plus a legend with per-band
 * counts. The Pareto framing: a learner who covers the top bands first
 * unlocks the bulk of real-world comprehension for the least effort.
 *
 * Only meaningful for decks flagged with a `language_mode`; the deck detail
 * page gates rendering on that. When the deck has notes but none are tagged,
 * we show a gentle hint rather than an empty bar.
 */

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { FREQUENCY_BAND_ORDER } from "@/lib/languages";
import { useFrequencyCoverage } from "@/lib/queries";
import type { FrequencyCoverage } from "@/lib/tauri";
import { cn } from "@/lib/utils";

interface FrequencyCoverageCardProps {
  deckId: number;
}

function countFor(coverage: FrequencyCoverage, key: string): number {
  switch (key) {
    case "top_100":
      return coverage.top_100;
    case "top_1k":
      return coverage.top_1k;
    case "top_5k":
      return coverage.top_5k;
    case "top_10k":
      return coverage.top_10k;
    case "beyond":
      return coverage.beyond;
    case "untagged":
      return coverage.untagged;
    default:
      return 0;
  }
}

export function FrequencyCoverageCard({ deckId }: FrequencyCoverageCardProps) {
  const { data: coverage, isLoading } = useFrequencyCoverage(deckId);

  const total = coverage
    ? coverage.top_100 +
      coverage.top_1k +
      coverage.top_5k +
      coverage.top_10k +
      coverage.beyond +
      coverage.untagged
    : 0;
  const tagged = coverage ? total - coverage.untagged : 0;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Couverture lexicale</CardTitle>
        <CardDescription>
          Répartition des notes par bande de fréquence (Pareto 80/20).
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {isLoading || !coverage ? (
          <div
            role="status"
            aria-busy="true"
            aria-label="Chargement de la couverture"
            className="space-y-4"
          >
            <div className="h-3 w-full animate-pulse rounded-full bg-muted" />
            <ul className="grid grid-cols-2 gap-x-4 gap-y-2 sm:grid-cols-3">
              {FREQUENCY_BAND_ORDER.map((band) => (
                <li key={band.key} className="flex items-center gap-2">
                  <span className="h-2.5 w-2.5 shrink-0 animate-pulse rounded-sm bg-muted" />
                  <span className="h-3.5 w-16 animate-pulse rounded bg-muted" />
                  <span className="ml-auto h-3.5 w-6 animate-pulse rounded bg-muted" />
                </li>
              ))}
            </ul>
          </div>
        ) : total === 0 ? (
          <p className="text-sm text-muted-foreground">Aucune note dans ce deck pour l'instant.</p>
        ) : tagged === 0 ? (
          <p className="text-sm text-muted-foreground">
            Aucune note taggée par fréquence. Choisis une bande dans l'éditeur « Phrase » pour
            suivre ta couverture.
          </p>
        ) : (
          <>
            <div className="flex h-3 w-full overflow-hidden rounded-full bg-muted">
              {FREQUENCY_BAND_ORDER.map((band) => {
                const count = countFor(coverage, band.key);
                if (count === 0) return null;
                const pct = (count / total) * 100;
                return (
                  <div
                    key={band.key}
                    className={cn("h-full", band.color)}
                    style={{ width: `${pct}%` }}
                    title={`${band.label} : ${count}`}
                  />
                );
              })}
            </div>
            <ul className="grid grid-cols-2 gap-x-4 gap-y-1.5 text-sm sm:grid-cols-3">
              {FREQUENCY_BAND_ORDER.map((band) => {
                const count = countFor(coverage, band.key);
                return (
                  <li key={band.key} className="flex items-center gap-2">
                    <span className={cn("h-2.5 w-2.5 shrink-0 rounded-sm", band.color)} />
                    <span className="text-muted-foreground">{band.label}</span>
                    <span className="ml-auto font-medium tabular-nums">{count}</span>
                  </li>
                );
              })}
            </ul>
          </>
        )}
      </CardContent>
    </Card>
  );
}
