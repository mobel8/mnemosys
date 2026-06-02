/**
 * Metronome (Vague 16 — Mode Musique).
 *
 * Deliberate-practice tool (Ericsson): a steady beat the learner plays
 * against, plus an optional progressive "tempo ramp" that nudges the BPM up
 * every N bars so practice stays at the edge of ability.
 *
 * Audio design:
 *   - A single shared AudioContext (lazily created on first Start, torn down
 *     on unmount). Each beat schedules one short oscillator blip via
 *     `playTone`; the downbeat (beat 1) is pitched higher + louder as an
 *     accent.
 *   - The beat loop is a `setInterval` whose period is recomputed whenever
 *     BPM changes. All values the tick reads (signature, ramp config, bar
 *     counter) live in refs so updating a slider never recreates the loop or
 *     forces an audio re-render — only the visual `activeBeat` state ticks.
 */

import { Pause, Play } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { getAudioContextCtor, playTone } from "@/lib/audio";
import { cn } from "@/lib/utils";

/** Supported time signatures → beats per bar. */
const SIGNATURES = [
  { value: "2/4", beats: 2 },
  { value: "3/4", beats: 3 },
  { value: "4/4", beats: 4 },
] as const;

type Signature = (typeof SIGNATURES)[number]["value"];

const MIN_BPM = 40;
const MAX_BPM = 240;
const ACCENT_FREQ_HZ = 880;
const BEAT_FREQ_HZ = 440;

function beatsForSignature(sig: Signature): number {
  return SIGNATURES.find((s) => s.value === sig)?.beats ?? 4;
}

export interface MetronomeProps {
  className?: string;
}

export function Metronome({ className }: MetronomeProps) {
  const [bpm, setBpm] = useState(100);
  const [signature, setSignature] = useState<Signature>("4/4");
  const [running, setRunning] = useState(false);
  /** Beat currently sounding (0-based), or -1 when stopped. Drives the pulse. */
  const [activeBeat, setActiveBeat] = useState(-1);

  // Tempo ramp (deliberate, progressive practice).
  const [rampEnabled, setRampEnabled] = useState(false);
  const [rampBars, setRampBars] = useState(4);
  const rampStep = 5;

  const ctxRef = useRef<AudioContext | null>(null);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  // Mirror UI values the tick callback reads so slider changes don't
  // re-create the interval mid-loop.
  const signatureRef = useRef<Signature>(signature);
  const rampEnabledRef = useRef(rampEnabled);
  const rampBarsRef = useRef(rampBars);
  const beatInBarRef = useRef(0);
  const barCountRef = useRef(0);

  signatureRef.current = signature;
  rampEnabledRef.current = rampEnabled;
  rampBarsRef.current = rampBars;

  const stopInterval = useCallback(() => {
    if (intervalRef.current !== null) {
      clearInterval(intervalRef.current);
      intervalRef.current = null;
    }
  }, []);

  /** Sound + visually mark one beat, advancing the bar/ramp bookkeeping. */
  const tick = useCallback(() => {
    const beats = beatsForSignature(signatureRef.current);
    const idx = beatInBarRef.current;
    const isDownbeat = idx === 0;

    const ctx = ctxRef.current;
    if (ctx) {
      playTone(ctx, {
        frequency: isDownbeat ? ACCENT_FREQ_HZ : BEAT_FREQ_HZ,
        durationSeconds: 0.05,
        peakGain: isDownbeat ? 0.12 : 0.07,
        type: "square",
      });
    }
    setActiveBeat(idx);

    const nextBeat = (idx + 1) % beats;
    beatInBarRef.current = nextBeat;
    if (nextBeat === 0) {
      // Completed a bar.
      barCountRef.current += 1;
      if (
        rampEnabledRef.current &&
        rampBarsRef.current > 0 &&
        barCountRef.current % rampBarsRef.current === 0
      ) {
        setBpm((prev) => Math.min(MAX_BPM, prev + rampStep));
      }
    }
  }, []);

  const stop = useCallback(() => {
    stopInterval();
    setRunning(false);
    setActiveBeat(-1);
    beatInBarRef.current = 0;
    barCountRef.current = 0;
  }, [stopInterval]);

  const start = useCallback(() => {
    const Ctor = getAudioContextCtor();
    if (Ctor && !ctxRef.current) {
      try {
        ctxRef.current = new Ctor();
      } catch {
        ctxRef.current = null;
      }
    }
    // Resume in case the context was suspended by an autoplay policy.
    void ctxRef.current?.resume().catch(() => undefined);
    beatInBarRef.current = 0;
    barCountRef.current = 0;
    setRunning(true);
  }, []);

  // (Re)arm the beat loop whenever it's running or the tempo changes. Because
  // `tick` is stable, this effect only re-subscribes on bpm/running flips.
  useEffect(() => {
    if (!running) return;
    const periodMs = 60_000 / bpm;
    tick(); // fire the first beat immediately, then on the interval
    intervalRef.current = setInterval(tick, periodMs);
    return () => {
      if (intervalRef.current !== null) {
        clearInterval(intervalRef.current);
        intervalRef.current = null;
      }
    };
  }, [running, bpm, tick]);

  // Tear the AudioContext down on unmount.
  useEffect(() => {
    return () => {
      stopInterval();
      if (ctxRef.current) {
        void ctxRef.current.close().catch(() => undefined);
        ctxRef.current = null;
      }
    };
  }, [stopInterval]);

  const beats = beatsForSignature(signature);
  // Stable, semantic dot identities (beat position never reorders within a
  // signature), so we map over descriptors instead of raw array indices.
  const beatDots = Array.from({ length: beats }, (_, i) => ({
    index: i,
    id: `${signature}-beat-${i + 1}`,
    isDownbeat: i === 0,
  }));

  return (
    <div className={cn("space-y-6", className)} data-testid="metronome">
      {/* Visual pulse: one dot per beat, accent on the downbeat. */}
      <div className="flex items-center justify-center gap-3 py-4" aria-hidden="true">
        {beatDots.map((dot) => {
          const active = running && activeBeat === dot.index;
          return (
            <span
              key={dot.id}
              data-testid={`beat-dot-${dot.index}`}
              data-active={active ? "true" : "false"}
              className={cn(
                "rounded-full transition-transform duration-100 ease-out",
                dot.isDownbeat ? "ring-2 ring-primary/60" : "",
                active ? "scale-125 bg-primary" : "scale-100 bg-muted-foreground/30",
                dot.isDownbeat ? "h-7 w-7" : "h-6 w-6",
              )}
            />
          );
        })}
      </div>

      <div className="flex items-baseline justify-center gap-2">
        <span
          className="font-display text-5xl font-semibold tabular-nums tracking-tight"
          data-testid="bpm-value"
        >
          {bpm}
        </span>
        <span className="font-mono text-sm uppercase tracking-wide text-muted-foreground">BPM</span>
      </div>

      {/* BPM control — a native range so the loop reads a fresh value without
          fighting Radix's controlled-Slider commit timing during tests. */}
      <div className="space-y-2">
        <label
          htmlFor="metronome-bpm"
          className="flex items-center justify-between text-sm text-muted-foreground"
        >
          <span>Tempo</span>
          <span className="font-mono tabular-nums">
            {MIN_BPM}–{MAX_BPM}
          </span>
        </label>
        <input
          id="metronome-bpm"
          type="range"
          min={MIN_BPM}
          max={MAX_BPM}
          step={1}
          value={bpm}
          onChange={(e) => setBpm(Number(e.target.value))}
          className="w-full accent-primary"
          data-testid="bpm-slider"
        />
      </div>

      <div className="space-y-2">
        <Label htmlFor="metronome-signature" className="text-muted-foreground">
          Signature
        </Label>
        <Select
          value={signature}
          onValueChange={(v) => {
            setSignature(v as Signature);
            beatInBarRef.current = 0;
          }}
        >
          <SelectTrigger
            id="metronome-signature"
            aria-label="Signature"
            data-testid="signature-select"
          >
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {SIGNATURES.map((s) => (
              <SelectItem key={s.value} value={s.value}>
                {s.value}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {/* Tempo ramp — progressive deliberate practice. */}
      <div className="space-y-3 rounded-xl border bg-muted/30 p-4">
        <div className="flex items-center justify-between text-sm">
          <Label htmlFor="ramp-toggle" className="font-medium">
            Montée de tempo (+{rampStep} BPM)
          </Label>
          <Switch
            id="ramp-toggle"
            checked={rampEnabled}
            onCheckedChange={setRampEnabled}
            aria-label="Activer le tempo ramp"
            data-testid="ramp-toggle"
          />
        </div>
        {rampEnabled && (
          <label
            htmlFor="ramp-bars"
            className="flex items-center justify-between text-sm text-muted-foreground"
          >
            <span>Toutes les</span>
            <span className="flex items-center gap-2">
              <input
                id="ramp-bars"
                type="number"
                min={1}
                max={32}
                value={rampBars}
                onChange={(e) => setRampBars(Math.max(1, Number(e.target.value) || 1))}
                className="h-8 w-16 rounded-lg border border-input bg-card px-2 text-right font-mono text-sm tabular-nums shadow-xs focus:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
                data-testid="ramp-bars"
              />
              <span>mesures</span>
            </span>
          </label>
        )}
      </div>

      <Button
        type="button"
        size="lg"
        className="w-full gap-2"
        onClick={() => (running ? stop() : start())}
        data-testid="metronome-toggle"
      >
        {running ? (
          <>
            <Pause className="h-4 w-4" /> Stop
          </>
        ) : (
          <>
            <Play className="h-4 w-4" /> Démarrer
          </>
        )}
      </Button>
    </div>
  );
}
