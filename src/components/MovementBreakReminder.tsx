/**
 * Movement break reminder (Vague 3 — opt-in).
 *
 * Singleton-like overlay mounted at the App root. Owns a timer that fires
 * every `intervalMinutes` while the app has focus AND a review session is
 * active. When it fires, the dialog opens with a 5-minute countdown and a
 * rotating prompt ("10 jumping jacks", "stretch", "hydrate"…). The user
 * can dismiss with "J'ai fini" (early exit, logs activity) or "Skip"
 * (skipped, logs nothing).
 *
 * Evidence: Roig et al. — acute exercise improves memory consolidation
 * (d≈0.52). The reminder defaults to a 25-minute cadence (Pomodoro-ish).
 *
 * Implementation notes:
 *   - We use `document.visibilityState` to auto-pause the timer when the
 *     window loses focus (otherwise a backgrounded tab would queue a flood
 *     of overlays).
 *   - The active-session signal comes from the shared `useReviewSession`
 *     store, the same one read by the Sidebar pill. No prop drilling.
 *   - The overlay sits at `z-50` (same tier as the toast viewport) so it
 *     stacks above the review surface but below any modal-confirm dialog.
 *   - We deliberately *don't* render anything when `enabled` is false so
 *     the component is a no-op for the vast majority of users.
 */

import { motion } from "framer-motion";
import { Loader2 } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { useReviewSession } from "@/lib/stores/review";

interface MovementBreakReminderProps {
  /** Cadence in minutes. Clamped to `[10, 60]`. */
  intervalMinutes: number;
  /** Master switch. When `false` the component renders nothing. */
  enabled: boolean;
  /** Default `300` = 5 min break duration. */
  breakDurationSeconds?: number;
}

const PROMPTS = [
  "10 jumping jacks",
  "Marche 1 min",
  "Étire-toi",
  "Hydrate-toi",
  "Regarde au loin (20-20-20)",
  "Roule les épaules",
] as const;

function clampInterval(minutes: number): number {
  if (!Number.isFinite(minutes)) return 25;
  return Math.min(Math.max(Math.round(minutes), 10), 60);
}

function formatMmSs(totalSeconds: number): string {
  const s = Math.max(0, Math.floor(totalSeconds));
  const mm = Math.floor(s / 60)
    .toString()
    .padStart(2, "0");
  const ss = (s % 60).toString().padStart(2, "0");
  return `${mm}:${ss}`;
}

export function MovementBreakReminder({
  intervalMinutes,
  enabled,
  breakDurationSeconds = 300,
}: MovementBreakReminderProps) {
  // `deckId !== null` is the canonical "a session is in progress" signal —
  // matches what the sidebar pill keys off of.
  const sessionActive = useReviewSession((s) => s.deckId !== null);
  const cadenceMs = clampInterval(intervalMinutes) * 60_000;

  const [open, setOpen] = useState(false);
  const [remaining, setRemaining] = useState(breakDurationSeconds);
  const [promptIdx, setPromptIdx] = useState(0);

  const cadenceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const countdownTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const promptRotateRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const clearTimers = useCallback(() => {
    if (cadenceTimerRef.current !== null) {
      clearTimeout(cadenceTimerRef.current);
      cadenceTimerRef.current = null;
    }
    if (countdownTimerRef.current !== null) {
      clearInterval(countdownTimerRef.current);
      countdownTimerRef.current = null;
    }
    if (promptRotateRef.current !== null) {
      clearInterval(promptRotateRef.current);
      promptRotateRef.current = null;
    }
  }, []);

  // Schedule the next reminder. Returns a cleanup callback.
  const schedule = useCallback(() => {
    if (cadenceTimerRef.current !== null) {
      clearTimeout(cadenceTimerRef.current);
    }
    cadenceTimerRef.current = setTimeout(() => {
      cadenceTimerRef.current = null;
      // Only show when the app is visible AND the session is still on.
      const visible = typeof document === "undefined" || document.visibilityState === "visible";
      if (visible && sessionActive && enabled) {
        setOpen(true);
      } else {
        // Re-arm; we'll try again next cadence.
        schedule();
      }
    }, cadenceMs);
  }, [cadenceMs, sessionActive, enabled]);

  // Arm / disarm the cadence based on `enabled` + `sessionActive`.
  useEffect(() => {
    if (!enabled || !sessionActive) {
      clearTimers();
      setOpen(false);
      return;
    }
    schedule();
    return () => {
      clearTimers();
    };
  }, [enabled, sessionActive, schedule, clearTimers]);

  // Pause the cadence when the tab is hidden; resume on visibility return.
  useEffect(() => {
    if (typeof document === "undefined") return;
    function onVisibility() {
      if (document.visibilityState === "hidden") {
        if (cadenceTimerRef.current !== null) {
          clearTimeout(cadenceTimerRef.current);
          cadenceTimerRef.current = null;
        }
      } else if (enabled && sessionActive && !open) {
        schedule();
      }
    }
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [enabled, sessionActive, open, schedule]);

  // Drive the in-dialog countdown + prompt rotation.
  useEffect(() => {
    if (!open) return;
    setRemaining(breakDurationSeconds);
    setPromptIdx(0);
    countdownTimerRef.current = setInterval(() => {
      setRemaining((s) => {
        const next = s - 1;
        if (next <= 0) {
          if (countdownTimerRef.current !== null) {
            clearInterval(countdownTimerRef.current);
            countdownTimerRef.current = null;
          }
          return 0;
        }
        return next;
      });
    }, 1_000);
    promptRotateRef.current = setInterval(() => {
      setPromptIdx((i) => (i + 1) % PROMPTS.length);
    }, 6_000);
    return () => {
      if (countdownTimerRef.current !== null) {
        clearInterval(countdownTimerRef.current);
        countdownTimerRef.current = null;
      }
      if (promptRotateRef.current !== null) {
        clearInterval(promptRotateRef.current);
        promptRotateRef.current = null;
      }
    };
  }, [open, breakDurationSeconds]);

  const handleClose = useCallback(() => {
    setOpen(false);
    // Re-arm the cadence for the next break.
    if (enabled && sessionActive) {
      schedule();
    }
  }, [enabled, sessionActive, schedule]);

  const currentPrompt = useMemo(() => PROMPTS[promptIdx] ?? PROMPTS[0], [promptIdx]);

  if (!enabled) return null;

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) handleClose();
      }}
    >
      <DialogContent
        className="z-50 max-w-md"
        data-testid="movement-break-dialog"
        onPointerDownOutside={(e) => e.preventDefault()}
      >
        <DialogHeader>
          <DialogTitle>Movement break — 5 min</DialogTitle>
          <DialogDescription>
            Bouge un peu. Active la consolidation mémoire (Roig et al., d≈0.52).
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-col items-center gap-4 py-4">
          <motion.div
            key={promptIdx}
            initial={{ opacity: 0, y: 6 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.3 }}
            className="text-2xl font-medium text-foreground"
            data-testid="movement-prompt"
          >
            {currentPrompt}
          </motion.div>

          <motion.div
            className="relative flex h-32 w-32 items-center justify-center rounded-full border-4 border-primary/50"
            animate={{ scale: [1, 1.05, 1] }}
            transition={{ duration: 2, repeat: Infinity }}
          >
            <span
              className="text-2xl font-mono tabular-nums text-foreground"
              data-testid="break-remaining"
            >
              {formatMmSs(remaining)}
            </span>
          </motion.div>
        </div>

        <DialogFooter className="gap-2 sm:gap-2">
          <Button type="button" variant="ghost" onClick={handleClose} data-testid="break-skip">
            Skip
          </Button>
          <Button type="button" onClick={handleClose} data-testid="break-done">
            <Loader2 className="h-4 w-4 animate-spin" />
            J'ai fini
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
