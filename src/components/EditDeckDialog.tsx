/**
 * Dialog to edit an existing deck. Mirrors `<CreateDeckDialog>` but
 * pre-fills with the current deck and routes the submit through
 * `useUpdateDeck` (which patches only the fields that changed and
 * invalidates the deck/stats queries).
 */

import { useEffect, useState } from "react";
import { DECK_COLORS } from "@/components/CreateDeckDialog";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Slider } from "@/components/ui/slider";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "@/components/ui/use-toast";
import { useUpdateDeck } from "@/lib/queries";
import type { Deck } from "@/lib/tauri";
import { cn } from "@/lib/utils";

interface EditDeckDialogProps {
  deck: Deck;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function EditDeckDialog({ deck, open, onOpenChange }: EditDeckDialogProps) {
  const [name, setName] = useState(deck.name);
  const [description, setDescription] = useState(deck.description ?? "");
  const [color, setColor] = useState(deck.color);
  const [retention, setRetention] = useState(deck.desired_retention);

  // Reset local form whenever the deck changes or the dialog re-opens with
  // fresh data, so the user sees the current persisted values rather than
  // stale leftovers.
  useEffect(() => {
    if (open) {
      setName(deck.name);
      setDescription(deck.description ?? "");
      setColor(deck.color);
      setRetention(deck.desired_retention);
    }
  }, [deck, open]);

  const updateDeck = useUpdateDeck({
    onSuccess: () => {
      toast({ title: "Deck mis à jour" });
      onOpenChange(false);
    },
    onError: (err) => {
      toast({
        title: "Mise à jour impossible",
        description: err.message,
        variant: "destructive",
      });
    },
  });

  function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    const trimmed = name.trim();
    if (trimmed.length === 0) {
      toast({
        title: "Nom requis",
        variant: "destructive",
      });
      return;
    }
    updateDeck.mutate({
      id: deck.id,
      patch: {
        name: trimmed,
        description: description.trim() ? description.trim() : null,
        color,
        desired_retention: retention,
      },
    });
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <form onSubmit={handleSubmit} className="space-y-4">
          <DialogHeader>
            <DialogTitle>Modifier « {deck.name} »</DialogTitle>
            <DialogDescription>Édite les métadonnées du deck.</DialogDescription>
          </DialogHeader>

          <div className="space-y-2">
            <Label htmlFor="edit-deck-name">Nom</Label>
            <Input
              id="edit-deck-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              maxLength={100}
              required
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="edit-deck-description">Description</Label>
            <Textarea
              id="edit-deck-description"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              maxLength={500}
              rows={3}
            />
            <p className="text-xs text-muted-foreground">{description.length} / 500</p>
          </div>

          <div className="space-y-2">
            <Label>Couleur</Label>
            <div className="grid grid-cols-8 gap-2">
              {DECK_COLORS.map((c) => (
                <button
                  type="button"
                  key={c}
                  aria-label={`Couleur ${c}`}
                  style={{ background: c }}
                  className={cn(
                    "h-8 w-8 rounded-full ring-2 ring-offset-2 ring-offset-background transition-all",
                    color === c
                      ? "ring-foreground"
                      : "ring-transparent hover:ring-muted-foreground",
                  )}
                  onClick={() => setColor(c)}
                />
              ))}
            </div>
          </div>

          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <Label>Rétention cible</Label>
              <span className="text-sm font-medium tabular-nums">
                {Math.round(retention * 100)}%
              </span>
            </div>
            <Slider
              value={[retention]}
              min={0.8}
              max={0.97}
              step={0.01}
              onValueChange={(v) => setRetention(v[0] ?? 0.9)}
            />
          </div>

          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              Annuler
            </Button>
            <Button type="submit" disabled={updateDeck.isPending}>
              {updateDeck.isPending ? "Sauvegarde…" : "Sauvegarder"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
