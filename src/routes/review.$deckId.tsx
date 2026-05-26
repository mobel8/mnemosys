import { createRoute, Link } from "@tanstack/react-router";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { useDueCards } from "@/lib/queries";
import { Route as rootRoute } from "./__root";

/**
 * Review session stub. Wave B3 owns the real flow: flip animation, rating
 * buttons, hotkeys, undo, etc.
 */
export const Route = createRoute({
  getParentRoute: () => rootRoute,
  path: "/review/$deckId",
  component: ReviewPage,
  parseParams: ({ deckId }) => ({ deckId: Number(deckId) }),
});

function ReviewPage() {
  const { deckId } = Route.useParams();
  const due = useDueCards(deckId, 100);

  return (
    <div className="space-y-6 p-6">
      <Card>
        <CardHeader>
          <CardTitle>Review</CardTitle>
          <CardDescription>
            {due.isLoading
              ? "Loading queue…"
              : due.error
                ? `Error: ${due.error.message}`
                : `${due.data?.length ?? 0} card(s) due in deck #${deckId}`}
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4 text-sm text-muted-foreground">
          <p>Review UI coming in Wave B3.</p>
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
