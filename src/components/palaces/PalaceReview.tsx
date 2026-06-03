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

import { useNavigate } from "@tanstack/react-router";
import { motion } from "framer-motion";
import { AlertTriangle, ArrowLeft, ArrowRight, MapPin, RotateCw } from "lucide-react";
import { useEffect, useState } from "react";
import { PalaceScene } from "@/components/palaces/PalaceScene";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { useCardWithNote, usePalace } from "@/lib/queries";
import type { PalaceLocus } from "@/lib/tauri";

interface PalaceReviewProps {
  palaceId: number;
}

export function PalaceReview({ palaceId }: PalaceReviewProps) {
  const palaceQ = usePalace(palaceId);
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
      <div className="flex h-full w-full flex-col" data-testid="palace-review-loading">
        <div className="flex items-center justify-between gap-2 border-b p-3">
          <div className="space-y-2">
            <div className="h-5 w-56 animate-pulse rounded-md bg-muted" />
            <div className="h-3 w-20 animate-pulse rounded-md bg-muted" />
          </div>
          <div className="h-8 w-20 animate-pulse rounded-lg bg-muted" />
        </div>
        <div className="relative h-[calc(100%-3.5rem)] w-full animate-pulse bg-muted/40">
          <div className="pointer-events-none absolute inset-x-0 bottom-6 flex justify-center px-4">
            <div className="h-40 w-full max-w-xl animate-pulse rounded-xl bg-muted" />
          </div>
        </div>
      </div>
    );
  }
  if (palaceQ.isError || !palaceQ.data) {
    return (
      <div className="flex h-full items-center justify-center p-6">
        <Card className="border-destructive/40">
          <CardContent className="flex flex-col items-center gap-2 p-8 text-center">
            <AlertTriangle className="h-6 w-6 text-destructive" aria-hidden />
            <h3 className="font-display text-base font-semibold tracking-tight">
              Impossible de charger le palace
            </h3>
            <p className="max-w-xs text-sm text-muted-foreground">
              Réessaie ou reviens à la liste des palaces.
            </p>
          </CardContent>
        </Card>
      </div>
    );
  }

  const palace = palaceQ.data;

  if (palace.loci.length === 0) {
    return (
      <div className="flex h-full items-center justify-center p-6">
        <Card>
          <CardContent className="flex flex-col items-center gap-3 p-10 text-center">
            <div className="flex h-12 w-12 items-center justify-center rounded-full bg-brand-50 text-brand-500">
              <MapPin className="h-6 w-6" aria-hidden />
            </div>
            <h3 className="font-display text-lg font-semibold tracking-tight">
              Aucun locus dans ce palace
            </h3>
            <p className="max-w-sm text-sm text-muted-foreground">
              Place au moins une carte dans l'éditeur avant de lancer un parcours de révision.
            </p>
            <Button
              variant="outline"
              className="mt-1"
              onClick={() =>
                navigate({
                  to: "/palaces/$palaceId",
                  params: { palaceId: palace.id },
                })
              }
            >
              Retourner à l'éditeur
            </Button>
          </CardContent>
        </Card>
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
  onFlip: () => void;
  onPrev: () => void;
  onNext: () => void;
}

function LocusOverlay({
  locus,
  cursor,
  total,
  showBack,
  onFlip,
  onPrev,
  onNext,
}: LocusOverlayProps) {
  return (
    <div className="pointer-events-none absolute inset-x-0 bottom-6 flex justify-center px-4">
      <motion.div
        key={cursor}
        initial={{ opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.18, ease: [0.22, 1, 0.36, 1] }}
        className="pointer-events-auto w-full max-w-xl"
      >
        <Card className="border shadow-xl backdrop-blur">
          <CardContent className="space-y-3 p-4">
            <div className="flex items-center gap-2">
              <Badge variant="secondary" className="font-mono tabular-nums">
                #{cursor + 1}
              </Badge>
              <span className="flex-1 truncate text-xs text-muted-foreground">
                {locus.label ?? `Locus card_id=${locus.card_id}`}
              </span>
            </div>

            <LocusCardBody locusCardId={locus.card_id} showBack={showBack} />

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
      </motion.div>
    </div>
  );
}

/**
 * Resolves the card content for the active locus. P017: fetches ONLY this
 * locus's card via the `get_card_with_note` JOIN command, instead of loading
 * every card of every deck and building a lookup map.
 */
function LocusCardBody({ locusCardId, showBack }: { locusCardId: number; showBack: boolean }) {
  const { data: cwn, isLoading } = useCardWithNote(locusCardId);
  if (isLoading) {
    return <p className="text-sm text-muted-foreground">Chargement de la carte…</p>;
  }
  if (!cwn) {
    return <p className="text-sm text-muted-foreground">Carte introuvable (id={locusCardId})</p>;
  }
  const front = readField(cwn.note.fields, "front") ?? readField(cwn.note.fields, "text") ?? "—";
  const back = readField(cwn.note.fields, "back") ?? "—";
  return (
    <div className="rounded-lg border bg-muted/40 p-3">
      <p className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
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
