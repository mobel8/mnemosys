/**
 * End-of-session screen.
 *
 * Renders the post-mortem of an in-memory review session: number of cards
 * graded, accuracy (= Good+Easy share), total time, plus optional CTAs to
 * either go back to the deck or kick off another session if more cards
 * came due in the meantime.
 *
 * The confetti is fire-and-forget — wrapped in a `useEffect(...)`-once
 * pattern so reopening or re-rendering the component doesn't spam the
 * canvas. The import is dynamic so jsdom (and the Vitest smoke test) never
 * touch the WebGL-ish bits.
 */

import { Link } from "@tanstack/react-router";
import confetti from "canvas-confetti";
import { motion } from "framer-motion";
import { useEffect, useRef } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { formatElapsed } from "@/lib/format";
import type { Rating } from "@/lib/tauri";

export interface ReviewedLog {
  rating: Rating;
  review_time_ms: number;
  correct: boolean;
}

interface ReviewSummaryProps {
  deckId: number;
  reviewed: ReviewedLog[];
  durationMs: number;
  /** Cards that became due *after* the session started; used to decide if
   * we offer a "Continuer" CTA. */
  remainingDue?: number;
  onContinue?: () => void;
}

function fireConfetti() {
  try {
    void confetti({
      particleCount: 140,
      spread: 80,
      origin: { y: 0.6 },
      scalar: 0.9,
    });
    // A second, asymmetric burst for some visual interest.
    window.setTimeout(() => {
      void confetti({
        particleCount: 60,
        angle: 60,
        spread: 55,
        origin: { x: 0, y: 0.7 },
      });
      void confetti({
        particleCount: 60,
        angle: 120,
        spread: 55,
        origin: { x: 1, y: 0.7 },
      });
    }, 180);
  } catch {
    // canvas-confetti can throw in headless / jsdom envs — ignore.
  }
}

export function ReviewSummary({
  deckId,
  reviewed,
  durationMs,
  remainingDue = 0,
  onContinue,
}: ReviewSummaryProps) {
  const firedRef = useRef(false);
  useEffect(() => {
    if (firedRef.current) return;
    firedRef.current = true;
    fireConfetti();
  }, []);

  const total = reviewed.length;
  const correct = reviewed.filter((r) => r.correct).length;
  const accuracy = total > 0 ? Math.round((correct / total) * 100) : 0;
  const learnedNew = reviewed.filter((r) => r.rating >= 3).length;

  return (
    <motion.div
      initial={{ opacity: 0, y: 24 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.35, ease: "easeOut" }}
      className="flex w-full justify-center px-4 py-10"
    >
      <Card className="w-full max-w-xl">
        <CardHeader className="text-center">
          <CardTitle className="text-2xl">Session terminée</CardTitle>
          <CardDescription>Beau travail — voici ton récap.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
            <Stat label="Cartes" value={total.toString()} />
            <Stat label="Précision" value={`${accuracy}%`} />
            <Stat label="Durée" value={formatElapsed(durationMs)} />
            <Stat label="Mémorisées" value={`+${learnedNew}`} />
          </div>

          <div className="flex flex-col items-center gap-2 pt-2 sm:flex-row sm:justify-center">
            <Button asChild variant="outline">
              {/* `deckId < 0` is the interleaved-session sentinel: a mixed
                  queue has no canonical deck, so route back to the interleaved
                  entry point instead of a non-existent `/decks/-1`. */}
              {deckId < 0 ? (
                <Link to="/review-interleaved">Retour au mode entrelacé</Link>
              ) : (
                <Link to="/decks/$deckId" params={{ deckId }}>
                  Retour au deck
                </Link>
              )}
            </Button>
            {remainingDue > 0 && onContinue && (
              <Button onClick={onContinue}>
                Continuer ({remainingDue} {remainingDue > 1 ? "cartes restantes" : "carte restante"}
                )
              </Button>
            )}
          </div>
        </CardContent>
      </Card>
    </motion.div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border bg-card/40 p-3 text-center">
      <div className="text-xs uppercase tracking-wide text-muted-foreground">{label}</div>
      <div className="mt-1 text-xl font-semibold tabular-nums">{value}</div>
    </div>
  );
}
