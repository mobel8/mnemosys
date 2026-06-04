/**
 * Responsive grid of `<DeckCard>` tiles. Stays presentational — fetching and
 * empty-state handling belong to the parent page.
 */

import { useMemo } from "react";
import { DeckCard } from "@/components/DeckCard";
import { useDecksWithStats } from "@/lib/queries";
import type { Deck, DeckWithStats } from "@/lib/tauri";

interface DeckGridProps {
  decks: Deck[];
}

export function DeckGrid({ decks }: DeckGridProps) {
  // P081 — one batched fetch of every deck's stats + mastery instead of the
  // previous 2-3 IPC calls per card (N+1). Keyed by deck id; a card whose row
  // isn't in the batch yet (loading, or a deck added between fetches) simply
  // falls back to its own per-deck queries.
  const withStats = useDecksWithStats();
  const byId = useMemo(() => {
    const m = new Map<number, DeckWithStats>();
    for (const d of withStats.data ?? []) m.set(d.id, d);
    return m;
  }, [withStats.data]);

  return (
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
      {decks.map((deck) => {
        const ws = byId.get(deck.id);
        return (
          <DeckCard key={deck.id} deck={deck} statsData={ws?.stats} masteryData={ws?.mastery} />
        );
      })}
    </div>
  );
}
