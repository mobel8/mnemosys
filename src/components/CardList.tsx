/**
 * Paginated table of cards inside a deck, with inline search.
 *
 * Two modes:
 *   - Search active (`searchQuery` >= 2 chars): switch to `useSearchNotes`,
 *     pagination disabled (search returns at most `SEARCH_LIMIT` rows).
 *   - Default: `useCardsInDeck` with a simple limit/offset pager.
 *
 * The card row supports suspend / unsuspend and delete, with optimistic
 * toasts. Editing is delegated to a future dedicated edit dialog (B2 wave
 * scope ends at "Add card"; updating an existing card lives in C1/C2).
 */

import { useNavigate } from "@tanstack/react-router";
import {
  ChevronLeft,
  ChevronRight,
  Lightbulb,
  Loader2,
  MoreHorizontal,
  PauseCircle,
  PlayCircle,
  RotateCcw,
  Trash2,
} from "lucide-react";
import { useMemo, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { toast } from "@/components/ui/use-toast";
import {
  useCardsInDeck,
  useDeleteNote,
  useGenerateMnemonic,
  useResetCard,
  useSearchNotes,
  useSuspendCard,
} from "@/lib/queries";
import type { CardState, CardWithNote, Note, NoteTemplate } from "@/lib/tauri";
import { cn } from "@/lib/utils";

const PAGE_SIZE = 25;
const SEARCH_LIMIT = 50;

/**
 * Vague 13 — minimum FSRS `lapses` before a card is deemed « difficult »
 * enough to offer an AI mnemonic aid. Below this the menu item is hidden.
 */
const MNEMONIC_LAPSE_THRESHOLD = 3;

/** Default output language for the mnemonic helper (matches the app default). */
const MNEMONIC_LANGUAGE = "fr";

interface CardListProps {
  deckId: number;
  searchQuery?: string;
}

function templateLabel(template: NoteTemplate) {
  switch (template) {
    case "basic":
      return "Basic";
    case "basic_reverse":
      return "Reverse";
    case "cloze":
      return "Cloze";
    case "occlusion":
      return "Image-occlusion";
    case "sentence":
      return "Phrase";
    case "bidirectional":
      return "Phrase";
    case "illness_script":
      return "Médecine";
    case "refutation":
      return "Sciences";
    case "worked_example":
      return "Maths";
  }
}

function stateBadgeVariant(state: CardState): "default" | "secondary" | "outline" | "destructive" {
  switch (state) {
    case "new":
      return "secondary";
    case "learning":
      return "default";
    case "review":
      return "outline";
    case "relearning":
      return "destructive";
  }
}

function noteFrontPreview(note: Note): string {
  const fields = note.fields as Record<string, unknown>;
  if (note.template === "cloze") {
    const text = typeof fields.text === "string" ? fields.text : "";
    // Replace cloze tags with their hidden text for a readable preview.
    return text.replace(/\{\{c\d+::(.*?)(?:::.*?)?\}\}/g, "$1") || "(vide)";
  }
  if (note.template === "occlusion") {
    const masks = Array.isArray(fields.masks) ? (fields.masks as unknown[]) : [];
    const labels = masks
      .map((m) =>
        typeof m === "object" && m && typeof (m as { label?: unknown }).label === "string"
          ? ((m as { label: string }).label || "").trim()
          : "",
      )
      .filter((l) => l.length > 0);
    if (labels.length > 0)
      return `Image-occlusion : ${labels.slice(0, 3).join(", ")}${labels.length > 3 ? "…" : ""}`;
    return `Image-occlusion (${masks.length} masque${masks.length > 1 ? "s" : ""})`;
  }
  if (note.template === "sentence" || note.template === "bidirectional") {
    const src = typeof fields.source === "string" ? fields.source : "";
    return src || "(vide)";
  }
  if (note.template === "illness_script") {
    const condition = typeof fields.condition === "string" ? fields.condition : "";
    return condition || "(vide)";
  }
  if (note.template === "refutation") {
    const misconception = typeof fields.misconception === "string" ? fields.misconception : "";
    return misconception || "(vide)";
  }
  if (note.template === "worked_example") {
    const problem = typeof fields.problem === "string" ? fields.problem : "";
    return problem || "(vide)";
  }
  const front = typeof fields.front === "string" ? fields.front : "";
  return front || "(vide)";
}

function formatTimestamp(ts: number | null): string {
  if (!ts) return "—";
  const date = new Date(ts);
  if (Number.isNaN(date.getTime())) return "—";
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(date);
}

export function CardList({ deckId, searchQuery }: CardListProps) {
  const trimmedQuery = (searchQuery ?? "").trim();
  const searching = trimmedQuery.length >= 2;

  const [page, setPage] = useState(0);
  const offset = page * PAGE_SIZE;

  const cards = useCardsInDeck(deckId, PAGE_SIZE, offset, {
    enabled: !searching && Number.isFinite(deckId),
  });
  const search = useSearchNotes(trimmedQuery, SEARCH_LIMIT, {
    enabled: searching,
  });

  // Search returns Note objects (no card metadata). For consistency, render
  // them as fake "CardWithNote"-shaped placeholders flagged so the row knows
  // the per-card actions are unavailable.
  const rows = useMemo<DisplayRow[]>(() => {
    if (searching) {
      const notes = search.data ?? [];
      return notes
        .filter((n) => n.deck_id === deckId || trimmedQuery.length > 0)
        .map<DisplayRow>((note) => ({ kind: "note", note }));
    }
    return (cards.data ?? []).map<DisplayRow>((entry) => ({ kind: "card", entry }));
  }, [searching, search.data, cards.data, deckId, trimmedQuery]);

  const isLoading = searching ? search.isLoading : cards.isLoading;
  const isError = searching ? search.error : cards.error;
  const hasMore = !searching && (cards.data?.length ?? 0) === PAGE_SIZE;

  return (
    <div className="space-y-3">
      {isLoading ? (
        <div className="rounded-md border p-8 text-center text-sm text-muted-foreground">
          Chargement…
        </div>
      ) : isError ? (
        <div className="rounded-md border border-destructive/40 bg-destructive/5 p-4 text-sm text-destructive">
          Erreur : {isError.message}
        </div>
      ) : rows.length === 0 ? (
        <div className="rounded-md border border-dashed p-8 text-center text-sm text-muted-foreground">
          {searching ? "Aucune note ne correspond à ta recherche." : "Aucune carte dans ce deck."}
        </div>
      ) : (
        <div className="overflow-hidden rounded-md border">
          <table className="w-full text-sm">
            <thead className="border-b bg-muted/30 text-xs uppercase text-muted-foreground">
              <tr>
                <th className="px-4 py-2 text-left font-medium">Carte</th>
                <th className="hidden px-4 py-2 text-left font-medium md:table-cell">Template</th>
                <th className="hidden px-4 py-2 text-left font-medium lg:table-cell">Tags</th>
                <th className="px-4 py-2 text-left font-medium">État</th>
                <th className="hidden px-4 py-2 text-left font-medium lg:table-cell">
                  Dernière review
                </th>
                <th className="w-12 px-4 py-2" />
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <CardRow key={rowKey(row)} row={row} />
              ))}
            </tbody>
          </table>
        </div>
      )}

      {!searching && (cards.data?.length ?? 0) > 0 && (
        <div className="flex items-center justify-between text-sm text-muted-foreground">
          <span>
            Page {page + 1}
            {hasMore ? "" : " (fin)"}
          </span>
          <div className="flex gap-2">
            <Button
              variant="outline"
              size="sm"
              disabled={page === 0}
              onClick={() => setPage((p) => Math.max(0, p - 1))}
            >
              <ChevronLeft className="h-4 w-4" /> Précédent
            </Button>
            <Button
              variant="outline"
              size="sm"
              disabled={!hasMore}
              onClick={() => setPage((p) => p + 1)}
            >
              Suivant <ChevronRight className="h-4 w-4" />
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}

type DisplayRow = { kind: "card"; entry: CardWithNote } | { kind: "note"; note: Note };

function rowKey(row: DisplayRow): string {
  return row.kind === "card" ? `card-${row.entry.card.id}` : `note-${row.note.id}`;
}

function CardRow({ row }: { row: DisplayRow }) {
  const navigate = useNavigate();
  const note = row.kind === "card" ? row.entry.note : row.note;
  const card = row.kind === "card" ? row.entry.card : null;
  const suspended = card?.suspended ?? false;

  const suspendCard = useSuspendCard({
    onSuccess: (_d, vars) => {
      toast({
        title: vars.suspended ? "Carte suspendue" : "Carte réactivée",
      });
    },
    onError: (err) => {
      toast({
        title: "Action impossible",
        description: err.message,
        variant: "destructive",
      });
    },
  });
  const deleteNote = useDeleteNote({
    onSuccess: () => {
      toast({ title: "Note supprimée" });
    },
    onError: (err) => {
      toast({
        title: "Suppression impossible",
        description: err.message,
        variant: "destructive",
      });
    },
  });
  const resetCard = useResetCard({
    onSuccess: () => {
      toast({
        title: "Carte réinitialisée",
        description: "La carte repart en « new ». L'historique des reviews est conservé.",
      });
    },
    onError: (err) => {
      toast({
        title: "Reset impossible",
        description: err.message,
        variant: "destructive",
      });
    },
  });

  // Vague 13 — mnemonic helper. Only surfaced for high-lapse cards; the
  // generated aid lands in a controlled dialog (kept outside the dropdown so
  // the two radix overlays don't fight over focus).
  const [mnemonicOpen, setMnemonicOpen] = useState(false);
  const [mnemonic, setMnemonic] = useState<string | null>(null);
  const generateMnemonic = useGenerateMnemonic({
    onSuccess: (text) => setMnemonic(text),
    onError: (err) => {
      setMnemonicOpen(false);
      toast({
        title: "Aide mnémotechnique indisponible",
        description: err.message,
        variant: "destructive",
      });
    },
  });
  const showMnemonicItem = card != null && card.lapses >= MNEMONIC_LAPSE_THRESHOLD;

  function handleGenerateMnemonic() {
    if (!card) return;
    setMnemonic(null);
    setMnemonicOpen(true);
    generateMnemonic.mutate({ cardId: card.id, language: MNEMONIC_LANGUAGE });
  }

  return (
    <tr
      className={cn(
        "border-b last:border-b-0 transition-colors hover:bg-muted/30",
        suspended && "opacity-50",
      )}
    >
      <td className="px-4 py-3 align-top">
        <p className="line-clamp-2 font-medium">{noteFrontPreview(note)}</p>
        {card && card.card_ord > 0 && (
          <p className="mt-0.5 text-xs text-muted-foreground">Card #{card.card_ord + 1}</p>
        )}
      </td>
      <td className="hidden px-4 py-3 align-top md:table-cell">
        <Badge variant="outline">{templateLabel(note.template)}</Badge>
      </td>
      <td className="hidden px-4 py-3 align-top lg:table-cell">
        <div className="flex flex-wrap gap-1">
          {note.tags.length === 0 ? (
            <span className="text-xs text-muted-foreground">—</span>
          ) : (
            note.tags.map((tag) => (
              <Badge key={tag} variant="secondary" className="font-normal">
                {tag}
              </Badge>
            ))
          )}
        </div>
      </td>
      <td className="px-4 py-3 align-top">
        {card ? (
          <Badge variant={stateBadgeVariant(card.state)} className="capitalize">
            {card.state}
          </Badge>
        ) : (
          <span className="text-xs text-muted-foreground">—</span>
        )}
      </td>
      <td className="hidden px-4 py-3 align-top text-xs text-muted-foreground lg:table-cell">
        {formatTimestamp(card?.last_review ?? null)}
      </td>
      <td className="px-4 py-3 align-top">
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              variant="ghost"
              size="icon"
              className="h-8 w-8"
              aria-label="Actions sur la carte"
            >
              <MoreHorizontal className="h-4 w-4" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem
              onSelect={() => {
                void navigate({
                  to: "/decks/$deckId/new-card",
                  params: { deckId: note.deck_id },
                });
              }}
            >
              Ajouter une autre carte
            </DropdownMenuItem>
            {card && (
              <DropdownMenuItem
                onSelect={() => suspendCard.mutate({ id: card.id, suspended: !suspended })}
              >
                {suspended ? (
                  <>
                    <PlayCircle className="h-4 w-4" /> Réactiver
                  </>
                ) : (
                  <>
                    <PauseCircle className="h-4 w-4" /> Suspendre
                  </>
                )}
              </DropdownMenuItem>
            )}
            {card && card.state !== "new" && (
              <DropdownMenuItem
                onSelect={() => {
                  if (
                    window.confirm(
                      "Réinitialiser cette carte ? Elle repart en « new ». L'historique des reviews est conservé.",
                    )
                  ) {
                    resetCard.mutate(card.id);
                  }
                }}
              >
                <RotateCcw className="h-4 w-4" /> Réinitialiser (FSRS)
              </DropdownMenuItem>
            )}
            {showMnemonicItem && (
              <DropdownMenuItem onSelect={() => handleGenerateMnemonic()}>
                <Lightbulb className="h-4 w-4" /> Aide mnémotechnique
              </DropdownMenuItem>
            )}
            <DropdownMenuSeparator />
            <DropdownMenuItem
              className="text-destructive focus:text-destructive"
              onSelect={() => {
                if (window.confirm(`Supprimer la note « ${noteFrontPreview(note)} » ?`)) {
                  deleteNote.mutate(note.id);
                }
              }}
            >
              <Trash2 className="h-4 w-4" /> Supprimer la note
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>

        {/* Vague 13 — mnemonic aid dialog for high-lapse cards. */}
        <Dialog open={mnemonicOpen} onOpenChange={setMnemonicOpen}>
          <DialogContent data-testid="mnemonic-dialog">
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2">
                <Lightbulb className="h-5 w-5 text-primary" />
                Aide mnémotechnique
              </DialogTitle>
              <DialogDescription>{noteFrontPreview(note)}</DialogDescription>
            </DialogHeader>
            {generateMnemonic.isPending ? (
              <div
                className="flex items-center gap-2 text-sm text-muted-foreground"
                data-testid="mnemonic-loading"
              >
                <Loader2 className="h-4 w-4 animate-spin" />
                Génération de l'aide mnémotechnique…
              </div>
            ) : mnemonic ? (
              <p
                className="whitespace-pre-wrap text-sm leading-relaxed"
                data-testid="mnemonic-text"
              >
                {mnemonic}
              </p>
            ) : null}
          </DialogContent>
        </Dialog>
      </td>
    </tr>
  );
}
