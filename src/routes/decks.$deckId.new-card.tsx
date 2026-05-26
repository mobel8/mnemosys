import { createRoute, Link } from "@tanstack/react-router";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Route as rootRoute } from "./__root";

/**
 * "Add card" stub. Wave B2 owns the real editor (template picker, fields,
 * tags, live preview).
 */
export const Route = createRoute({
  getParentRoute: () => rootRoute,
  path: "/decks/$deckId/new-card",
  component: NewCardPage,
  parseParams: ({ deckId }) => ({ deckId: Number(deckId) }),
});

function NewCardPage() {
  const { deckId } = Route.useParams();
  return (
    <div className="space-y-6 p-6">
      <Card>
        <CardHeader>
          <CardTitle>New card</CardTitle>
          <CardDescription>Card editor for deck #{deckId} — coming in Wave B2.</CardDescription>
        </CardHeader>
        <CardContent>
          <Button asChild variant="outline">
            <Link to="/decks/$deckId" params={{ deckId }}>
              Back to deck
            </Link>
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}
