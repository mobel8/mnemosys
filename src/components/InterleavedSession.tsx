/**
 * Interleaved review session (Vague 5).
 *
 * Layout:
 *   1. Multi-deck picker — checkbox list of every existing deck.
 *   2. Limit picker — number input, clamped to 1..=100 (default 20).
 *   3. « Démarrer » button — fetches `get_interleaved_due_cards` and pipes
 *      the result into the existing `<ReviewSession />` so the FSRS state
 *      machine, hotkeys, summary, etc. are reused verbatim.
 *
 * The component is intentionally self-contained: it owns its own deck
 * selection state and only enters the review flow once the user clicks
 * « start ». That avoids spending an LLM-like budget of UI churn when the
 * learner is still ticking boxes.
 *
 * Why a separate component rather than reusing the single-deck review
 * page? The interleaved fetch needs *N* deck ids — the URL-bound
 * `/review/$deckId` route locks us to one. A dedicated route + component
 * keeps the existing single-deck path untouched and the cache key clean.
 */

import { useNavigate } from "@tanstack/react-router";
import { Loader2, Shuffle } from "lucide-react";
import { useId, useMemo, useState } from "react";
import { ReviewSession } from "@/components/ReviewSession";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { toast } from "@/components/ui/use-toast";
import { useDecks, useInterleavedDueCards } from "@/lib/queries";
import type { CardWithNote } from "@/lib/tauri";
import { cn } from "@/lib/utils";

const DEFAULT_LIMIT = 20;
const MAX_LIMIT = 100;

function clampLimit(value: number): number {
  if (!Number.isFinite(value)) return DEFAULT_LIMIT;
  if (value < 1) return 1;
  if (value > MAX_LIMIT) return MAX_LIMIT;
  return Math.floor(value);
}

export function InterleavedSession() {
  const navigate = useNavigate();
  const decksQuery = useDecks();
  const decks = useMemo(() => decksQuery.data ?? [], [decksQuery.data]);
  const [selectedDeckIds, setSelectedDeckIds] = useState<number[]>([]);
  const [limit, setLimit] = useState<number>(DEFAULT_LIMIT);
  /**
   * Once the user confirms the picker we freeze the chosen ids so toggling
   * a checkbox mid-session doesn't refetch + reshuffle the queue. The
   * frozen list is the cache key fed to `useInterleavedDueCards`.
   */
  const [activeDeckIds, setActiveDeckIds] = useState<number[] | null>(null);

  const limitInputId = useId();

  const interleaved = useInterleavedDueCards(activeDeckIds ?? [], limit, {
    // Only fire once we've left the picker. Until then the hook stays idle.
    enabled: activeDeckIds !== null && activeDeckIds.length > 0,
  });

  function toggleDeck(deckId: number) {
    setSelectedDeckIds((prev) =>
      prev.includes(deckId) ? prev.filter((id) => id !== deckId) : [...prev, deckId],
    );
  }

  function selectAll() {
    setSelectedDeckIds(decks.map((d) => d.id));
  }

  function clearAll() {
    setSelectedDeckIds([]);
  }

  function handleStart() {
    if (selectedDeckIds.length === 0) return;
    setActiveDeckIds(selectedDeckIds);
  }

  function handleBackToPicker() {
    setActiveDeckIds(null);
  }

  // --- Rendering phases ----------------------------------------------------

  // Phase 2 — the session is in flight: hand off to `<ReviewSession />`.
  if (activeDeckIds !== null) {
    if (interleaved.isLoading) {
      return (
        <div className="flex h-full items-center justify-center p-6">
          <div className="flex flex-col items-center gap-3 text-muted-foreground">
            <Loader2 className="h-6 w-6 animate-spin" />
            <span className="text-sm">Mélange de la file…</span>
          </div>
        </div>
      );
    }

    if (interleaved.error) {
      return (
        <div className="flex h-full items-center justify-center p-6">
          <Card className="max-w-md">
            <CardHeader>
              <CardTitle>Impossible de charger la file</CardTitle>
              <CardDescription>{interleaved.error.message}</CardDescription>
            </CardHeader>
            <CardContent className="flex gap-2">
              <Button variant="outline" onClick={() => interleaved.refetch()}>
                Réessayer
              </Button>
              <Button onClick={handleBackToPicker}>Retour au sélecteur</Button>
            </CardContent>
          </Card>
        </div>
      );
    }

    const cards: CardWithNote[] = interleaved.data ?? [];

    if (cards.length === 0) {
      return (
        <div className="flex h-full items-center justify-center p-6">
          <Card className="max-w-md text-center">
            <CardHeader>
              <CardTitle>Aucune carte due</CardTitle>
              <CardDescription>
                Tous les decks sélectionnés sont à jour. Reviens plus tard ou choisis d'autres
                decks.
              </CardDescription>
            </CardHeader>
            <CardContent className="flex justify-center gap-2">
              <Button variant="outline" onClick={handleBackToPicker}>
                Retour au sélecteur
              </Button>
              <Button onClick={() => navigate({ to: "/" })}>Accueil</Button>
            </CardContent>
          </Card>
        </div>
      );
    }

    // Pass `deckId = -1` as a synthetic « no canonical deck » sentinel so
    // `<ReviewSession />` doesn't try to route back to a specific deck on
    // quit. The session itself reads each card's `card.deck_id` for any
    // per-card invalidation — the prop is only used for navigation back.
    return (
      <ReviewSessionInterleavedShell
        cards={cards}
        onQuit={handleBackToPicker}
        deckLookup={Object.fromEntries(decks.map((d) => [d.id, d.name]))}
      />
    );
  }

  // Phase 1 — picker.
  const startDisabled = selectedDeckIds.length === 0;

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-lg">
            <Shuffle className="h-5 w-5 text-primary" />
            Decks à mélanger
          </CardTitle>
          <CardDescription>
            Coche les decks à intégrer dans la session. L'ordre des cartes sera mélangé pour forcer
            une pratique distribuée (Rohrer &amp; Taylor 2015).
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {decksQuery.isLoading ? (
            <p className="text-sm text-muted-foreground">Chargement des decks…</p>
          ) : decks.length === 0 ? (
            <div className="rounded-md border border-dashed bg-muted/30 p-4 text-sm text-muted-foreground">
              Aucun deck disponible. Crée d'abord quelques decks avant d'utiliser le mode entrelacé.
            </div>
          ) : (
            <>
              <div className="flex flex-wrap items-center gap-2">
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={selectAll}
                  disabled={decks.every((d) => selectedDeckIds.includes(d.id))}
                >
                  Tout sélectionner
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={clearAll}
                  disabled={selectedDeckIds.length === 0}
                >
                  Tout désélectionner
                </Button>
                <span className="text-xs text-muted-foreground">
                  {selectedDeckIds.length} / {decks.length} deck
                  {decks.length > 1 ? "s" : ""} sélectionné
                  {selectedDeckIds.length > 1 ? "s" : ""}
                </span>
              </div>

              <ul className="grid gap-2 sm:grid-cols-2" aria-label="Sélection des decks à mélanger">
                {decks.map((deck) => {
                  const checked = selectedDeckIds.includes(deck.id);
                  return (
                    <li key={deck.id}>
                      <label
                        className={cn(
                          "flex cursor-pointer items-center gap-2 rounded-md border p-2 text-sm transition-colors",
                          checked ? "border-primary/50 bg-primary/5" : "hover:bg-accent/40",
                        )}
                      >
                        <input
                          type="checkbox"
                          className="h-4 w-4 rounded border-input"
                          checked={checked}
                          onChange={() => toggleDeck(deck.id)}
                          aria-label={`Inclure « ${deck.name} » dans la session entrelacée`}
                        />
                        <span
                          aria-hidden
                          className="inline-block h-3 w-3 rounded-full"
                          style={{ background: deck.color }}
                        />
                        <span className="truncate">{deck.name}</span>
                      </label>
                    </li>
                  );
                })}
              </ul>
            </>
          )}

          <div className="grid gap-2 sm:max-w-xs">
            <Label htmlFor={limitInputId}>Nombre maximum de cartes</Label>
            <Input
              id={limitInputId}
              type="number"
              min={1}
              max={MAX_LIMIT}
              value={limit}
              onChange={(e) => setLimit(clampLimit(Number.parseInt(e.target.value, 10)))}
            />
            <p className="text-xs text-muted-foreground">Entre 1 et {MAX_LIMIT}.</p>
          </div>

          <div className="flex items-center gap-2 pt-1">
            <Button
              type="button"
              onClick={() => {
                if (startDisabled) {
                  toast({
                    title: "Sélectionne au moins un deck",
                    description: "Coche au moins un deck pour démarrer la session.",
                    variant: "destructive",
                  });
                  return;
                }
                handleStart();
              }}
              disabled={startDisabled}
            >
              <Shuffle className="h-4 w-4" />
              Démarrer la session entrelacée
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

/**
 * Tiny wrapper around `<ReviewSession />` that passes the per-card deck
 * name down via the existing `cards` prop and exposes a « back to picker »
 * exit. The real review state machine lives in `ReviewSession`; this shell
 * only annotates each card with the originating deck so the badge renders.
 */
function ReviewSessionInterleavedShell({
  cards,
  onQuit,
  deckLookup,
}: {
  cards: CardWithNote[];
  onQuit: () => void;
  deckLookup: Record<number, string>;
}) {
  // `ReviewSession` owns the review loop and doesn't expose a per-card
  // `deckName` prop, so we can't pass the originating deck directly to
  // `<ReviewCard />`. Instead we tag each card's parent note with a synthetic
  // `__deck_name` field via a shallow clone of the queue; `ReviewCard` reads
  // `note.fields.__deck_name` when present to render its deck badge. This stays
  // additive, keeps the prop surface unchanged, and never touches the
  // persisted DB (the clone is in-memory only).
  const taggedCards: CardWithNote[] = useMemo(
    () =>
      cards.map((c) => ({
        ...c,
        note: {
          ...c.note,
          fields: {
            ...c.note.fields,
            __deck_name: deckLookup[c.card.deck_id] ?? "",
          },
        },
      })),
    [cards, deckLookup],
  );

  // Pass `deckId = -1` as a synthetic « no canonical deck » sentinel: every
  // navigation in `ReviewSession` (quit, edit, summary) detects the negative
  // id and routes back to the interleaved entry point instead of a concrete
  // `/decks/$deckId` page that wouldn't exist for a mixed queue.
  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center justify-between border-b px-6 py-2 text-xs text-muted-foreground">
        <span>Session entrelacée — {cards.length} cartes</span>
        <Button variant="ghost" size="sm" onClick={onQuit}>
          Retour au sélecteur
        </Button>
      </div>
      <div className="min-h-0 flex-1">
        <ReviewSession deckId={-1} cards={taggedCards} />
      </div>
    </div>
  );
}
