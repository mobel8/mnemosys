/**
 * Single deck tile rendered inside `<DeckGrid>`.
 *
 * Encapsulates the stats fetch (per-deck), the action menu (study / edit /
 * delete) and the deletion confirmation flow so the parent grid stays
 * pure layout.
 */

import { useNavigate } from "@tanstack/react-router";
import { motion } from "framer-motion";
import { BookOpen, MoreVertical, Pencil, Play, Trash2 } from "lucide-react";
import { useState } from "react";
import { EditDeckDialog } from "@/components/EditDeckDialog";
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
import { useDeckStats, useDeleteDeck } from "@/lib/queries";
import type { Deck } from "@/lib/tauri";

interface DeckCardProps {
  deck: Deck;
}

export function DeckCard({ deck }: DeckCardProps) {
  const navigate = useNavigate();
  const stats = useDeckStats(deck.id);
  const [editOpen, setEditOpen] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);

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
                    onSelect={() => {
                      void navigate({
                        to: "/review/$deckId",
                        params: { deckId: deck.id },
                      });
                    }}
                  >
                    <Play className="h-4 w-4" />
                    Étudier
                  </DropdownMenuItem>
                  <DropdownMenuItem onSelect={() => setEditOpen(true)}>
                    <Pencil className="h-4 w-4" />
                    Éditer
                  </DropdownMenuItem>
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
                </>
              ) : (
                <span className="text-xs text-muted-foreground">Chargement…</span>
              )}
            </div>
          </CardContent>
        </Card>
      </motion.div>

      <EditDeckDialog deck={deck} open={editOpen} onOpenChange={setEditOpen} />

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
