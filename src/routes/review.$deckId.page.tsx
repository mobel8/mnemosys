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
import { Loader2, PartyPopper } from "lucide-react";
import { ReviewSession } from "@/components/ReviewSession";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { useDueCards } from "@/lib/queries";

const routeApi = getRouteApi("/review/$deckId");

export default function ReviewPage() {
  const { deckId } = routeApi.useParams();
  const due = useDueCards(deckId, 200);

  if (due.isLoading) {
    return (
      <div className="flex h-full items-center justify-center p-6">
        <div className="flex flex-col items-center gap-3 text-muted-foreground">
          <Loader2 className="h-6 w-6 animate-spin" />
          <span className="text-sm">Chargement de la file…</span>
        </div>
      </div>
    );
  }

  if (due.error) {
    return (
      <div className="flex h-full items-center justify-center p-6">
        <Card className="max-w-md">
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
        <Card className="max-w-md text-center">
          <CardHeader>
            <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-primary/10 text-primary">
              <PartyPopper className="h-6 w-6" />
            </div>
            <CardTitle className="mt-3">Tu es à jour !</CardTitle>
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
