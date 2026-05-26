/**
 * Cyclic sighing primer (Vague 3 — opt-in).
 *
 * 5-minute breathing exercise: 2 short nasal inhales (1.5s + 0.5s) followed
 * by a long mouth exhale (4s) for a 6-second cycle. Spiegel et al., Cell
 * Reports Medicine 2023 found cyclic sighing produced the largest mood
 * improvement & physiological arousal reduction vs. box breathing and
 * mindfulness meditation.
 *
 * Implementation:
 *   - One animated circle that scales between 0.6 and 1.0 in step with the
 *     instruction text. Pure CSS transitions (no Framer Motion dep) so the
 *     component stays tree-shake friendly.
 *   - Audio cues are opt-in via a Switch and use a tiny Web Audio oscillator
 *     to emit short beeps at each phase transition.
 *   - Closing the dialog or hitting "Stop" tears down both the cycle timer
 *     and the audio context.
 */

import { Loader2, Volume2, VolumeX } from "lucide-react";
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
import { Switch } from "@/components/ui/switch";
import { cn } from "@/lib/utils";

interface CyclicSighingProps {
  open: boolean;
  onClose: () => void;
  /** Total session duration in seconds. Defaults to 5 minutes (= 300s). */
  durationSeconds?: number;
}

type Phase = "inhale1" | "inhale2" | "exhale";

/**
 * Phase durations (ms). Sum = 6_000 — one full cycle.
 * `inhale1` is the deep nasal inhale, `inhale2` the short top-up, `exhale`
 * the long mouth release. Numbers are taken from Spiegel et al.'s protocol.
 */
const PHASE_DURATIONS_MS: Record<Phase, number> = {
  inhale1: 1_500,
  inhale2: 500,
  exhale: 4_000,
};

const PHASES: Phase[] = ["inhale1", "inhale2", "exhale"];

const PHASE_LABELS: Record<Phase, string> = {
  inhale1: "Inspire (1)",
  inhale2: "Inspire (2)",
  exhale: "Expire long",
};

function formatMmSs(totalSeconds: number): string {
  const sign = totalSeconds < 0 ? "-" : "";
  const s = Math.max(0, Math.floor(totalSeconds));
  const mm = Math.floor(s / 60)
    .toString()
    .padStart(2, "0");
  const ss = (s % 60).toString().padStart(2, "0");
  return `${sign}${mm}:${ss}`;
}

export function CyclicSighing({ open, onClose, durationSeconds = 300 }: CyclicSighingProps) {
  const [phase, setPhase] = useState<Phase>("inhale1");
  const [cycleCount, setCycleCount] = useState(0);
  /** Seconds remaining; counts down only while the dialog is open. */
  const [remaining, setRemaining] = useState(durationSeconds);
  const [audioEnabled, setAudioEnabled] = useState(false);
  /** Set to `true` after `durationSeconds` has elapsed; user can manually stop sooner. */
  const [completed, setCompleted] = useState(false);

  const audioCtxRef = useRef<AudioContext | null>(null);
  const phaseTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const tickTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  /** Tears down every timer + audio resource. Safe to call multiple times. */
  const cleanup = useCallback(() => {
    if (phaseTimerRef.current !== null) {
      clearTimeout(phaseTimerRef.current);
      phaseTimerRef.current = null;
    }
    if (tickTimerRef.current !== null) {
      clearInterval(tickTimerRef.current);
      tickTimerRef.current = null;
    }
    if (audioCtxRef.current) {
      void audioCtxRef.current.close().catch(() => undefined);
      audioCtxRef.current = null;
    }
  }, []);

  // Tiny beep — frequency varies per phase so the user can hear the pattern
  // even with their eyes closed. No-op when audio is off or the AudioContext
  // failed to initialise (e.g. in jsdom).
  const playBeep = useCallback(
    (nextPhase: Phase) => {
      if (!audioEnabled) return;
      try {
        if (!audioCtxRef.current) {
          const Ctor =
            typeof window !== "undefined"
              ? (window.AudioContext ??
                (window as unknown as { webkitAudioContext?: typeof AudioContext })
                  .webkitAudioContext)
              : undefined;
          if (!Ctor) return;
          audioCtxRef.current = new Ctor();
        }
        const ctx = audioCtxRef.current;
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.frequency.value = nextPhase === "exhale" ? 220 : nextPhase === "inhale1" ? 440 : 660;
        osc.type = "sine";
        gain.gain.setValueAtTime(0.0001, ctx.currentTime);
        gain.gain.exponentialRampToValueAtTime(0.08, ctx.currentTime + 0.02);
        gain.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + 0.12);
        osc.connect(gain).connect(ctx.destination);
        osc.start();
        osc.stop(ctx.currentTime + 0.15);
      } catch {
        // Best-effort: a missing/blocked audio context shouldn't break the UI.
      }
    },
    [audioEnabled],
  );

  // Drive the phase cycle. Each timeout schedules the *next* one so a long
  // hold like `exhale` (4s) gets its full slice before flipping.
  useEffect(() => {
    if (!open || completed) return;
    let phaseIdx = 0;
    setPhase(PHASES[phaseIdx] ?? "inhale1");

    function schedule() {
      const current = PHASES[phaseIdx] ?? "inhale1";
      const duration = PHASE_DURATIONS_MS[current];
      phaseTimerRef.current = setTimeout(() => {
        phaseIdx = (phaseIdx + 1) % PHASES.length;
        const next = PHASES[phaseIdx] ?? "inhale1";
        setPhase(next);
        if (next === "inhale1") {
          setCycleCount((n) => n + 1);
        }
        playBeep(next);
        schedule();
      }, duration);
    }
    schedule();

    return () => {
      if (phaseTimerRef.current !== null) {
        clearTimeout(phaseTimerRef.current);
        phaseTimerRef.current = null;
      }
    };
  }, [open, completed, playBeep]);

  // Global countdown.
  useEffect(() => {
    if (!open || completed) return;
    setRemaining(durationSeconds);
    tickTimerRef.current = setInterval(() => {
      setRemaining((s) => {
        const next = s - 1;
        if (next <= 0) {
          setCompleted(true);
          if (tickTimerRef.current !== null) {
            clearInterval(tickTimerRef.current);
            tickTimerRef.current = null;
          }
          return 0;
        }
        return next;
      });
    }, 1_000);
    return () => {
      if (tickTimerRef.current !== null) {
        clearInterval(tickTimerRef.current);
        tickTimerRef.current = null;
      }
    };
  }, [open, completed, durationSeconds]);

  // Tear everything down when the dialog closes.
  useEffect(() => {
    if (!open) {
      cleanup();
      setCompleted(false);
      setCycleCount(0);
    }
  }, [open, cleanup]);

  // Final cleanup on unmount.
  useEffect(() => {
    return () => {
      cleanup();
    };
  }, [cleanup]);

  const circleClass = useMemo(() => {
    // Use Tailwind transition + scale utilities; we drive them off `phase`.
    const inhale = phase === "inhale1" || phase === "inhale2";
    return cn(
      "rounded-full bg-primary/30 ring-4 ring-primary/40 transition-transform ease-in-out",
      inhale ? "scale-100" : "scale-60",
    );
  }, [phase]);

  // The scale class is interpolated on `phase`, but Tailwind doesn't know
  // about a literal `scale-60`. Compute the transition duration inline so the
  // CSS animation respects each phase's individual length.
  const transitionDurationMs = PHASE_DURATIONS_MS[phase];

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) onClose();
      }}
    >
      <DialogContent
        className="max-w-md"
        data-testid="cyclic-sighing-dialog"
        onPointerDownOutside={(e) => e.preventDefault()}
      >
        <DialogHeader>
          <DialogTitle>Cyclic sighing (5 min)</DialogTitle>
          <DialogDescription>
            Deux inspirations nasales puis une expiration longue. Calme le système nerveux en
            quelques cycles.
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-col items-center gap-4 py-2">
          <div
            className="relative flex h-44 w-44 items-center justify-center"
            data-testid="breath-circle"
          >
            <div
              className={circleClass}
              style={{
                width: "100%",
                height: "100%",
                transitionDuration: `${transitionDurationMs}ms`,
                transform: phase === "exhale" ? "scale(0.6)" : "scale(1)",
              }}
            />
            <span className="absolute text-base font-medium text-foreground">
              {PHASE_LABELS[phase]}
            </span>
          </div>

          <div className="flex w-full items-center justify-between text-xs text-muted-foreground">
            <span data-testid="cycle-count">Cycles : {cycleCount}</span>
            <span data-testid="time-remaining">Reste : {formatMmSs(remaining)}</span>
          </div>

          <div className="flex w-full items-center justify-between gap-2 rounded-md border bg-muted/30 px-3 py-2 text-sm">
            <label htmlFor="audio-toggle" className="flex items-center gap-2">
              {audioEnabled ? (
                <Volume2 className="h-4 w-4" />
              ) : (
                <VolumeX className="h-4 w-4 text-muted-foreground" />
              )}
              Tic sonore
            </label>
            <Switch
              id="audio-toggle"
              checked={audioEnabled}
              onCheckedChange={setAudioEnabled}
              data-testid="audio-toggle"
            />
          </div>

          {completed && (
            <p
              className="text-center text-sm text-emerald-700 dark:text-emerald-300"
              data-testid="completed-message"
            >
              Session terminée. Bonne révision.
            </p>
          )}
        </div>

        <DialogFooter className="gap-2 sm:gap-2">
          <Button type="button" variant="ghost" onClick={onClose} data-testid="sighing-skip">
            {completed ? "Fermer" : "Skip"}
          </Button>
          {!completed && (
            <Button type="button" variant="default" onClick={onClose} data-testid="sighing-stop">
              <Loader2 className="h-4 w-4 animate-spin" />
              Stop
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
