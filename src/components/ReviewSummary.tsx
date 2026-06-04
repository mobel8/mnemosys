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
import { motion, useReducedMotion } from "framer-motion";
import { Inbox, PartyPopper } from "lucide-react";
import { useEffect, useRef } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { formatElapsed } from "@/lib/format";
import type { Rating } from "@/lib/tauri";
import { cn } from "@/lib/utils";

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
  // P029 — respect the OS "reduce motion" preference: no confetti burst and
  // no slide-up entrance for users who opted out of non-essential animation.
  const reduceMotion = useReducedMotion();
  const total = reviewed.length;
  // P102 — a session where nothing was graded (queue empty, or every card got
  // suspended) is not a win: skip the confetti and the celebratory copy below.
  const isEmpty = total === 0;
  const firedRef = useRef(false);
  useEffect(() => {
    if (firedRef.current) return;
    firedRef.current = true;
    // P102 — only celebrate when at least one card was actually reviewed.
    if (!reduceMotion && !isEmpty) fireConfetti();
  }, [reduceMotion, isEmpty]);

  // P109 — move focus to the summary heading when the screen mounts so screen
  // reader / keyboard users land on the result instead of staying on the (now
  // unmounted) rating row.
  const headingRef = useRef<HTMLHeadingElement>(null);
  useEffect(() => {
    headingRef.current?.focus();
  }, []);

  const correct = reviewed.filter((r) => r.correct).length;
  const accuracy = total > 0 ? Math.round((correct / total) * 100) : 0;
  const learnedNew = reviewed.filter((r) => r.rating >= 3).length;

  return (
    <motion.div
      initial={reduceMotion ? { opacity: 0 } : { opacity: 0, y: 24 }}
      animate={reduceMotion ? { opacity: 1 } : { opacity: 1, y: 0 }}
      transition={{ duration: 0.35, ease: "easeOut" }}
      className="flex w-full justify-center px-4 py-10"
    >
      <Card className="w-full max-w-xl">
        <CardHeader className="text-center">
          {/* P102 — neutral icon + copy when nothing was graded; celebratory
              otherwise. */}
          {isEmpty ? (
            <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-full bg-muted text-muted-foreground">
              <Inbox className="h-7 w-7" aria-hidden />
            </div>
          ) : (
            <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-full bg-brand-50 text-brand-500">
              <PartyPopper className="h-7 w-7" aria-hidden />
            </div>
          )}
          {/* P109 — real heading, focused on mount, so SR/keyboard users land
              on the result. `tabIndex={-1}` makes it programmatically
              focusable without adding it to the tab order. */}
          <CardTitle
            as="h2"
            ref={headingRef}
            tabIndex={-1}
            className="mt-3 font-display text-2xl outline-none"
          >
            {isEmpty ? "Aucune carte révisée" : "Session terminée"}
          </CardTitle>
          <CardDescription>
            {isEmpty
              ? "Cette session s'est terminée sans aucune révision."
              : "Beau travail — voici ton récap."}
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          {/* P109 — expose the KPIs as a description list so each figure is
              programmatically tied to its label (« Précision : 92% ») instead
              of being linearised into orphaned label/value fragments. */}
          {!isEmpty && (
            <dl className="grid grid-cols-2 gap-3 md:grid-cols-4">
              <Stat label="Cartes" value={total.toString()} />
              <Stat label="Précision" value={`${accuracy}%`} accent="success" />
              <Stat label="Durée" value={formatElapsed(durationMs)} />
              <Stat label="Mémorisées" value={`+${learnedNew}`} accent="brand" />
            </dl>
          )}

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

function Stat({
  label,
  value,
  accent,
}: {
  label: string;
  value: string;
  /** Optional semantic tint for the figure (kept literal for purge). */
  accent?: "success" | "brand";
}) {
  return (
    <div className="rounded-lg border bg-muted/40 p-3 text-center">
      <dt className="text-xs uppercase tracking-wide text-muted-foreground">{label}</dt>
      <dd
        className={cn(
          "mt-1 font-display text-2xl font-semibold tabular-nums",
          accent === "success" && "text-success",
          accent === "brand" && "text-brand-500",
        )}
      >
        {value}
      </dd>
    </div>
  );
}
