/**
 * Sticky progress bar shown at the top of an active review session.
 *
 * Two responsibilities:
 *   1. Visualise progress with a slim bar + textual `X / N · mm:ss`.
 *   2. Offer the only exit affordance during a session ("Quit"), with a
 *      confirmation dialog once the user has invested enough effort to
 *      avoid an accidental click.
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
import { formatElapsed } from "@/lib/format";
import { cn } from "@/lib/utils";

interface ReviewProgressProps {
  current: number;
  total: number;
  startedAt: number;
  reviewedCount: number;
  onQuit: () => void;
  onHelp?: () => void;
}

export function ReviewProgress({
  current,
  total,
  startedAt,
  reviewedCount,
  onQuit,
  onHelp,
}: ReviewProgressProps) {
  const [now, setNow] = useState(() => Date.now());
  const [confirmOpen, setConfirmOpen] = useState(false);

  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(id);
  }, []);

  const pct = total > 0 ? Math.min(100, (Math.max(0, current - 1) / total) * 100) : 0;
  const elapsedMs = Math.max(0, now - startedAt);

  const requestQuit = () => {
    // Five-card threshold avoids nagging users who tap quit immediately after
    // realising they're in the wrong deck, but protects longer sessions.
    if (reviewedCount > 5) {
      setConfirmOpen(true);
    } else {
      onQuit();
    }
  };

  return (
    <div className="sticky top-0 z-20 border-b bg-background/95 backdrop-blur">
      <div
        className={cn("h-1.5 w-full bg-secondary", "overflow-hidden")}
        role="progressbar"
        aria-valuenow={Math.round(pct)}
        aria-valuemin={0}
        aria-valuemax={100}
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
        <div className="flex-1 text-center font-mono text-sm font-medium tabular-nums">
          {current} <span className="text-muted-foreground">/</span> {total}
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
          <Button type="button" variant="ghost" size="sm" onClick={requestQuit}>
            Quitter
          </Button>
        </div>
      </div>

      <Dialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Quitter la session ?</DialogTitle>
            <DialogDescription>
              Tu as déjà révisé {reviewedCount} cartes. Le progrès est sauvegardé carte par carte —
              tu peux reprendre à tout moment.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setConfirmOpen(false)}>
              Continuer la session
            </Button>
            <Button
              variant="destructive"
              onClick={() => {
                setConfirmOpen(false);
                onQuit();
              }}
            >
              Quitter
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
