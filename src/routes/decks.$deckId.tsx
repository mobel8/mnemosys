import { createRoute, Link } from "@tanstack/react-router";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { useDeck, useDeckStats } from "@/lib/queries";
import { Route as rootRoute } from "./__root";

/**
 * Deck detail stub. Wave B2 will render the cards table, edit affordances,
 * and per-deck settings.
 */
export const Route = createRoute({
  getParentRoute: () => rootRoute,
  path: "/decks/$deckId",
  component: DeckDetailPage,
  parseParams: ({ deckId }) => ({ deckId: Number(deckId) }),
});

function DeckDetailPage() {
  const { deckId } = Route.useParams();
  const deck = useDeck(deckId);
  const stats = useDeckStats(deckId);

  return (
    <div className="space-y-6 p-6">
      <header className="flex items-start justify-between gap-4">
        <div>
          <h2 className="text-2xl font-semibold tracking-tight">{deck.data?.name ?? "Deck"}</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            {deck.data?.description ?? "Deck detail — coming soon."}
          </p>
        </div>
        <div className="flex gap-2">
          <Button asChild variant="outline">
            <Link to="/decks/$deckId/new-card" params={{ deckId }}>
              Add card
            </Link>
          </Button>
          <Button asChild>
            <Link to="/review/$deckId" params={{ deckId }}>
              Review
            </Link>
          </Button>
        </div>
      </header>

      {stats.data && (
        <div className="grid gap-4 md:grid-cols-4">
          <Card>
            <CardHeader>
              <CardDescription>Total</CardDescription>
              <CardTitle className="text-2xl">{stats.data.total_cards}</CardTitle>
            </CardHeader>
          </Card>
          <Card>
            <CardHeader>
              <CardDescription>New</CardDescription>
              <CardTitle className="text-2xl">{stats.data.new_cards}</CardTitle>
            </CardHeader>
          </Card>
          <Card>
            <CardHeader>
              <CardDescription>Learning</CardDescription>
              <CardTitle className="text-2xl">{stats.data.learning_cards}</CardTitle>
            </CardHeader>
          </Card>
          <Card>
            <CardHeader>
              <CardDescription>Due today</CardDescription>
              <CardTitle className="text-2xl">{stats.data.due_today}</CardTitle>
            </CardHeader>
          </Card>
        </div>
      )}

      <Card>
        <CardContent className="pt-6 text-sm text-muted-foreground">
          Card browser will land in Wave B2.
        </CardContent>
      </Card>
    </div>
  );
}
