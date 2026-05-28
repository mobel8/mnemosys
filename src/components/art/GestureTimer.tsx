/**
 * Gesture-drawing timer (Vague 16 — Mode Arts).
 *
 * Deliberate visual practice (Edwards, "Drawing on the Right Side of the
 * Brain"): short, time-boxed poses force the learner to capture gesture and
 * proportion fast instead of fussing over detail. A classic warm-up "ladder"
 * ramps the holds — 30s ×5 → 1min ×3 → 2min ×2 → 5min ×1 — or the learner
 * picks a single fixed duration.
 *
 * The SketchCanvas (V7) is the drawing surface, reused verbatim. Because it
 * exposes no imperative clear, we reset it between poses by bumping a React
 * `key` (cheap remount). When a pose's timer hits zero we flash the frame and
 * fire a short Web-Audio chime; "Suivant" advances to the next pose. All
 * audio/timers are torn down on unmount.
 */

import { Pause, Play, SkipForward } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { SketchCanvas } from "@/components/SketchCanvas";
import { Button } from "@/components/ui/button";
import { getAudioContextCtor, playTone } from "@/lib/audio";
import { cn } from "@/lib/utils";

interface Preset {
  label: string;
  seconds: number;
}

const QUICK_PRESETS: Preset[] = [
  { label: "30 s", seconds: 30 },
  { label: "1 min", seconds: 60 },
  { label: "2 min", seconds: 120 },
  { label: "5 min", seconds: 300 },
];

/** One classic warm-up ladder, expanded to a flat queue of pose durations. */
const LADDER_DEF: { seconds: number; count: number }[] = [
  { seconds: 30, count: 5 },
  { seconds: 60, count: 3 },
  { seconds: 120, count: 2 },
  { seconds: 300, count: 1 },
];

function buildLadder(): number[] {
  return LADDER_DEF.flatMap(({ seconds, count }) => Array.from({ length: count }, () => seconds));
}

function formatMmSs(totalSeconds: number): string {
  const s = Math.max(0, Math.floor(totalSeconds));
  const mm = Math.floor(s / 60)
    .toString()
    .padStart(2, "0");
  const ss = (s % 60).toString().padStart(2, "0");
  return `${mm}:${ss}`;
}

export interface GestureTimerProps {
  className?: string;
}

export function GestureTimer({ className }: GestureTimerProps) {
  /** Active queue of pose durations. `null` when in single-duration mode. */
  const [ladder, setLadder] = useState<number[] | null>(null);
  const [ladderIndex, setLadderIndex] = useState(0);
  /** Duration (s) of the current pose. */
  const [poseDuration, setPoseDuration] = useState(60);
  const [remaining, setRemaining] = useState(60);
  const [running, setRunning] = useState(false);
  const [posesDone, setPosesDone] = useState(0);
  /** Briefly true at expiry to trigger the flash + chime. */
  const [flash, setFlash] = useState(false);
  /** Bumped to remount (and thus clear) the SketchCanvas between poses. */
  const [canvasKey, setCanvasKey] = useState(0);

  const ctxRef = useRef<AudioContext | null>(null);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const flashTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const clearTick = useCallback(() => {
    if (intervalRef.current !== null) {
      clearInterval(intervalRef.current);
      intervalRef.current = null;
    }
  }, []);

  const chime = useCallback(() => {
    if (!ctxRef.current) {
      const Ctor = getAudioContextCtor();
      if (!Ctor) return;
      try {
        ctxRef.current = new Ctor();
      } catch {
        ctxRef.current = null;
        return;
      }
    }
    const ctx = ctxRef.current;
    if (!ctx) return;
    void ctx.resume().catch(() => undefined);
    // A short two-note chime so "time's up" is obvious without being jarring.
    playTone(ctx, { frequency: 660, durationSeconds: 0.18, peakGain: 0.1 });
    playTone(ctx, {
      frequency: 990,
      durationSeconds: 0.22,
      peakGain: 0.1,
      startOffsetSeconds: 0.16,
    });
  }, []);

  const onPoseComplete = useCallback(() => {
    clearTick();
    setRunning(false);
    setPosesDone((n) => n + 1);
    chime();
    setFlash(true);
    if (flashTimeoutRef.current !== null) clearTimeout(flashTimeoutRef.current);
    flashTimeoutRef.current = setTimeout(() => setFlash(false), 450);
  }, [chime, clearTick]);

  // Countdown loop. Reads `running`; recreated only on start/stop.
  useEffect(() => {
    if (!running) return;
    intervalRef.current = setInterval(() => {
      setRemaining((s) => {
        if (s <= 1) {
          // Defer the side-effecting completion out of the state updater.
          queueMicrotask(onPoseComplete);
          return 0;
        }
        return s - 1;
      });
    }, 1_000);
    return () => {
      if (intervalRef.current !== null) {
        clearInterval(intervalRef.current);
        intervalRef.current = null;
      }
    };
  }, [running, onPoseComplete]);

  // Cleanup on unmount.
  useEffect(() => {
    return () => {
      clearTick();
      if (flashTimeoutRef.current !== null) clearTimeout(flashTimeoutRef.current);
      if (ctxRef.current) {
        void ctxRef.current.close().catch(() => undefined);
        ctxRef.current = null;
      }
    };
  }, [clearTick]);

  /** Load a single fixed duration (exits ladder mode) and reset the pose. */
  const selectPreset = useCallback(
    (seconds: number) => {
      clearTick();
      setLadder(null);
      setLadderIndex(0);
      setPoseDuration(seconds);
      setRemaining(seconds);
      setRunning(false);
      setFlash(false);
    },
    [clearTick],
  );

  /** Start the warm-up ladder from pose 0. */
  const startLadder = useCallback(() => {
    const queue = buildLadder();
    const first = queue[0] ?? 30;
    clearTick();
    setLadder(queue);
    setLadderIndex(0);
    setPoseDuration(first);
    setRemaining(first);
    setRunning(false);
    setFlash(false);
  }, [clearTick]);

  /** Move to the next pose: advance the ladder if any, clear canvas, reset. */
  const nextPose = useCallback(() => {
    clearTick();
    setFlash(false);
    setCanvasKey((k) => k + 1);
    if (ladder) {
      const nextIndex = ladderIndex + 1;
      if (nextIndex < ladder.length) {
        const dur = ladder[nextIndex] ?? poseDuration;
        setLadderIndex(nextIndex);
        setPoseDuration(dur);
        setRemaining(dur);
        setRunning(true);
        return;
      }
      // Ladder finished — fall back to a fresh single pose, paused.
      setLadder(null);
      setLadderIndex(0);
    }
    setRemaining(poseDuration);
    setRunning(true);
  }, [clearTick, ladder, ladderIndex, poseDuration]);

  const toggle = useCallback(() => {
    if (running) {
      setRunning(false);
      return;
    }
    // Restart a finished pose from the top.
    if (remaining <= 0) setRemaining(poseDuration);
    setRunning(true);
  }, [running, remaining, poseDuration]);

  const ladderLabel =
    ladder && ladder.length > 0
      ? `Pose ${Math.min(ladderIndex + 1, ladder.length)}/${ladder.length}`
      : null;

  return (
    <div className={cn("space-y-5", className)} data-testid="gesture-timer">
      {/* Presets. */}
      <div className="flex flex-wrap items-center gap-2">
        {QUICK_PRESETS.map((p) => (
          <Button
            key={p.seconds}
            type="button"
            size="sm"
            variant={ladder === null && poseDuration === p.seconds ? "default" : "outline"}
            onClick={() => selectPreset(p.seconds)}
            data-testid={`preset-${p.seconds}`}
          >
            {p.label}
          </Button>
        ))}
        <Button
          type="button"
          size="sm"
          variant={ladder !== null ? "default" : "outline"}
          onClick={startLadder}
          data-testid="preset-ladder"
        >
          Ladder
        </Button>
      </div>

      {/* Timer + counters. */}
      <div className="flex items-center justify-between rounded-md border bg-muted/30 px-4 py-3">
        <div className="flex flex-col">
          <span
            className={cn(
              "tabular-nums text-4xl font-semibold transition-colors",
              remaining <= 5 && running ? "text-red-600 dark:text-red-400" : "",
            )}
            data-testid="time-remaining"
          >
            {formatMmSs(remaining)}
          </span>
          {ladderLabel && (
            <span className="text-xs text-muted-foreground" data-testid="ladder-label">
              {ladderLabel}
            </span>
          )}
        </div>
        <div className="text-right text-sm text-muted-foreground">
          <div data-testid="poses-done">
            Poses : <span className="font-medium text-foreground">{posesDone}</span>
          </div>
          <div>Durée : {formatMmSs(poseDuration)}</div>
        </div>
      </div>

      {/* Drawing surface (V7), flashed on completion. Keyed so "Suivant"
          gives a clean canvas for the next pose. */}
      <div
        className={cn(
          "rounded-md transition-all",
          flash ? "ring-4 ring-primary ring-offset-2" : "ring-0",
        )}
        data-testid="canvas-frame"
        data-flash={flash ? "true" : "false"}
      >
        <SketchCanvas
          key={canvasKey}
          height={360}
          placeholder="Capture la gesture avant la fin du chrono"
        />
      </div>

      {/* Controls. */}
      <div className="flex gap-2">
        <Button
          type="button"
          size="lg"
          className="flex-1 gap-2"
          onClick={toggle}
          data-testid="gesture-toggle"
        >
          {running ? (
            <>
              <Pause className="h-4 w-4" /> Pause
            </>
          ) : (
            <>
              <Play className="h-4 w-4" /> {remaining <= 0 ? "Reprendre" : "Démarrer"}
            </>
          )}
        </Button>
        <Button
          type="button"
          size="lg"
          variant="secondary"
          className="gap-2"
          onClick={nextPose}
          data-testid="next-pose"
        >
          <SkipForward className="h-4 w-4" /> Suivant
        </Button>
      </div>
    </div>
  );
}
