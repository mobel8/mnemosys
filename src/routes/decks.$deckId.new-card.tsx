/**
 * "Add card" page. Thin shell around `<NoteEditor>` — the editor handles
 * templates, tags, preview, and submit. Back-navigation lives in the
 * TopBar breadcrumb.
 */

import { createRoute, Link, useNavigate } from "@tanstack/react-router";
import { ArrowLeft } from "lucide-react";
import { NoteEditor } from "@/components/NoteEditor";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { useDeck } from "@/lib/queries";
import { Route as rootRoute } from "./__root";

export const Route = createRoute({
  getParentRoute: () => rootRoute,
  path: "/decks/$deckId/new-card",
  component: NewCardPage,
  parseParams: ({ deckId }) => ({ deckId: Number(deckId) }),
});

function NewCardPage() {
  const { deckId } = Route.useParams();
  const navigate = useNavigate();
  const deck = useDeck(deckId);

  return (
    <div className="space-y-6 p-6">
      <div className="flex items-center gap-2">
        <Button asChild variant="ghost" size="sm">
          <Link to="/decks/$deckId" params={{ deckId }}>
            <ArrowLeft className="h-4 w-4" />
            Retour au deck
          </Link>
        </Button>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>
            Nouvelle carte
            {deck.data && (
              <span className="ml-2 text-muted-foreground">dans « {deck.data.name} »</span>
            )}
          </CardTitle>
        </CardHeader>
        <CardContent>
          <NoteEditor
            deckId={deckId}
            onAdded={() => {
              void navigate({ to: "/decks/$deckId", params: { deckId } });
            }}
          />
        </CardContent>
      </Card>
    </div>
  );
}
