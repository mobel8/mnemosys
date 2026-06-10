/**
 * « Réviser » — the global session, one click from the sidebar.
 *
 * Pulls today's due cards across EVERY deck in interleaved order (mixing
 * contexts beats blocked practice on delayed tests) and drops straight into
 * the fullscreen ReviewSession. No picker, no setup screen: the daily core
 * action is one click.
 *
 * Quotas: the backend interleaved query caps total size at the daily review
 * limit but has no per-state cap, so the daily NEW-card allowance
 * (daily_new_limit minus the new cards already studied today) is applied
 * here — keeps this queue consistent with the home hero's count.
 */

import { Link } from "@tanstack/react-router";
import { GraduationCap } from "lucide-react";
import { useMemo } from "react";
import { ReviewSession } from "@/components/ReviewSession";
import { Button } from "@/components/ui/button";
import { useDecks, useInterleavedDueCards, useSettingsQuery, useTodayStats } from "@/lib/queries";
import type { CardWithNote } from "@/lib/tauri";

export default function ReviewAllPage() {
  const decks = useDecks();
  const settings = useSettingsQuery();
  const today = useTodayStats();
  const deckIds = useMemo(() => (decks.data ?? []).map((d) => d.id), [decks.data]);
  const limit = settings.data?.daily_review_limit ?? 200;

  const due = useInterleavedDueCards(deckIds, limit, {
    enabled: decks.isSuccess && deckIds.length > 0,
  });

  // Apply the daily new-card allowance, then tag each card with its deck
  // name so the mixed queue keeps its context (chip on the card).
  const cards = useMemo<CardWithNote[]>(() => {
    if (!due.data) return [];
    const newAllowance = Math.max(
      0,
      (settings.data?.daily_new_limit ?? 20) - (today.data?.new_cards_today ?? 0),
    );
    let newKept = 0;
    const names = new Map((decks.data ?? []).map((d) => [d.id, d.name]));
    return due.data
      .filter((cwn) => (cwn.card.state !== "new" ? true : newKept++ < newAllowance))
      .map((cwn) => ({
        ...cwn,
        note: {
          ...cwn.note,
          fields: { ...cwn.note.fields, __deck_name: names.get(cwn.card.deck_id) ?? "" },
        },
      }));
  }, [due.data, decks.data, settings.data?.daily_new_limit, today.data?.new_cards_today]);

  // Wait for settings + today's stats too: the new-card allowance filter
  // below must never run against defaults (a race here briefly let the queue
  // bypass the daily quota on first mount).
  if (
    decks.isLoading ||
    settings.isLoading ||
    today.isLoading ||
    (deckIds.length > 0 && due.isLoading)
  ) {
    return (
      <div className="flex h-full items-center justify-center">
        <div className="space-y-3 text-center" aria-busy="true">
          <div className="mx-auto h-10 w-64 animate-pulse rounded-lg bg-muted" />
          <p className="text-sm text-muted-foreground">Préparation de ta session…</p>
        </div>
      </div>
    );
  }

  if (cards.length === 0) {
    return (
      <div className="flex h-full items-center justify-center px-6">
        <div className="bg-brand-radial w-full max-w-md rounded-2xl border bg-card p-10 text-center shadow-sm">
          <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-xl bg-brand-50">
            <GraduationCap className="h-6 w-6 text-brand-500" aria-hidden />
          </div>
          <h1 className="mt-4 font-display text-2xl tracking-tight">
            {(due.data?.length ?? 0) > 0 ? "Objectif du jour atteint" : "Tu es à jour"}
          </h1>
          <p className="mt-2 text-sm text-muted-foreground">
            {(due.data?.length ?? 0) > 0
              ? "Le quota quotidien de nouvelles cartes est épuisé — la suite arrive demain, ou augmente la limite dans Paramètres → Révision."
              : "Aucune carte n'est due pour l'instant. Reviens plus tard, ou ajoute de nouvelles cartes."}
          </p>
          <div className="mt-6 flex justify-center gap-2">
            <Button asChild variant="outline">
              <Link to="/">Accueil</Link>
            </Button>
            <Button asChild>
              <Link to="/create">Créer des cartes</Link>
            </Button>
          </div>
        </div>
      </div>
    );
  }

  return <ReviewSession deckId={-1} cards={cards} sessionLabel="Session globale" />;
}
