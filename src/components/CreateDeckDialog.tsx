/**
 * Dialog for creating a new deck. Owns its form state locally; on submit it
 * dispatches `useCreateDeck` and shows a toast on success. The TanStack
 * Query invalidation lives inside the mutation hook so the deck grid
 * refreshes automatically.
 */

import { useState } from "react";
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Slider } from "@/components/ui/slider";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "@/components/ui/use-toast";
import { LANGUAGE_OPTIONS } from "@/lib/languages";
import { useCreateDeck, useDecks } from "@/lib/queries";
import { cn } from "@/lib/utils";

const DECK_COLORS = [
  "#3b82f6",
  "#ef4444",
  "#10b981",
  "#f59e0b",
  "#8b5cf6",
  "#ec4899",
  "#06b6d4",
  "#6b7280",
] as const;

interface CreateDeckDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function CreateDeckDialog({ open, onOpenChange }: CreateDeckDialogProps) {
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [color, setColor] = useState<string>(DECK_COLORS[0]);
  const [retention, setRetention] = useState(0.9);
  const [languageMode, setLanguageMode] = useState<string | null>(null);
  // Vague 15 — optional Bloom mastery-gate prerequisite.
  const [prerequisiteDeckId, setPrerequisiteDeckId] = useState<number | null>(null);
  const decks = useDecks();

  const createDeck = useCreateDeck({
    onSuccess: (deck) => {
      toast({ title: "Deck créé", description: `« ${deck.name} » a été ajouté.` });
      reset();
      onOpenChange(false);
    },
    onError: (err) => {
      toast({
        title: "Impossible de créer le deck",
        description: err.message,
        variant: "destructive",
      });
    },
  });

  function reset() {
    setName("");
    setDescription("");
    setColor(DECK_COLORS[0]);
    setRetention(0.9);
    setLanguageMode(null);
    setPrerequisiteDeckId(null);
  }

  function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    const trimmed = name.trim();
    if (trimmed.length === 0) {
      toast({
        title: "Nom requis",
        description: "Donne un nom à ton deck (1 à 100 caractères).",
        variant: "destructive",
      });
      return;
    }
    if (trimmed.length > 100) {
      toast({
        title: "Nom trop long",
        description: "Maximum 100 caractères.",
        variant: "destructive",
      });
      return;
    }
    if (description.length > 500) {
      toast({
        title: "Description trop longue",
        description: "Maximum 500 caractères.",
        variant: "destructive",
      });
      return;
    }
    createDeck.mutate({
      name: trimmed,
      description: description.trim() || null,
      color,
      desiredRetention: retention,
      languageMode,
      prerequisiteDeckId,
    });
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) reset();
        onOpenChange(next);
      }}
    >
      <DialogContent>
        <form onSubmit={handleSubmit} className="space-y-4">
          <DialogHeader>
            <DialogTitle>Nouveau deck</DialogTitle>
            <DialogDescription>
              Configure un paquet de cartes. Tu pourras tout modifier plus tard.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-2">
            <Label htmlFor="deck-name">Nom</Label>
            <Input
              id="deck-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              maxLength={100}
              placeholder="Vocabulaire japonais"
              autoFocus
              required
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="deck-description">Description</Label>
            <Textarea
              id="deck-description"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              maxLength={500}
              placeholder="Optionnel"
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
            <p className="text-xs text-muted-foreground">
              Probabilité de te rappeler une carte juste avant sa prochaine review. 90% est un bon
              défaut. Ignoré pour SM-2 et Leitner (algorithmes déterministes).
            </p>
          </div>

          <div className="space-y-2">
            <Label htmlFor="deck-language">Langue du deck</Label>
            <Select
              value={languageMode ?? "none"}
              onValueChange={(value) => setLanguageMode(value === "none" ? null : value)}
            >
              <SelectTrigger id="deck-language">
                <SelectValue placeholder="Aucune" />
              </SelectTrigger>
              <SelectContent>
                {LANGUAGE_OPTIONS.map((opt) => (
                  <SelectItem key={opt.code ?? "none"} value={opt.code ?? "none"}>
                    {opt.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <p className="text-xs text-muted-foreground">
              Active le mode langue : carte « Phrase » bidirectionnelle et suivi de couverture
              lexicale.
            </p>
          </div>

          <div className="space-y-2">
            <Label htmlFor="deck-prerequisite">Deck prérequis</Label>
            <Select
              value={prerequisiteDeckId != null ? String(prerequisiteDeckId) : "none"}
              onValueChange={(value) =>
                setPrerequisiteDeckId(value === "none" ? null : Number(value))
              }
            >
              <SelectTrigger id="deck-prerequisite">
                <SelectValue placeholder="Aucun" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="none">Aucun</SelectItem>
                {(decks.data ?? []).map((d) => (
                  <SelectItem key={d.id} value={String(d.id)}>
                    {d.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <p className="text-xs text-muted-foreground">
              Mastery gating (Bloom) : ce deck reste verrouillé tant que le prérequis n'atteint pas
              90% de rétention.
            </p>
          </div>

          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              Annuler
            </Button>
            <Button type="submit" disabled={createDeck.isPending}>
              {createDeck.isPending ? "Création…" : "Créer le deck"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

export { DECK_COLORS };
