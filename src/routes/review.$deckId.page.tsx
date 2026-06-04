/**
 * Review session page component — extracted from
 * `src/routes/review.$deckId.tsx` for code-splitting via
 * `lazyRouteComponent`.
 *
 * Responsibilities split:
 *   - This file owns fetching the due queue, skeleton/error/empty states,
 *     and bouncing back to the deck when there's nothing to do.
 *   - Once we have cards, `<ReviewSession />` takes over the full state
 *     machine: phases, hotkeys, submit + suspend mutations, summary.
 *
 * We pull a generous `limit` (200) so a single long session doesn't run
 * out of cards mid-flight. The hard cap matches the backend's safety
 * ceiling and avoids holding the whole deck in memory for very large decks.
 */

import { getRouteApi, Link } from "@tanstack/react-router";
import { PartyPopper } from "lucide-react";
import { ReviewSession } from "@/components/ReviewSession";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { useDueCards, useSettingsQuery } from "@/lib/queries";

const routeApi = getRouteApi("/review/$deckId");

export default function ReviewPage() {
  const { deckId } = routeApi.useParams();
  // P069 — wire the daily quotas that were previously inert: `limit` caps
  // reviews/day, `newLimit` caps new cards/day. Wait for settings before
  // fetching so the first queue already respects the caps (no stale 200/∞ run).
  const settings = useSettingsQuery();
  const reviewLimit = settings.data?.daily_review_limit ?? 200;
  const newLimit = settings.data?.daily_new_limit ?? 20;
  const due = useDueCards(deckId, reviewLimit, newLimit, {
    enabled: settings.data != null,
  });

  if (settings.isLoading || due.isLoading) {
    return <ReviewLoadingSkeleton />;
  }

  if (due.error) {
    return (
      <div className="flex h-full items-center justify-center p-6">
        <Card className="w-full max-w-md border-destructive/40">
          <CardHeader>
            <CardTitle>Impossible de charger les cartes</CardTitle>
            <CardDescription>{due.error.message}</CardDescription>
          </CardHeader>
          <CardContent className="flex gap-2">
            <Button variant="outline" onClick={() => due.refetch()}>
              Réessayer
            </Button>
            <Button asChild>
              <Link to="/decks/$deckId" params={{ deckId }}>
                Retour au deck
              </Link>
            </Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  const cards = due.data ?? [];

  if (cards.length === 0) {
    return (
      <div className="flex h-full items-center justify-center p-6">
        <Card className="w-full max-w-md text-center">
          <CardHeader>
            <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-full bg-brand-50 text-brand-500">
              <PartyPopper className="h-7 w-7" />
            </div>
            <CardTitle className="mt-3 font-display text-xl">Tu es à jour !</CardTitle>
            <CardDescription>
              Aucune carte due pour ce deck. Reviens plus tard ou ajoute-en des nouvelles.
            </CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col items-center gap-2 sm:flex-row sm:justify-center">
            <Button asChild variant="outline">
              <Link to="/decks/$deckId" params={{ deckId }}>
                Retour au deck
              </Link>
            </Button>
            <Button asChild>
              <Link to="/decks/$deckId/new-card" params={{ deckId }}>
                Ajouter une carte
              </Link>
            </Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  return <ReviewSession deckId={deckId} cards={cards} />;
}

/**
 * Loading state for the due queue. Mirrors the session layout — a slim
 * progress rail on top, then a centred card-sized placeholder and a rating
 * row — with `bg-muted animate-pulse` skeletons rather than a bare spinner,
 * so the shift to real content is barely perceptible (design.md).
 */
function ReviewLoadingSkeleton() {
  return (
    <div
      className="flex h-full min-h-0 flex-col"
      role="status"
      aria-busy="true"
      aria-label="Chargement de la file"
    >
      <div className="border-b bg-background/95">
        <div className="h-1.5 w-full bg-secondary" />
        <div className="flex h-12 items-center justify-between gap-4 px-4">
          <div className="h-3 w-24 animate-pulse rounded-lg bg-muted" />
          <div className="h-3 w-12 animate-pulse rounded-lg bg-muted" />
          <div className="h-3 w-16 animate-pulse rounded-lg bg-muted" />
        </div>
      </div>
      <div className="flex flex-1 flex-col items-center justify-center gap-8 px-4 py-8">
        <div className="h-[280px] w-full max-w-2xl animate-pulse rounded-xl bg-muted" />
        <div className="h-11 w-[280px] animate-pulse rounded-lg bg-muted" />
      </div>
    </div>
  );
}
