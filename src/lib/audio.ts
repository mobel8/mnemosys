/**
 * Tiny Web Audio helpers shared by the creative-practice tools (Vague 16:
 * metronome, ear training). Centralises the cross-browser AudioContext
 * lookup and a one-shot tone player so individual components don't each
 * reimplement the `window.AudioContext ?? webkitAudioContext` dance and the
 * gain-envelope boilerplate.
 *
 * Everything here is best-effort: in environments without Web Audio (jsdom
 * during tests, locked-down WebViews) the constructor resolves to `undefined`
 * and callers simply get a no-op. Nothing throws.
 */

/** Resolve the platform AudioContext constructor, or `undefined` if absent. */
export function getAudioContextCtor(): typeof AudioContext | undefined {
  if (typeof window === "undefined") return undefined;
  return (
    window.AudioContext ??
    (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext
  );
}

/** Standard concert pitches (Hz) for the 12 chromatic notes in octave 4. */
export const NOTE_FREQUENCIES_HZ: Record<string, number> = {
  C4: 261.63,
  "C#4": 277.18,
  D4: 293.66,
  "D#4": 311.13,
  E4: 329.63,
  F4: 349.23,
  "F#4": 369.99,
  G4: 392.0,
  "G#4": 415.3,
  A4: 440.0,
  "A#4": 466.16,
  B4: 493.88,
};

export interface ToneOptions {
  /** Oscillator frequency in Hz. */
  frequency: number;
  /** Note duration in seconds. Defaults to 0.15s (a short click/blip). */
  durationSeconds?: number;
  /** Peak gain (0..1). Defaults to 0.08 to stay gentle. */
  peakGain?: number;
  /** Oscillator waveform. Defaults to "sine". */
  type?: OscillatorType;
  /** Start offset from `ctx.currentTime` in seconds. Defaults to 0. */
  startOffsetSeconds?: number;
}

/**
 * Play a single tone with a short attack/decay envelope on an existing
 * AudioContext. Returns silently if the context is closed. The envelope
 * avoids the click that a raw `osc.start()/stop()` produces.
 */
export function playTone(ctx: AudioContext, options: ToneOptions): void {
  const {
    frequency,
    durationSeconds = 0.15,
    peakGain = 0.08,
    type = "sine",
    startOffsetSeconds = 0,
  } = options;
  if (ctx.state === "closed") return;
  try {
    const start = ctx.currentTime + startOffsetSeconds;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(frequency, start);
    // Exponential ramps can't touch 0, so we use a tiny epsilon floor.
    gain.gain.setValueAtTime(0.0001, start);
    gain.gain.exponentialRampToValueAtTime(peakGain, start + 0.01);
    gain.gain.exponentialRampToValueAtTime(0.0001, start + durationSeconds);
    osc.connect(gain).connect(ctx.destination);
    osc.start(start);
    osc.stop(start + durationSeconds + 0.02);
  } catch {
    // Best-effort: a blocked/garbage-collected context shouldn't crash the UI.
  }
}
