/**
 * `<PalaceBuilder />` — the editor for one memory palace.
 *
 * Layout:
 *   - Left sidebar: deck picker + flat list of the deck's cards. Clicking
 *     a card selects it as the "to pin" target; the next click on the 3D
 *     floor places it at that spot.
 *   - Center: <PalaceScene /> in build mode (click-to-place enabled).
 *   - Right sidebar: ordered list of pinned loci with arrow-up/arrow-down/
 *     remove controls. Reordering rewrites every locus' ordinal so the
 *     review walk-through uses the new sequence.
 *
 * Persistence is handled through TanStack Query mutations so the UI stays
 * in sync without ad-hoc local state.
 */

import { useNavigate } from "@tanstack/react-router";
import { ArrowDown, ArrowUp, MapPin, Pin, Play, Trash2 } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { PalaceScene } from "@/components/palaces/PalaceScene";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { toast } from "@/components/ui/use-toast";
import {
  useAddPalaceLocus,
  useCardsInDeck,
  useDecks,
  usePalace,
  useRemovePalaceLocus,
  useReorderPalaceLoci,
} from "@/lib/queries";
import type { CardWithNote, PalaceWithLoci } from "@/lib/tauri";
import { cn } from "@/lib/utils";

interface PalaceBuilderProps {
  palaceId: number;
}

const CARD_PAGE_SIZE = 30;

export function PalaceBuilder({ palaceId }: PalaceBuilderProps) {
  const palaceQ = usePalace(palaceId);
  const decksQ = useDecks();
  const navigate = useNavigate();
  const [selectedDeckId, setSelectedDeckId] = useState<number | null>(null);
  const [pendingCardId, setPendingCardId] = useState<number | null>(null);

  const decks = decksQ.data ?? [];

  // Auto-select the first deck once decks are loaded — done in an effect so
  // React's no-setState-during-render rule stays happy.
  useEffect(() => {
    if (selectedDeckId === null && decks.length > 0) {
      const first = decks[0];
      if (first) {
        setSelectedDeckId(first.id);
      }
    }
  }, [selectedDeckId, decks]);

  const addLocus = useAddPalaceLocus({
    onSuccess: () => {
      toast({
        title: "Locus placé",
        description: "Tu peux le déplacer plus tard dans la barre latérale.",
      });
      setPendingCardId(null);
    },
    onError: (err) => {
      toast({
        title: "Échec du placement",
        description: err.message,
      });
    },
  });

  if (palaceQ.isLoading) {
    return (
      <div className="flex h-full items-center justify-center p-6 text-sm text-muted-foreground">
        Chargement du palace…
      </div>
    );
  }
  if (palaceQ.isError || !palaceQ.data) {
    return (
      <div className="flex h-full items-center justify-center p-6 text-sm text-destructive">
        Impossible de charger le palace.
      </div>
    );
  }

  const palace = palaceQ.data;

  return (
    <div className="flex h-full w-full flex-col">
      <header className="flex items-center justify-between gap-2 border-b bg-background/80 p-3 backdrop-blur">
        <div className="min-w-0">
          <h2 className="truncate text-lg font-semibold tracking-tight" data-testid="palace-name">
            {palace.name}
          </h2>
          <p className="truncate text-xs text-muted-foreground">
            {palace.template} · {palace.loci.length} locus
            {palace.loci.length > 1 ? "s" : ""}
          </p>
        </div>
        <Button
          variant="default"
          size="sm"
          className="gap-2"
          disabled={palace.loci.length === 0}
          onClick={() =>
            navigate({
              to: "/palaces/$palaceId/review",
              params: { palaceId: palace.id },
            })
          }
        >
          <Play className="h-4 w-4" /> Mode review
        </Button>
      </header>

      <div className="grid h-[calc(100%-3.5rem)] grid-cols-[260px_1fr_280px] gap-0">
        <DeckCardsSidebar
          decks={decks}
          selectedDeckId={selectedDeckId}
          onSelectDeck={setSelectedDeckId}
          pendingCardId={pendingCardId}
          onSelectCard={setPendingCardId}
          palace={palace}
        />

        <div className="relative h-full w-full bg-muted/20">
          <PalaceScene
            template={palace.template}
            loci={palace.loci}
            mode="build"
            onFloorClick={(xyz) => {
              if (pendingCardId === null) {
                toast({
                  title: "Sélectionne une carte d'abord",
                  description:
                    "Choisis une carte dans la colonne de gauche puis clique sur le sol.",
                });
                return;
              }
              addLocus.mutate({
                palaceId: palace.id,
                cardId: pendingCardId,
                x: xyz[0],
                y: xyz[1],
                z: xyz[2],
                label: null,
              });
            }}
          />
        </div>

        <LociSidebar palace={palace} />
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Left sidebar — deck list + card picker.
// ---------------------------------------------------------------------------

interface DeckCardsSidebarProps {
  decks: Array<{ id: number; name: string; color: string }>;
  selectedDeckId: number | null;
  onSelectDeck: (id: number) => void;
  pendingCardId: number | null;
  onSelectCard: (id: number | null) => void;
  palace: PalaceWithLoci;
}

function DeckCardsSidebar({
  decks,
  selectedDeckId,
  onSelectDeck,
  pendingCardId,
  onSelectCard,
  palace,
}: DeckCardsSidebarProps) {
  const cardsQ = useCardsInDeck(selectedDeckId ?? 0, CARD_PAGE_SIZE, 0, {
    enabled: selectedDeckId !== null,
  });
  const cards = cardsQ.data ?? [];

  // Cards already pinned in this palace shouldn't appear again — the unique
  // constraint would reject the insert anyway, so hide them up front.
  const pinnedSet = useMemo(() => new Set(palace.loci.map((l) => l.card_id)), [palace.loci]);
  const availableCards = cards.filter((c) => !pinnedSet.has(c.card.id));

  return (
    <aside className="flex h-full flex-col border-r bg-card/30" data-testid="palace-deck-sidebar">
      <div className="border-b p-3">
        <h3 className="text-sm font-medium">Decks</h3>
        <p className="mt-0.5 text-[11px] text-muted-foreground">
          Choisis une carte puis clique sur le sol.
        </p>
      </div>
      <div className="flex flex-wrap gap-1 p-2">
        {decks.map((d) => (
          <button
            key={d.id}
            type="button"
            onClick={() => onSelectDeck(d.id)}
            className={cn(
              "rounded-md border px-2 py-1 text-[11px] font-medium transition-colors",
              selectedDeckId === d.id
                ? "border-foreground bg-foreground text-background"
                : "border-border bg-card text-muted-foreground hover:bg-accent/50",
            )}
            style={selectedDeckId === d.id ? { borderColor: d.color } : undefined}
          >
            {d.name}
          </button>
        ))}
      </div>
      <ScrollArea className="flex-1">
        <div className="flex flex-col gap-1 p-2">
          {availableCards.map((c) => (
            <CardPickerRow
              key={c.card.id}
              cwn={c}
              selected={pendingCardId === c.card.id}
              onClick={() => onSelectCard(pendingCardId === c.card.id ? null : c.card.id)}
            />
          ))}
          {selectedDeckId !== null && availableCards.length === 0 && (
            <p className="p-3 text-xs text-muted-foreground">
              Toutes les cartes de ce deck sont déjà épinglées dans ce palace.
            </p>
          )}
        </div>
      </ScrollArea>
    </aside>
  );
}

function CardPickerRow({
  cwn,
  selected,
  onClick,
}: {
  cwn: CardWithNote;
  selected: boolean;
  onClick: () => void;
}) {
  const front = readField(cwn.note.fields, "front") ?? readField(cwn.note.fields, "text") ?? "—";
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "flex items-start gap-2 rounded-md border p-2 text-left text-xs transition-colors",
        selected
          ? "border-primary bg-primary/10 text-foreground"
          : "border-border bg-card/40 text-muted-foreground hover:bg-accent/40",
      )}
    >
      <Pin className="mt-0.5 h-3 w-3 shrink-0" />
      <span className="line-clamp-2">{front}</span>
    </button>
  );
}

function readField(fields: Record<string, unknown>, key: string): string | null {
  const v = fields[key];
  return typeof v === "string" ? v : null;
}

// ---------------------------------------------------------------------------
// Right sidebar — ordered loci list.
// ---------------------------------------------------------------------------

function LociSidebar({ palace }: { palace: PalaceWithLoci }) {
  const remove = useRemovePalaceLocus();
  const reorder = useReorderPalaceLoci();

  const moveBy = (idx: number, dir: -1 | 1) => {
    const next = idx + dir;
    if (next < 0 || next >= palace.loci.length) return;
    const newOrder = palace.loci.map((l) => l.id);
    const a = newOrder[idx];
    const b = newOrder[next];
    if (a === undefined || b === undefined) return;
    newOrder[idx] = b;
    newOrder[next] = a;
    reorder.mutate({ palaceId: palace.id, newOrder });
  };

  return (
    <aside className="flex h-full flex-col border-l bg-card/30" data-testid="palace-loci-sidebar">
      <div className="border-b p-3">
        <h3 className="text-sm font-medium">Loci</h3>
        <p className="mt-0.5 text-[11px] text-muted-foreground">
          Ordre du parcours en mode review.
        </p>
      </div>
      <ScrollArea className="flex-1">
        <ol className="flex flex-col gap-1 p-2">
          {palace.loci.map((l, idx) => (
            <li
              key={l.id}
              className="flex items-center gap-1 rounded-md border bg-card/50 p-2 text-xs"
            >
              <Badge variant="secondary" className="h-5 px-1.5 text-[10px]">
                #{idx + 1}
              </Badge>
              <span className="flex-1 truncate font-mono text-[11px] text-muted-foreground">
                {l.label ?? `card ${l.card_id}`}
              </span>
              <Button
                type="button"
                variant="ghost"
                size="icon"
                className="h-6 w-6"
                disabled={idx === 0}
                onClick={() => moveBy(idx, -1)}
                aria-label="Monter dans l'ordre"
              >
                <ArrowUp className="h-3 w-3" />
              </Button>
              <Button
                type="button"
                variant="ghost"
                size="icon"
                className="h-6 w-6"
                disabled={idx === palace.loci.length - 1}
                onClick={() => moveBy(idx, 1)}
                aria-label="Descendre dans l'ordre"
              >
                <ArrowDown className="h-3 w-3" />
              </Button>
              <Button
                type="button"
                variant="ghost"
                size="icon"
                className="h-6 w-6 text-destructive"
                onClick={() => remove.mutate({ locusId: l.id, palaceId: palace.id })}
                aria-label="Supprimer ce locus"
              >
                <Trash2 className="h-3 w-3" />
              </Button>
            </li>
          ))}
          {palace.loci.length === 0 && (
            <li className="flex items-center gap-2 rounded-md border border-dashed p-3 text-[11px] text-muted-foreground">
              <MapPin className="h-3 w-3" />
              Sélectionne une carte à gauche, puis clique sur le sol.
            </li>
          )}
        </ol>
      </ScrollArea>
    </aside>
  );
}
