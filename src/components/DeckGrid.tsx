/**
 * Responsive grid of `<DeckCard>` tiles. Stays presentational — fetching and
 * empty-state handling belong to the parent page.
 */

import { DeckCard } from "@/components/DeckCard";
import type { Deck } from "@/lib/tauri";

interface DeckGridProps {
  decks: Deck[];
}

export function DeckGrid({ decks }: DeckGridProps) {
  return (
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
      {decks.map((deck) => (
        <DeckCard key={deck.id} deck={deck} />
      ))}
    </div>
  );
}
