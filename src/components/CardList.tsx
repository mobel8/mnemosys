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
import { convertFileSrc } from "@tauri-apps/api/core";
import {
  AlertTriangle,
  Brush,
  ChevronLeft,
  ChevronRight,
  ImagePlus,
  Layers,
  Lightbulb,
  Loader2,
  MoreHorizontal,
  PauseCircle,
  Pencil,
  PlayCircle,
  RotateCcw,
  SearchX,
  Trash2,
} from "lucide-react";
import { memo, useMemo, useState } from "react";
import { NoteEditor } from "@/components/NoteEditor";
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
  useCardSketches,
  useCardsInDeck,
  useDeleteNote,
  useGenerateMnemonic,
  useGenerateMnemonicImage,
  useResetCard,
  useSearchNotes,
  useSuspendCard,
} from "@/lib/queries";
import type { CardState, CardWithNote, Note, NoteTemplate } from "@/lib/tauri";
import { cn } from "@/lib/utils";

const PAGE_SIZE = 25;
const SEARCH_LIMIT = 50;

/** Stable keys for the placeholder skeleton rows/tiles (avoids index keys). */
const SKELETON_KEYS = ["s1", "s2", "s3", "s4", "s5", "s6"] as const;

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

/** French display label for an FSRS card state (the value stays `CardState`). */
function stateLabel(state: CardState): string {
  switch (state) {
    case "new":
      return "Nouvelle";
    case "learning":
      return "Apprentissage";
    case "review":
      return "Révision";
    case "relearning":
      return "Réapprentissage";
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

/** Cap a preview string for use inside confirmation dialogs (P070). Trims to
 *  ~60 chars on a word boundary when possible, adding an ellipsis. */
function truncatePreview(text: string, max = 60): string {
  const clean = text.trim();
  if (clean.length <= max) return clean;
  const slice = clean.slice(0, max);
  const lastSpace = slice.lastIndexOf(" ");
  return `${(lastSpace > max * 0.6 ? slice.slice(0, lastSpace) : slice).trimEnd()}…`;
}

/**
 * Format a card's `last_review` timestamp. The backend stores it as Unix
 * *seconds* (`Utc::now().timestamp()`), so we convert to milliseconds before
 * building the Date — otherwise every review reads as Jan 1970.
 */
function formatTimestamp(unixSeconds: number | null): string {
  if (!unixSeconds || !Number.isFinite(unixSeconds)) return "—";
  const date = new Date(unixSeconds * 1000);
  if (Number.isNaN(date.getTime())) return "—";
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(date);
}

/**
 * Format a sketch `created_at` (stored as Unix *seconds* by the Rust backend
 * via `Utc::now().timestamp()`) into a localized date + time. Converts to
 * milliseconds first; falls back to «—» on garbage.
 */
function formatSketchDate(unixSeconds: number): string {
  if (!Number.isFinite(unixSeconds) || unixSeconds <= 0) return "—";
  const date = new Date(unixSeconds * 1000);
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
      // `search_notes` is global (no deck filter server-side), so we MUST scope
      // the results to the current deck here — otherwise a search inside deck A
      // would surface notes living in deck B (cross-deck leak). The filter is
      // intentionally strict equality on `deck_id` with no escape hatch.
      return notes
        .filter((n) => n.deck_id === deckId)
        .map<DisplayRow>((note) => ({ kind: "note", note }));
    }
    return (cards.data ?? []).map<DisplayRow>((entry) => ({ kind: "card", entry }));
  }, [searching, search.data, cards.data, deckId]);

  const isLoading = searching ? search.isLoading : cards.isLoading;
  const isError = searching ? search.error : cards.error;
  const hasMore = !searching && (cards.data?.length ?? 0) === PAGE_SIZE;

  return (
    <div className="space-y-3">
      {isLoading ? (
        <div className="overflow-hidden rounded-xl border bg-card shadow-sm">
          <div className="divide-y">
            {SKELETON_KEYS.map((key) => (
              <div key={key} className="flex items-center gap-4 px-4 py-3.5">
                <div className="h-4 flex-1 animate-pulse rounded-lg bg-muted" />
                <div className="hidden h-5 w-20 animate-pulse rounded-full bg-muted md:block" />
                <div className="h-5 w-16 animate-pulse rounded-full bg-muted" />
                <div className="h-8 w-8 animate-pulse rounded-lg bg-muted" />
              </div>
            ))}
          </div>
        </div>
      ) : isError ? (
        <div className="flex items-start gap-3 rounded-xl border border-destructive/40 bg-destructive/5 p-4 text-sm shadow-sm">
          <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0 text-destructive" />
          <div>
            <p className="font-medium text-destructive">Impossible de charger les cartes</p>
            <p className="mt-0.5 text-muted-foreground">{isError.message}</p>
          </div>
        </div>
      ) : rows.length === 0 ? (
        <div className="flex flex-col items-center justify-center gap-3 rounded-xl border bg-card px-6 py-14 text-center shadow-sm">
          {searching ? (
            <SearchX className="h-9 w-9 text-brand-500" />
          ) : (
            <Layers className="h-9 w-9 text-brand-500" />
          )}
          <div className="space-y-1">
            <p className="font-display text-lg font-semibold">
              {searching ? "Aucun résultat" : "Aucune carte dans ce deck"}
            </p>
            <p className="max-w-sm text-sm text-muted-foreground">
              {searching
                ? "Aucune note ne correspond à ta recherche. Essaie d'autres mots-clés."
                : "Ajoute ta première carte pour commencer à réviser ce deck."}
            </p>
          </div>
        </div>
      ) : (
        <div className="overflow-hidden rounded-xl border bg-card shadow-sm">
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
            Page <span className="font-mono tabular-nums">{page + 1}</span>
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

const CardRow = memo(function CardRow({ row }: { row: DisplayRow }) {
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
        description:
          "La carte repart à l'état « nouvelle ». L'historique des révisions est conservé.",
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

  // Vague 22 — mnemonic image (DALL·E). Same high-lapse gate; the generated
  // PNG path is shown in its own dialog via convertFileSrc().
  const [imageOpen, setImageOpen] = useState(false);
  const [imagePath, setImagePath] = useState<string | null>(null);
  const generateImage = useGenerateMnemonicImage({
    onSuccess: (path) => setImagePath(path),
    onError: (err) => {
      setImageOpen(false);
      toast({
        title: "Image mnémotechnique indisponible",
        description: err.message,
        variant: "destructive",
      });
    },
  });

  function handleGenerateMnemonicImage() {
    if (!card) return;
    setImagePath(null);
    setImageOpen(true);
    generateImage.mutate({ cardId: card.id });
  }

  // Vague 7/25 — sketch-before-flip history. The drawings are saved during
  // review; this dialog replays them for the card. Only available when we have
  // a real card (search-result rows carry only the note, no card id).
  const [sketchesOpen, setSketchesOpen] = useState(false);

  // P009 — in-place editor for the note's content. Reuses <NoteEditor> in edit
  // mode (template locked, submit via useUpdateNote).
  const [editOpen, setEditOpen] = useState(false);

  // P070 — destructive confirmations via AlertDialog (Radix) instead of the
  // native window.confirm (consistent styling + a11y focus restitution).
  const [confirmReset, setConfirmReset] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);

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
          <p className="mt-0.5 text-xs text-muted-foreground">
            Carte n<span className="align-baseline">°</span>
            <span className="font-mono tabular-nums">{card.card_ord + 1}</span>
          </p>
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
          <Badge variant={stateBadgeVariant(card.state)}>{stateLabel(card.state)}</Badge>
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
            <DropdownMenuItem onSelect={() => setEditOpen(true)}>
              <Pencil className="h-4 w-4" /> Éditer
            </DropdownMenuItem>
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
              <DropdownMenuItem onSelect={() => setConfirmReset(true)}>
                <RotateCcw className="h-4 w-4" /> Réinitialiser (FSRS)
              </DropdownMenuItem>
            )}
            {card && (
              <DropdownMenuItem onSelect={() => setSketchesOpen(true)}>
                <Brush className="h-4 w-4" /> Voir les croquis
              </DropdownMenuItem>
            )}
            {showMnemonicItem && (
              <DropdownMenuItem onSelect={() => handleGenerateMnemonic()}>
                <Lightbulb className="h-4 w-4" /> Aide mnémotechnique
              </DropdownMenuItem>
            )}
            {showMnemonicItem && (
              <DropdownMenuItem onSelect={() => handleGenerateMnemonicImage()}>
                <ImagePlus className="h-4 w-4" /> Image mnémotechnique
              </DropdownMenuItem>
            )}
            <DropdownMenuSeparator />
            <DropdownMenuItem
              className="text-destructive focus:text-destructive"
              onSelect={() => setConfirmDelete(true)}
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

        {/* Vague 22 — mnemonic image dialog for high-lapse cards. */}
        <Dialog open={imageOpen} onOpenChange={setImageOpen}>
          <DialogContent data-testid="mnemonic-image-dialog">
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2">
                <ImagePlus className="h-5 w-5 text-primary" />
                Image mnémotechnique
              </DialogTitle>
              <DialogDescription>{noteFrontPreview(note)}</DialogDescription>
            </DialogHeader>
            {generateImage.isPending ? (
              <div
                className="flex items-center gap-2 text-sm text-muted-foreground"
                data-testid="mnemonic-image-loading"
              >
                <Loader2 className="h-4 w-4 animate-spin" />
                Génération de l'image (DALL·E)…
              </div>
            ) : imagePath ? (
              <img
                src={convertFileSrc(imagePath)}
                alt={`Aide visuelle pour « ${noteFrontPreview(note)} »`}
                className="w-full rounded-lg border"
                data-testid="mnemonic-image"
              />
            ) : null}
          </DialogContent>
        </Dialog>

        {/* Vague 7/25 — past sketches captured before flipping this card. */}
        {card && (
          <SketchHistoryDialog
            cardId={card.id}
            cardLabel={noteFrontPreview(note)}
            open={sketchesOpen}
            onOpenChange={setSketchesOpen}
          />
        )}

        {/* P009 — edit the note's content in place. The editor is keyed by the
            note id so it re-initialises cleanly each time it opens. */}
        <Dialog open={editOpen} onOpenChange={setEditOpen}>
          <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-2xl">
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2">
                <Pencil className="h-5 w-5 text-primary" />
                Éditer la note
              </DialogTitle>
              <DialogDescription>{noteFrontPreview(note)}</DialogDescription>
            </DialogHeader>
            {editOpen && (
              <NoteEditor
                key={note.id}
                deckId={note.deck_id}
                note={note}
                onUpdated={() => setEditOpen(false)}
              />
            )}
          </DialogContent>
        </Dialog>

        {/* P070 — reset confirmation (Radix AlertDialog: focus restitution,
            consistent styling). Only mounted for real cards. */}
        {card && (
          <AlertDialog open={confirmReset} onOpenChange={setConfirmReset}>
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>Réinitialiser cette carte ?</AlertDialogTitle>
                <AlertDialogDescription>
                  « {truncatePreview(noteFrontPreview(note))} » repart en « Nouvelle ». L'historique
                  des reviews est conservé.
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel>Annuler</AlertDialogCancel>
                <AlertDialogAction onClick={() => resetCard.mutate(card.id)}>
                  Réinitialiser
                </AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
        )}

        {/* P070 — delete confirmation. Supprimer une note retire la note et
            toutes les cartes qu'elle a engendrées (cloze/reverse/occlusion). */}
        <AlertDialog open={confirmDelete} onOpenChange={setConfirmDelete}>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Supprimer cette note ?</AlertDialogTitle>
              <AlertDialogDescription>
                « {truncatePreview(noteFrontPreview(note))} » et toutes les cartes qu'elle a
                générées seront définitivement supprimées. Cette action est irréversible.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>Annuler</AlertDialogCancel>
              <AlertDialogAction
                onClick={() => deleteNote.mutate(note.id)}
                className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              >
                Supprimer
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </td>
    </tr>
  );
});

/** Cap on how many past sketches to fetch/show (backend also caps at 50). */
const SKETCH_HISTORY_LIMIT = 24;

/**
 * Replay the sketch-before-flip drawings saved for a card. Each `sketch_data`
 * is already a base64-encoded PNG (`data:image/png;base64,…` or a bare base64
 * payload), so it renders directly — no `convertFileSrc`. The query is gated on
 * `open` so we don't fetch until the dialog is actually shown.
 */
function SketchHistoryDialog({
  cardId,
  cardLabel,
  open,
  onOpenChange,
}: {
  cardId: number;
  cardLabel: string;
  open: boolean;
  onOpenChange: (v: boolean) => void;
}) {
  const sketches = useCardSketches(cardId, SKETCH_HISTORY_LIMIT, { enabled: open });

  /** Normalise the stored payload to a usable `src`, tolerating both forms. */
  function toSrc(data: string): string {
    return data.startsWith("data:") ? data : `data:image/png;base64,${data}`;
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-2xl" data-testid="sketch-history-dialog">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Brush className="h-5 w-5 text-primary" />
            Croquis de rappel
          </DialogTitle>
          <DialogDescription>{cardLabel}</DialogDescription>
        </DialogHeader>
        {sketches.isLoading ? (
          <div
            role="status"
            aria-busy="true"
            aria-label="Chargement des croquis"
            className="grid max-h-[60vh] grid-cols-2 gap-3 overflow-y-auto sm:grid-cols-3"
            data-testid="sketch-history-loading"
          >
            {SKELETON_KEYS.map((key) => (
              <div key={key} className="aspect-[4/3] w-full animate-pulse rounded-lg bg-muted" />
            ))}
          </div>
        ) : sketches.data && sketches.data.length > 0 ? (
          <div className="grid max-h-[60vh] grid-cols-2 gap-3 overflow-y-auto sm:grid-cols-3">
            {sketches.data.map((sketch) => (
              <figure
                key={`${sketch.review_id}-${sketch.created_at}`}
                className="space-y-1"
                data-testid="sketch-history-item"
              >
                <img
                  src={toSrc(sketch.sketch_data)}
                  alt={`Croquis du ${formatSketchDate(sketch.created_at)}`}
                  className="aspect-[4/3] w-full rounded-lg border bg-white object-contain"
                />
                <figcaption className="text-center text-[11px] text-muted-foreground">
                  {formatSketchDate(sketch.created_at)}
                </figcaption>
              </figure>
            ))}
          </div>
        ) : (
          <p className="text-sm text-muted-foreground" data-testid="sketch-history-empty">
            Aucun croquis pour cette carte. Active le « croquis avant de retourner » dans les modes
            de révision pour en capturer.
          </p>
        )}
      </DialogContent>
    </Dialog>
  );
}
