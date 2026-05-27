/**
 * `<PalaceReview />` — walk-through review mode for a memory palace.
 *
 * The user is "teleported" to each locus in `ordinal` order. At every
 * stop the card front shows in an overlay; clicking "Retourner" flips to
 * the back and surfaces a "Suivant" button. This V9 release stays in
 * "preview" mode (no FSRS submission) — the existing review session route
 * already covers the SRS path. Pinning cards to loci is the headline UX;
 * scheduled review through palaces will land in a follow-up release.
 */

import { useQueries } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { ArrowLeft, ArrowRight, RotateCw } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { PalaceScene } from "@/components/palaces/PalaceScene";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { useDecks, usePalace } from "@/lib/queries";
import { api, type CardWithNote, type PalaceLocus } from "@/lib/tauri";

interface PalaceReviewProps {
  palaceId: number;
}

export function PalaceReview({ palaceId }: PalaceReviewProps) {
  const palaceQ = usePalace(palaceId);
  const decksQ = useDecks();
  const navigate = useNavigate();
  const [cursor, setCursor] = useState(0);
  const [showBack, setShowBack] = useState(false);

  // Reset when the palace changes. We DO want palaceId in the dep array
  // even though it isn't read inside the body — the goal is "re-run when
  // the route param changes".
  // biome-ignore lint/correctness/useExhaustiveDependencies: palaceId is the trigger, not a read.
  useEffect(() => {
    setCursor(0);
    setShowBack(false);
  }, [palaceId]);

  if (palaceQ.isLoading) {
    return (
      <div className="flex h-full items-center justify-center p-6 text-sm text-muted-foreground">
        Chargement…
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
  const decks = decksQ.data ?? [];

  if (palace.loci.length === 0) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-4 p-6 text-center">
        <p className="text-sm text-muted-foreground">
          Aucun locus dans ce palace. Place au moins une carte avant de réviser.
        </p>
        <Button
          variant="outline"
          onClick={() =>
            navigate({
              to: "/palaces/$palaceId",
              params: { palaceId: palace.id },
            })
          }
        >
          Retourner à l'éditeur
        </Button>
      </div>
    );
  }

  // Clamp + narrow — `loci[cursor]` is `T | undefined` under noUncheckedIndexedAccess.
  const safeCursor = Math.min(Math.max(cursor, 0), palace.loci.length - 1);
  const activeLocus = palace.loci[safeCursor];
  if (!activeLocus) {
    // Unreachable because we already returned for an empty palace; needed
    // for static type narrowing.
    return null;
  }

  return (
    <div className="flex h-full w-full flex-col">
      <header className="flex items-center justify-between gap-2 border-b bg-background/80 p-3 backdrop-blur">
        <div className="min-w-0">
          <h2 className="truncate text-lg font-semibold tracking-tight">
            {palace.name} — mode review
          </h2>
          <p className="truncate text-xs text-muted-foreground">
            Locus {cursor + 1} / {palace.loci.length}
          </p>
        </div>
        <div className="flex gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={() =>
              navigate({
                to: "/palaces/$palaceId",
                params: { palaceId: palace.id },
              })
            }
          >
            Quitter
          </Button>
        </div>
      </header>

      <div className="relative h-[calc(100%-3.5rem)] w-full bg-muted/20">
        <PalaceScene
          template={palace.template}
          loci={palace.loci}
          mode="review"
          activeLocusIndex={cursor}
          cameraTarget={[activeLocus.x, activeLocus.y, activeLocus.z]}
        />

        <LocusOverlay
          locus={activeLocus}
          cursor={cursor}
          total={palace.loci.length}
          showBack={showBack}
          decks={decks}
          onFlip={() => setShowBack((v) => !v)}
          onPrev={() => {
            setCursor((c) => Math.max(0, c - 1));
            setShowBack(false);
          }}
          onNext={() => {
            setCursor((c) => Math.min(palace.loci.length - 1, c + 1));
            setShowBack(false);
          }}
        />
      </div>
    </div>
  );
}

interface LocusOverlayProps {
  locus: PalaceLocus;
  cursor: number;
  total: number;
  showBack: boolean;
  decks: Array<{ id: number; name: string }>;
  onFlip: () => void;
  onPrev: () => void;
  onNext: () => void;
}

function LocusOverlay({
  locus,
  cursor,
  total,
  showBack,
  decks,
  onFlip,
  onPrev,
  onNext,
}: LocusOverlayProps) {
  return (
    <div className="pointer-events-none absolute inset-x-0 bottom-6 flex justify-center px-4">
      <Card className="pointer-events-auto w-full max-w-xl border-2 shadow-2xl backdrop-blur">
        <CardContent className="space-y-3 p-4">
          <div className="flex items-center gap-2">
            <Badge variant="secondary">#{cursor + 1}</Badge>
            <span className="flex-1 truncate text-xs text-muted-foreground">
              {locus.label ?? `Locus card_id=${locus.card_id}`}
            </span>
          </div>

          <LocusCardBody locusCardId={locus.card_id} decks={decks} showBack={showBack} />

          <div className="flex items-center justify-between gap-2 pt-1">
            <Button
              variant="outline"
              size="sm"
              onClick={onPrev}
              disabled={cursor === 0}
              className="gap-1"
            >
              <ArrowLeft className="h-3 w-3" /> Précédent
            </Button>
            <Button variant="default" size="sm" onClick={onFlip} className="gap-1">
              <RotateCw className="h-3 w-3" /> {showBack ? "Recto" : "Verso"}
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={onNext}
              disabled={cursor === total - 1}
              className="gap-1"
            >
              Suivant <ArrowRight className="h-3 w-3" />
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

/**
 * Resolves the card content for the active locus. We don't have a
 * `get_card_by_id` Tauri command yet, so we fetch all cards from every
 * deck the user owns and build a single lookup map. For typical decks
 * (a few hundred cards) this stays well under a beat.
 */
function LocusCardBody({
  locusCardId,
  decks,
  showBack,
}: {
  locusCardId: number;
  decks: Array<{ id: number; name: string }>;
  showBack: boolean;
}) {
  // Fan-out per-deck fetch via `useQueries` so we stay on the hooks-at-top
  // rule even when the decks list changes shape between renders. Caching
  // keeps repeats free, and we cap per-deck fetch at 500 cards (covers
  // virtually every learner).
  const results = useQueries({
    queries: decks.map((d) => ({
      queryKey: ["cards-in-deck", d.id, 500, 0] as const,
      queryFn: () => api.cards.listInDeck(d.id, 500, 0),
      enabled: Number.isFinite(d.id),
    })),
  });
  // Re-derive when any per-deck query refetches. We feed both the array
  // identity (`results`) and the join of updatedAt timestamps so React's
  // exhaustive-deps rule sees a real dependency yet we still benefit from
  // structural change-detection via the joined string.
  const updateKey = results.map((r) => r.dataUpdatedAt).join(",");
  // biome-ignore lint/correctness/useExhaustiveDependencies: updateKey is the structural fingerprint of `results`.
  const lookup = useMemo(() => {
    const map = new Map<number, CardWithNote>();
    for (const r of results) {
      for (const cwn of (r.data as CardWithNote[] | undefined) ?? []) {
        map.set(cwn.card.id, cwn);
      }
    }
    return map;
  }, [updateKey]);
  const cwn = lookup.get(locusCardId);
  if (!cwn) {
    return <p className="text-sm text-muted-foreground">Carte introuvable (id={locusCardId})</p>;
  }
  const front = readField(cwn.note.fields, "front") ?? readField(cwn.note.fields, "text") ?? "—";
  const back = readField(cwn.note.fields, "back") ?? "—";
  return (
    <div className="rounded-md border bg-card/60 p-3">
      <p className="text-[10px] uppercase tracking-wider text-muted-foreground">
        {showBack ? "Verso" : "Recto"}
      </p>
      <p className="mt-1 text-sm leading-snug">{showBack ? back : front}</p>
    </div>
  );
}

function readField(fields: Record<string, unknown>, key: string): string | null {
  const v = fields[key];
  return typeof v === "string" ? v : null;
}
