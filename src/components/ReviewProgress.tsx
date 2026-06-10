/**
 * Sticky progress bar shown at the top of an active review session.
 *
 * Two responsibilities:
 *   1. Visualise progress with a slim bar + textual `X / N · mm:ss`.
 *   2. Offer the exit affordance ("Quitter"). The confirmation lives in the
 *      parent (`ReviewSession.requestQuit`) so the Esc hotkey and this button
 *      share ONE quit path — the audit caught Esc bypassing the confirm when
 *      it lived here.
 */

import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { formatElapsed } from "@/lib/format";
import { cn } from "@/lib/utils";

interface ReviewProgressProps {
  current: number;
  total: number;
  startedAt: number;
  onQuit: () => void;
  onHelp?: () => void;
  /** P112 — libellé contextuel optionnel affiché dans la barre unique (ex. « Session entrelacée »). */
  label?: string;
}

export function ReviewProgress({
  current,
  total,
  startedAt,
  onQuit,
  onHelp,
  label,
}: ReviewProgressProps) {
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(id);
  }, []);

  const pct = total > 0 ? Math.min(100, (Math.max(0, current - 1) / total) * 100) : 0;
  const elapsedMs = Math.max(0, now - startedAt);
  // P109 — a bare `aria-valuenow="40"` is meaningless to a SR. Speak the
  // progress in card terms instead. Clamp to `[1, total]` so the very first
  // card reads « Carte 1 sur N » (not « Carte 0 ») and the done state reads
  // « Carte N sur N ».
  const currentCard = total > 0 ? Math.min(Math.max(current, 1), total) : 0;
  const progressText = total > 0 ? `Carte ${currentCard} sur ${total}` : "Aucune carte à réviser";

  return (
    <div className="sticky top-0 z-20 border-b bg-background/95 backdrop-blur">
      <div
        className={cn("h-1.5 w-full bg-secondary", "overflow-hidden")}
        role="progressbar"
        aria-valuenow={Math.round(pct)}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuetext={progressText}
        aria-label="Progression de la session"
      >
        <div
          className="h-full bg-primary transition-[width] duration-200 ease-out"
          style={{ width: `${pct}%` }}
        />
      </div>

      <div className="flex h-12 items-center justify-between gap-4 px-4">
        <div className="w-32 text-xs text-muted-foreground">
          <span className="font-mono tabular-nums">{formatElapsed(elapsedMs)}</span> écoulées
        </div>
        <div className="flex-1 text-center">
          {label && <span className="mr-2 text-xs font-medium text-muted-foreground">{label}</span>}
          <span className="font-mono text-sm font-medium tabular-nums">
            {current} <span className="text-muted-foreground">/</span> {total}
          </span>
        </div>
        <div className="flex w-32 items-center justify-end gap-2">
          {onHelp && (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={onHelp}
              aria-label="Raccourcis clavier"
              title="Raccourcis clavier (?)"
            >
              ?
            </Button>
          )}
          <Button type="button" variant="ghost" size="sm" onClick={onQuit}>
            Quitter
          </Button>
        </div>
      </div>
    </div>
  );
}
