/**
 * Knowledge Graph page (Vague 11). Renders a tag co-occurrence graph for the
 * whole collection or a single deck. Thin wrapper: deck selector + loading /
 * empty handling around the reusable `<KnowledgeGraph>` component.
 *
 * The deck filter lives in local state ("all decks" = `null`). Switching it
 * re-queries through TanStack Query (`useTagGraph`), which caches per deck.
 */

import { Loader2 } from "lucide-react";
import { useMemo, useState } from "react";
import { KnowledgeGraph } from "@/components/KnowledgeGraph";
import { Card, CardContent } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { useDecks, useTagGraph } from "@/lib/queries";

export default function GraphPage() {
  const decksQuery = useDecks();
  const decks = useMemo(() => decksQuery.data ?? [], [decksQuery.data]);

  // null = "all decks".
  const [deckId, setDeckId] = useState<number | null>(null);
  const graphQuery = useTagGraph(deckId);

  return (
    <div className="space-y-6 p-6">
      <header className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h2 className="text-2xl font-semibold tracking-tight">Graphe de connaissances</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            Les liens entre tes cartes via leurs tags partagés. Survole un tag pour mettre en
            évidence ses connexions.
          </p>
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="graph-deck" className="text-xs">
            Portée
          </Label>
          <select
            id="graph-deck"
            className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring sm:w-56"
            value={deckId ?? ""}
            onChange={(e) => setDeckId(e.target.value ? Number(e.target.value) : null)}
          >
            <option value="">Tous les decks</option>
            {decks.map((deck) => (
              <option key={deck.id} value={deck.id}>
                {deck.name}
              </option>
            ))}
          </select>
        </div>
      </header>

      {graphQuery.isLoading ? (
        <Card>
          <CardContent className="flex h-[420px] items-center justify-center">
            <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
          </CardContent>
        </Card>
      ) : graphQuery.isError ? (
        <Card className="border-destructive/40">
          <CardContent className="flex h-[420px] items-center justify-center text-center">
            <p className="text-sm text-muted-foreground">
              Impossible de charger le graphe :{" "}
              {graphQuery.error instanceof Error ? graphQuery.error.message : "erreur inconnue"}.
            </p>
          </CardContent>
        </Card>
      ) : (
        <KnowledgeGraph graph={graphQuery.data ?? { nodes: [], edges: [] }} />
      )}
    </div>
  );
}
