/**
 * Singleton overlay that surfaces delayed Judgments of Learning prompts.
 *
 * Polls `get_pending_jols(min_age_minutes)` every 5 minutes. When found,
 * shows a modal asking the learner to predict the recall probability of
 * recently-reviewed cards (Rhodes & Tauber 2011, delayed-JOL g=0.93).
 *
 * Mounted once in App.tsx (like MovementBreakReminder).
 */

import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Slider } from "@/components/ui/slider";
import { usePendingJols, useRecordJol, useSettingsQuery } from "@/lib/queries";
import { useReviewSession } from "@/lib/stores/review";

function noteFront(fields: Record<string, unknown>): string {
  if (typeof fields.front === "string") return fields.front;
  if (typeof fields.text === "string") {
    return fields.text.replace(/\{\{c\d+::(.*?)(?:::.*?)?\}\}/g, "[…]");
  }
  return "(carte sans front)";
}

export function DelayedJolPrompt() {
  const { data: settings } = useSettingsQuery();
  const enabled = settings?.delayed_jol_enabled ?? false;
  const minAge = settings?.jol_delay_minutes ?? 30;
  const sessionDeckId = useReviewSession((s) => s.deckId);
  const sessionActive = sessionDeckId !== null;

  // `usePendingJols` already polls every 5 min via its own `refetchInterval`
  // (see queries.ts). We keep the default, stable query key here so each poll
  // refreshes the same cache entry instead of spawning an orphan entry per
  // tick. The query is disabled mid-session so the prompt never interrupts an
  // active review.
  const { data: pending } = usePendingJols(minAge, 5, {
    enabled: enabled && !sessionActive,
  });

  const recordJol = useRecordJol();
  const [open, setOpen] = useState(false);
  const [index, setIndex] = useState(0);
  const [prob, setProb] = useState(0.7);

  useEffect(() => {
    if (!enabled || sessionActive) return;
    if (pending && pending.length > 0 && !open) {
      setOpen(true);
      setIndex(0);
      setProb(0.7);
    }
  }, [pending, enabled, sessionActive, open]);

  if (!enabled || sessionActive || !pending || pending.length === 0 || !open) {
    return null;
  }

  const current = pending[index];
  if (!current) return null;

  const total = pending.length;

  async function handleNext() {
    if (!current) return;
    try {
      await recordJol.mutateAsync({
        cardId: current.card.card.id,
        predictedProb: prob,
      });
    } catch {
      // Best-effort, never block the UI.
    }
    if (index + 1 < total) {
      setIndex(index + 1);
      setProb(0.7);
    } else {
      setOpen(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>
            Prédiction de rappel ({index + 1}/{total})
          </DialogTitle>
          <DialogDescription>
            Pour cette carte vue il y a au moins {minAge} min, quelle est la probabilité que tu la
            réussisses dans 7 jours ?
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <div className="rounded-md border bg-muted/30 p-4 text-sm">
            <p className="font-medium">{noteFront(current.card.note.fields)}</p>
          </div>
          <div className="space-y-2">
            <Slider
              value={[prob]}
              onValueChange={([v]) => setProb(typeof v === "number" ? v : 0.7)}
              min={0}
              max={1}
              step={0.05}
            />
            <p className="text-center font-mono text-lg">{Math.round(prob * 100)}%</p>
            <p className="text-center text-xs text-muted-foreground">
              0% = je vais sûrement échouer · 100% = je vais sûrement réussir
            </p>
          </div>
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={() => setOpen(false)}>
            Plus tard
          </Button>
          <Button onClick={handleNext} disabled={recordJol.isPending}>
            {index + 1 < total ? "Suivant" : "Terminer"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
