/**
 * Ear training (Vague 16 — Mode Musique).
 *
 * Two deliberate-practice drills:
 *   - "Notes": a single pitch sounds; the learner names it (Do, Ré, Mi…).
 *   - "Intervalles": two pitches sound in sequence; the learner names the
 *     gap (tierce mineure, quinte juste…).
 *
 * The target is regenerated each round and held in a ref so replaying the
 * prompt never reshuffles it. A guess is graded immediately, the score
 * (correct / total) accumulates for the session, and "Suivant" advances. All
 * audio goes through the shared `playTone` helper on one lazily-created
 * AudioContext that's closed on unmount.
 */

import { Check, Ear, RotateCcw, Volume2, X } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { getAudioContextCtor, NOTE_FREQUENCIES_HZ, playTone } from "@/lib/audio";
import { cn } from "@/lib/utils";

type Mode = "notes" | "intervals";

/** Chromatic note names in display (solfège) order, octave 4. */
const NOTE_KEYS = [
  "C4",
  "C#4",
  "D4",
  "D#4",
  "E4",
  "F4",
  "F#4",
  "G4",
  "G#4",
  "A4",
  "A#4",
  "B4",
] as const;

const NOTE_LABELS: Record<(typeof NOTE_KEYS)[number], string> = {
  C4: "Do",
  "C#4": "Do#",
  D4: "Ré",
  "D#4": "Ré#",
  E4: "Mi",
  F4: "Fa",
  "F#4": "Fa#",
  G4: "Sol",
  "G#4": "Sol#",
  A4: "La",
  "A#4": "La#",
  B4: "Si",
};

/** Common intervals keyed by semitone distance from the root. */
const INTERVALS = [
  { semitones: 1, label: "Seconde mineure" },
  { semitones: 2, label: "Seconde majeure" },
  { semitones: 3, label: "Tierce mineure" },
  { semitones: 4, label: "Tierce majeure" },
  { semitones: 5, label: "Quarte juste" },
  { semitones: 7, label: "Quinte juste" },
  { semitones: 9, label: "Sixte majeure" },
  { semitones: 12, label: "Octave" },
] as const;

const NOTE_DURATION_S = 0.7;

function noteFreq(key: string): number {
  return NOTE_FREQUENCIES_HZ[key] ?? 440;
}

function randomInt(maxExclusive: number): number {
  return Math.floor(Math.random() * maxExclusive);
}

/** A round's hidden answer: a note key (notes mode) or a semitone gap. */
interface Target {
  noteKey: string;
  semitones: number;
}

function makeTarget(mode: Mode): Target {
  const noteKey = NOTE_KEYS[randomInt(NOTE_KEYS.length)] ?? "A4";
  if (mode === "notes") {
    return { noteKey, semitones: 0 };
  }
  const interval = INTERVALS[randomInt(INTERVALS.length)] ?? INTERVALS[0];
  return { noteKey, semitones: interval.semitones };
}

export interface EarTrainingProps {
  className?: string;
}

export function EarTraining({ className }: EarTrainingProps) {
  const [mode, setMode] = useState<Mode>("notes");
  const [correct, setCorrect] = useState(0);
  const [total, setTotal] = useState(0);
  /** Null until the learner answers; then "right"/"wrong" for one round. */
  const [verdict, setVerdict] = useState<"right" | "wrong" | null>(null);
  const [revealed, setRevealed] = useState(false);

  const ctxRef = useRef<AudioContext | null>(null);
  const targetRef = useRef<Target>(makeTarget("notes"));

  const ensureCtx = useCallback((): AudioContext | null => {
    if (!ctxRef.current) {
      const Ctor = getAudioContextCtor();
      if (!Ctor) return null;
      try {
        ctxRef.current = new Ctor();
      } catch {
        return null;
      }
    }
    void ctxRef.current.resume().catch(() => undefined);
    return ctxRef.current;
  }, []);

  /** Play the current target: one note, or root→interval for intervals. */
  const playTarget = useCallback(() => {
    const ctx = ensureCtx();
    if (!ctx) return;
    const target = targetRef.current;
    const rootFreq = noteFreq(target.noteKey);
    playTone(ctx, { frequency: rootFreq, durationSeconds: NOTE_DURATION_S, peakGain: 0.1 });
    if (mode === "intervals") {
      // Equal-temperament: each semitone multiplies frequency by 2^(1/12).
      const topFreq = rootFreq * 2 ** (target.semitones / 12);
      playTone(ctx, {
        frequency: topFreq,
        durationSeconds: NOTE_DURATION_S,
        peakGain: 0.1,
        startOffsetSeconds: NOTE_DURATION_S + 0.1,
      });
    }
  }, [ensureCtx, mode]);

  const nextRound = useCallback((nextMode: Mode) => {
    targetRef.current = makeTarget(nextMode);
    setVerdict(null);
    setRevealed(false);
  }, []);

  const guess = useCallback(
    (value: { noteKey?: string; semitones?: number }) => {
      if (verdict !== null) return; // already answered this round
      const target = targetRef.current;
      const isRight =
        mode === "notes" ? value.noteKey === target.noteKey : value.semitones === target.semitones;
      setVerdict(isRight ? "right" : "wrong");
      setRevealed(true);
      setTotal((t) => t + 1);
      if (isRight) setCorrect((c) => c + 1);
    },
    [mode, verdict],
  );

  const switchMode = useCallback(
    (next: Mode) => {
      setMode(next);
      setCorrect(0);
      setTotal(0);
      nextRound(next);
    },
    [nextRound],
  );

  const resetSession = useCallback(() => {
    setCorrect(0);
    setTotal(0);
    nextRound(mode);
  }, [mode, nextRound]);

  useEffect(() => {
    return () => {
      if (ctxRef.current) {
        void ctxRef.current.close().catch(() => undefined);
        ctxRef.current = null;
      }
    };
  }, []);

  const target = targetRef.current;
  const answerLabel =
    mode === "notes"
      ? (NOTE_LABELS[target.noteKey as (typeof NOTE_KEYS)[number]] ?? target.noteKey)
      : (INTERVALS.find((i) => i.semitones === target.semitones)?.label ??
        `${target.semitones} demi-tons`);

  return (
    <div className={cn("space-y-6", className)} data-testid="ear-training">
      {/* Mode switch. */}
      <div className="inline-flex rounded-lg border p-1">
        <button
          type="button"
          onClick={() => switchMode("notes")}
          data-testid="mode-notes"
          className={cn(
            "rounded-md px-4 py-1.5 text-sm font-medium transition-colors",
            mode === "notes"
              ? "bg-primary text-primary-foreground"
              : "text-muted-foreground hover:text-foreground",
          )}
        >
          Notes
        </button>
        <button
          type="button"
          onClick={() => switchMode("intervals")}
          data-testid="mode-intervals"
          className={cn(
            "rounded-md px-4 py-1.5 text-sm font-medium transition-colors",
            mode === "intervals"
              ? "bg-primary text-primary-foreground"
              : "text-muted-foreground hover:text-foreground",
          )}
        >
          Intervalles
        </button>
      </div>

      {/* Score. */}
      <div className="flex items-center justify-between rounded-md border bg-muted/30 px-4 py-2 text-sm">
        <span className="flex items-center gap-2 text-muted-foreground">
          <Ear className="h-4 w-4" /> Score de session
        </span>
        <span className="tabular-nums font-medium" data-testid="ear-score">
          {correct} / {total}
        </span>
      </div>

      {/* Prompt. */}
      <div className="flex flex-col items-center gap-3 py-2">
        <Button
          type="button"
          size="lg"
          variant="secondary"
          className="gap-2"
          onClick={playTarget}
          data-testid="play-target"
        >
          <Volume2 className="h-5 w-5" />
          {mode === "notes" ? "Jouer la note" : "Jouer l'intervalle"}
        </Button>
        {revealed && (
          <p
            className={cn(
              "flex items-center gap-1.5 text-sm font-medium",
              verdict === "right"
                ? "text-emerald-600 dark:text-emerald-400"
                : "text-red-600 dark:text-red-400",
            )}
            data-testid="ear-verdict"
          >
            {verdict === "right" ? <Check className="h-4 w-4" /> : <X className="h-4 w-4" />}
            {verdict === "right" ? "Correct" : "Raté"} — c'était {answerLabel}
          </p>
        )}
      </div>

      {/* Answer choices. */}
      {mode === "notes" ? (
        <div className="grid grid-cols-4 gap-2">
          {NOTE_KEYS.map((key) => (
            <Button
              key={key}
              type="button"
              variant="outline"
              disabled={verdict !== null}
              onClick={() => guess({ noteKey: key })}
              data-testid={`note-choice-${key}`}
            >
              {NOTE_LABELS[key]}
            </Button>
          ))}
        </div>
      ) : (
        <div className="grid grid-cols-2 gap-2">
          {INTERVALS.map((iv) => (
            <Button
              key={iv.semitones}
              type="button"
              variant="outline"
              disabled={verdict !== null}
              onClick={() => guess({ semitones: iv.semitones })}
              data-testid={`interval-choice-${iv.semitones}`}
            >
              {iv.label}
            </Button>
          ))}
        </div>
      )}

      <div className="flex gap-2">
        <Button
          type="button"
          className="flex-1"
          disabled={verdict === null}
          onClick={() => nextRound(mode)}
          data-testid="next-round"
        >
          Suivant
        </Button>
        <Button
          type="button"
          variant="ghost"
          onClick={resetSession}
          data-testid="reset-session"
          aria-label="Réinitialiser le score"
        >
          <RotateCcw className="h-4 w-4" />
        </Button>
      </div>
    </div>
  );
}
