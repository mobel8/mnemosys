/**
 * Knowledge Graph page (Vague 11). Renders a tag co-occurrence graph for the
 * whole collection or a single deck. Thin wrapper: deck selector + loading /
 * empty handling around the reusable `<KnowledgeGraph>` component.
 *
 * The deck filter lives in local state ("all decks" = `null`). Switching it
 * re-queries through TanStack Query (`useTagGraph`), which caches per deck.
 */

import { Network } from "lucide-react";
import { useMemo, useState } from "react";
import { KnowledgeGraph } from "@/components/KnowledgeGraph";
import { Card, CardContent } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useDecks, useTagGraph } from "@/lib/queries";

const ALL_DECKS = "all";

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
          <h1 className="flex items-center gap-2 text-2xl font-semibold">
            <Network className="h-6 w-6 text-brand-500" /> Graphe de connaissances
          </h1>
          <p className="mt-1 max-w-prose text-sm text-muted-foreground">
            Les liens entre tes cartes via leurs tags partagés. Survole un tag pour mettre en
            évidence ses connexions.
          </p>
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="graph-deck" className="text-xs">
            Portée
          </Label>
          <Select
            value={deckId === null ? ALL_DECKS : String(deckId)}
            onValueChange={(value) => setDeckId(value === ALL_DECKS ? null : Number(value))}
          >
            <SelectTrigger id="graph-deck" className="sm:w-56">
              <SelectValue placeholder="Tous les decks" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={ALL_DECKS}>Tous les decks</SelectItem>
              {decks.map((deck) => (
                <SelectItem key={deck.id} value={String(deck.id)}>
                  {deck.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </header>

      {graphQuery.isLoading ? (
        <Card>
          <CardContent className="space-y-4 p-6">
            <div className="h-[372px] animate-pulse rounded-lg bg-muted" />
            <div className="flex flex-wrap gap-2">
              {Array.from({ length: 5 }).map((_, i) => (
                // biome-ignore lint/suspicious/noArrayIndexKey: skeleton placeholders, order is stable
                <div key={i} className="h-6 w-20 animate-pulse rounded-full bg-muted" />
              ))}
            </div>
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
