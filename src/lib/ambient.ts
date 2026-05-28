/**
 * Context ambient-sound generator (Vague 18 — Godden & Baddeley 1975).
 *
 * Context-dependent memory: reinstating the study *context* at recall boosts
 * retrieval. A steady, non-distracting soundscape during review sessions is a
 * cheap, fully-local way to create that context (and to mask a noisy room).
 *
 * Everything is synthesised with the Web Audio API — no audio assets ship with
 * the app. We generate a few seconds of noise into an `AudioBuffer` and loop it
 * through an `AudioBufferSourceNode`, attenuated by a low gain so the ambience
 * sits well under the learner's attention.
 *
 * Noise colours:
 *   - white : flat spectrum (equal power per Hz).
 *   - pink  : −3 dB/octave (equal power per octave) — the classic « calm » hiss.
 *   - brown : −6 dB/octave (Brownian / red noise) — deep, rumbly.
 *   - rain  : brown noise through a low-pass + a slow amplitude shimmer.
 *
 * Best-effort: in environments without Web Audio (jsdom, locked-down WebViews)
 * `createAmbient` returns a controller whose methods are safe no-ops. Nothing
 * throws.
 */

import { getAudioContextCtor } from "@/lib/audio";

/** The ambient-sound kinds persisted in `AppSettings.ambient_sound`. */
export type AmbientKind = "none" | "white" | "pink" | "brown" | "rain";

/** Imperative handle over a running (or idle) ambient soundscape. */
export interface AmbientController {
  /** Start (or resume) playback. Idempotent — calling twice won't stack sources. */
  start: () => void;
  /** Stop playback and release every audio node + the context. Idempotent. */
  stop: () => void;
  /** The kind this controller plays (handy for tests / debugging). */
  readonly kind: AmbientKind;
}

/** Seconds of noise we synthesise before looping. Long enough that the loop
 *  point is imperceptible, short enough to keep the buffer small. */
const BUFFER_SECONDS = 3;

/** Default ambience gain. Deliberately low so it stays in the background. */
const DEFAULT_GAIN = 0.1;

/** A controller that does nothing — returned for `"none"` or when Web Audio
 *  is unavailable. Keeps call sites branch-free. */
function noopController(kind: AmbientKind): AmbientController {
  return { start: () => {}, stop: () => {}, kind };
}

/**
 * Fill `data` with one buffer's worth of the requested noise colour. Pulled
 * out so it's unit-testable without an AudioContext. Mutates `data` in place.
 */
export function fillNoiseBuffer(data: Float32Array, kind: Exclude<AmbientKind, "none">): void {
  switch (kind) {
    case "white": {
      for (let i = 0; i < data.length; i++) {
        data[i] = Math.random() * 2 - 1;
      }
      break;
    }
    case "pink": {
      // Paul Kellet's refined pink-noise filter (7-pole approximation).
      let b0 = 0;
      let b1 = 0;
      let b2 = 0;
      let b3 = 0;
      let b4 = 0;
      let b5 = 0;
      let b6 = 0;
      for (let i = 0; i < data.length; i++) {
        const white = Math.random() * 2 - 1;
        b0 = 0.99886 * b0 + white * 0.0555179;
        b1 = 0.99332 * b1 + white * 0.0750759;
        b2 = 0.969 * b2 + white * 0.153852;
        b3 = 0.8665 * b3 + white * 0.3104856;
        b4 = 0.55 * b4 + white * 0.5329522;
        b5 = -0.7616 * b5 - white * 0.016898;
        const pink = b0 + b1 + b2 + b3 + b4 + b5 + b6 + white * 0.5362;
        b6 = white * 0.115926;
        // Scale back into roughly [-1, 1] (the sum runs hot).
        data[i] = pink * 0.11;
      }
      break;
    }
    case "rain":
    case "brown": {
      // Brownian noise: integrate white noise, leak slightly to avoid DC drift.
      let last = 0;
      for (let i = 0; i < data.length; i++) {
        const white = Math.random() * 2 - 1;
        last = (last + 0.02 * white) / 1.02;
        // Brown noise is quiet; lift it back toward unity.
        data[i] = last * 3.5;
      }
      break;
    }
  }
}

/**
 * Build an ambient-sound controller for `kind`.
 *
 * `gain` (0..1) overrides the default attenuation; the « Tester » button can
 * pass a slightly higher value. The audio graph is created lazily on the first
 * `start()` so constructing a controller is free.
 */
export function createAmbient(kind: AmbientKind, gain: number = DEFAULT_GAIN): AmbientController {
  if (kind === "none") return noopController(kind);

  const maybeCtor = getAudioContextCtor();
  if (!maybeCtor) return noopController(kind);
  // Re-bind to a non-optional const so the type stays narrowed inside the
  // `start()` closure (TS won't carry a `X | undefined` narrowing across the
  // function boundary on its own).
  const AudioCtor: typeof AudioContext = maybeCtor;
  // `kind` is narrowed away from "none" above, but TS widens it back inside the
  // closures — capture the narrowed value so `fillNoiseBuffer` typechecks.
  const noiseKind: Exclude<AmbientKind, "none"> = kind;

  let ctx: AudioContext | null = null;
  let source: AudioBufferSourceNode | null = null;
  let gainNode: GainNode | null = null;
  let filter: BiquadFilterNode | null = null;
  let lfo: OscillatorNode | null = null;
  let lfoGain: GainNode | null = null;
  let started = false;

  function start(): void {
    if (started) return;
    started = true;
    try {
      ctx = new AudioCtor();
      // Some Web Audio backends (and our test mock) may omit buffer APIs —
      // bail to a silent no-op rather than throwing.
      if (
        typeof ctx.createBuffer !== "function" ||
        typeof ctx.createBufferSource !== "function" ||
        typeof ctx.createGain !== "function"
      ) {
        return;
      }

      const frameCount = Math.max(1, Math.floor(ctx.sampleRate * BUFFER_SECONDS));
      const buffer = ctx.createBuffer(1, frameCount, ctx.sampleRate);
      fillNoiseBuffer(buffer.getChannelData(0), noiseKind);

      source = ctx.createBufferSource();
      source.buffer = buffer;
      source.loop = true;

      gainNode = ctx.createGain();
      gainNode.gain.value = gain;

      // "rain" routes brown noise through a low-pass for a softer hiss plus a
      // slow LFO on the gain to mimic the swell of falling rain.
      if (kind === "rain" && typeof ctx.createBiquadFilter === "function") {
        filter = ctx.createBiquadFilter();
        filter.type = "lowpass";
        filter.frequency.value = 1000;
        source.connect(filter);
        filter.connect(gainNode);

        if (typeof ctx.createOscillator === "function") {
          lfo = ctx.createOscillator();
          lfo.frequency.value = 0.2; // one swell every ~5s
          lfoGain = ctx.createGain();
          lfoGain.gain.value = gain * 0.4;
          lfo.connect(lfoGain);
          lfoGain.connect(gainNode.gain);
          lfo.start();
        }
      } else {
        source.connect(gainNode);
      }

      gainNode.connect(ctx.destination);
      source.start();
    } catch {
      // Best-effort: a blocked context shouldn't crash the review session.
    }
  }

  function stop(): void {
    started = false;
    try {
      lfo?.stop();
    } catch {
      /* already stopped */
    }
    try {
      source?.stop();
    } catch {
      /* already stopped */
    }
    lfo?.disconnect();
    lfoGain?.disconnect();
    source?.disconnect();
    filter?.disconnect();
    gainNode?.disconnect();
    // Closing the context frees the audio thread; ignore the returned promise.
    if (ctx && ctx.state !== "closed") {
      void ctx.close();
    }
    ctx = null;
    source = null;
    gainNode = null;
    filter = null;
    lfo = null;
    lfoGain = null;
  }

  return { start, stop, kind };
}
