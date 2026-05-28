/**
 * Single deck tile rendered inside `<DeckGrid>`.
 *
 * Encapsulates the stats fetch (per-deck), the action menu (study / edit /
 * delete) and the deletion confirmation flow so the parent grid stays
 * pure layout.
 */

import { useNavigate } from "@tanstack/react-router";
import { motion } from "framer-motion";
import { BookOpen, Lock, Mic2, MoreVertical, Pencil, Play, Trash2 } from "lucide-react";
import { useState } from "react";
import { DeckPodcastDialog } from "@/components/DeckPodcastDialog";
import { EditDeckDialog } from "@/components/EditDeckDialog";
import { schedulerLabel } from "@/components/SchedulerPicker";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { toast } from "@/components/ui/use-toast";
import {
  useDeckMastery,
  useDeckMasteryStatus,
  useDeckStats,
  useDecks,
  useDeleteDeck,
} from "@/lib/queries";
import type { Deck, DeckMastery } from "@/lib/tauri";

interface DeckCardProps {
  deck: Deck;
}

/**
 * Pick the most representative mastery label for the deck card badge.
 *
 * Strategy: pick the *highest* level whose share of the deck exceeds a
 * stability threshold (`>= 50%`). If the deck is empty (no non-suspended
 * cards) the function returns `null` and the caller renders no badge.
 *
 * Order of preference (best first): Burned → Enlightened → Master → Guru →
 * Apprentice. A deck with `apprentice = 100%` lands on Apprentice; the
 * thresholds are explicit so a future change of policy stays trivial.
 */
function pickMasteryLevel(m: DeckMastery): {
  label: string;
  tone: string;
} | null {
  const total = m.apprentice + m.guru + m.master + m.enlightened + m.burned;
  if (total === 0) return null;
  const half = total / 2;
  if (m.burned >= half)
    return {
      label: "Burned",
      tone: "bg-amber-500/15 text-amber-700 dark:text-amber-300 border-amber-500/30",
    };
  if (m.burned + m.enlightened >= half)
    return {
      label: "Enlightened",
      tone: "bg-fuchsia-500/15 text-fuchsia-700 dark:text-fuchsia-300 border-fuchsia-500/30",
    };
  if (m.burned + m.enlightened + m.master >= half)
    return {
      label: "Master",
      tone: "bg-violet-500/15 text-violet-700 dark:text-violet-300 border-violet-500/30",
    };
  if (m.burned + m.enlightened + m.master + m.guru >= half)
    return {
      label: "Guru",
      tone: "bg-emerald-500/15 text-emerald-700 dark:text-emerald-300 border-emerald-500/30",
    };
  return {
    label: "Apprentice",
    tone: "bg-sky-500/15 text-sky-700 dark:text-sky-300 border-sky-500/30",
  };
}

export function DeckCard({ deck }: DeckCardProps) {
  const navigate = useNavigate();
  const stats = useDeckStats(deck.id);
  const mastery = useDeckMastery(deck.id);
  const masteryLevel = mastery.data ? pickMasteryLevel(mastery.data) : null;
  // Vague 15 — Bloom mastery gate. Only query when this deck has a prerequisite
  // (an ungated deck is always unlocked, so we skip the round-trip).
  const hasPrerequisite = deck.prerequisite_deck_id != null;
  const masteryStatus = useDeckMasteryStatus(deck.id, { enabled: hasPrerequisite });
  const locked = hasPrerequisite && masteryStatus.data ? !masteryStatus.data.unlocked : false;
  // Resolve the prerequisite's display name from the cached deck list for a
  // helpful tooltip ("Maîtrise d'abord {name}").
  const allDecks = useDecks({ enabled: hasPrerequisite });
  const prerequisiteName =
    allDecks.data?.find((d) => d.id === deck.prerequisite_deck_id)?.name ?? "le deck prérequis";
  const [editOpen, setEditOpen] = useState(false);
  const [podcastOpen, setPodcastOpen] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const cardCount = stats.data?.total_cards ?? 0;
  // Podcast generation makes sense only when the deck has enough material;
  // the backend enforces the same floor (≥3 cards).
  const canPodcast = cardCount >= 3;

  const deleteDeck = useDeleteDeck({
    onSuccess: () => {
      toast({ title: "Deck supprimé", description: `« ${deck.name} » a été supprimé.` });
      setConfirmDelete(false);
    },
    onError: (err) => {
      toast({
        title: "Suppression impossible",
        description: err.message,
        variant: "destructive",
      });
    },
  });

  function go() {
    void navigate({ to: "/decks/$deckId", params: { deckId: deck.id } });
  }

  return (
    <>
      <motion.div
        whileHover={{ y: -2 }}
        transition={{ type: "spring", stiffness: 300, damping: 25 }}
      >
        <Card
          className="group relative cursor-pointer overflow-hidden transition-shadow hover:shadow-md"
          onClick={go}
          onKeyDown={(e) => {
            if (e.key === "Enter" || e.key === " ") {
              e.preventDefault();
              go();
            }
          }}
          role="button"
          tabIndex={0}
        >
          <span
            aria-hidden
            className="absolute inset-y-0 left-0 w-1.5"
            style={{ background: deck.color }}
          />
          <span
            className="absolute right-12 top-3 text-[10px] uppercase tracking-wide text-muted-foreground"
            title={`Algorithme de scheduling : ${schedulerLabel(deck.scheduler_kind)}`}
          >
            {schedulerLabel(deck.scheduler_kind)}
          </span>
          <CardContent className="space-y-3 p-5 pl-6">
            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0 flex-1">
                <h3 className="truncate text-lg font-semibold leading-tight">{deck.name}</h3>
                <p className="mt-1 line-clamp-2 min-h-[2.5rem] text-sm text-muted-foreground">
                  {deck.description ?? "Pas de description."}
                </p>
              </div>
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-8 w-8 opacity-60 hover:opacity-100"
                    aria-label="Actions du deck"
                    onClick={(e) => e.stopPropagation()}
                    onKeyDown={(e) => e.stopPropagation()}
                  >
                    <MoreVertical className="h-4 w-4" />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end">
                  <DropdownMenuItem
                    disabled={locked}
                    title={locked ? `Maîtrise d'abord ${prerequisiteName}` : undefined}
                    onSelect={() => {
                      if (locked) return;
                      void navigate({
                        to: "/review/$deckId",
                        params: { deckId: deck.id },
                      });
                    }}
                  >
                    {locked ? <Lock className="h-4 w-4" /> : <Play className="h-4 w-4" />}
                    Étudier
                  </DropdownMenuItem>
                  <DropdownMenuItem onSelect={() => setEditOpen(true)}>
                    <Pencil className="h-4 w-4" />
                    Éditer
                  </DropdownMenuItem>
                  {canPodcast && (
                    <DropdownMenuItem onSelect={() => setPodcastOpen(true)}>
                      <Mic2 className="h-4 w-4" />
                      Podcast
                    </DropdownMenuItem>
                  )}
                  <DropdownMenuSeparator />
                  <DropdownMenuItem
                    onSelect={() => setConfirmDelete(true)}
                    className="text-destructive focus:text-destructive"
                  >
                    <Trash2 className="h-4 w-4" />
                    Supprimer
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            </div>

            <div className="flex flex-wrap items-center gap-1.5 pt-1">
              {stats.data ? (
                <>
                  <Badge
                    variant={stats.data.due_today > 0 ? "default" : "secondary"}
                    className="font-medium"
                  >
                    {stats.data.due_today} dues
                  </Badge>
                  <Badge variant="outline">{stats.data.new_cards} new</Badge>
                  <Badge variant="outline" className="inline-flex items-center gap-1">
                    <BookOpen className="h-3 w-3" />
                    {stats.data.total_cards} total
                  </Badge>
                  {masteryLevel && (
                    <Badge
                      variant="outline"
                      className={`border font-medium ${masteryLevel.tone}`}
                      title="Niveau de maîtrise dominant — basé sur la stabilité FSRS"
                    >
                      {masteryLevel.label}
                    </Badge>
                  )}
                  {locked && (
                    <Badge
                      variant="outline"
                      className="inline-flex items-center gap-1 border-amber-500/40 bg-amber-500/10 font-medium text-amber-700 dark:text-amber-300"
                      title={`Maîtrise d'abord ${prerequisiteName} (≥90% de rétention)`}
                    >
                      <Lock className="h-3 w-3" />
                      Verrouillé
                    </Badge>
                  )}
                </>
              ) : (
                <span className="text-xs text-muted-foreground">Chargement…</span>
              )}
            </div>
          </CardContent>
        </Card>
      </motion.div>

      <EditDeckDialog deck={deck} open={editOpen} onOpenChange={setEditOpen} />

      {canPodcast && (
        <DeckPodcastDialog
          deckId={deck.id}
          deckName={deck.name}
          open={podcastOpen}
          onOpenChange={setPodcastOpen}
        />
      )}

      <AlertDialog open={confirmDelete} onOpenChange={setConfirmDelete}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Supprimer « {deck.name} » ?</AlertDialogTitle>
            <AlertDialogDescription>
              Toutes les cartes et tout l'historique des reviews seront perdus. Cette action est
              irréversible.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Annuler</AlertDialogCancel>
            <AlertDialogAction
              onClick={(e) => {
                e.preventDefault();
                deleteDeck.mutate(deck.id);
              }}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              {deleteDeck.isPending ? "Suppression…" : "Supprimer"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
