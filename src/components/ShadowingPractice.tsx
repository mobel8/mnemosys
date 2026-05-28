/**
 * Shadowing Mode (Vague 17 — Arguelles / polyglot shadowing technique).
 *
 * The learner:
 *   1. Types (or pastes) a sentence to shadow.
 *   2. Hits "Écouter" → the sentence is synthesised with OpenAI TTS (reusing
 *      the existing `synthesize_audio` command) and played as the reference.
 *   3. Hits "Enregistrer" → MediaRecorder captures their own voice (same
 *      pattern as VoiceAnswerButton), then plays it back.
 *   4. Both clips are decoded to PCM, down-sampled to ~200 peaks and drawn as
 *      mirrored bar waveforms, stacked so the learner can eyeball rhythm and
 *      stress against the reference.
 *
 * Deliberately NO automatic pronunciation scoring — that needs forced
 * alignment / phoneme models well beyond this scope. The value here is the
 * tight listen → imitate → compare loop.
 *
 * Cleanup: the shared `AudioContext`, the active `MediaStream`, the recorder
 * and the auto-stop timer are all torn down on unmount.
 */

import { convertFileSrc } from "@tauri-apps/api/core";
import { AudioLines, Loader2, Mic, Play, Square, Volume2 } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "@/components/ui/use-toast";
import { useSettingsQuery, useSynthesizeAudio } from "@/lib/queries";
import type { TTSVoice } from "@/lib/tauri";

/** Auto-stop a runaway recording (mirrors VoiceAnswerButton's ceiling). */
const MAX_DURATION_MS = 15_000;
/** Down-sample every decoded clip to this many bars. */
const WAVEFORM_BARS = 200;
const RECORDING_MIME = "audio/webm";
const DEFAULT_VOICE: TTSVoice = "nova";
const VALID_VOICES: readonly TTSVoice[] = [
  "alloy",
  "echo",
  "fable",
  "onyx",
  "nova",
  "shimmer",
  "coral",
  "sage",
];

function resolveVoice(raw: string | null | undefined): TTSVoice {
  if (raw && (VALID_VOICES as readonly string[]).includes(raw)) return raw as TTSVoice;
  return DEFAULT_VOICE;
}

type RecordingState = "idle" | "recording" | "processing";

/**
 * Reduce a mono PCM channel to `bars` normalised peak amplitudes in [0, 1].
 * Each bar is the max absolute sample over its window — cheap and visually
 * faithful for a small bar count. Exported for unit testing.
 */
export function computeWaveformPeaks(samples: Float32Array, bars: number): number[] {
  if (bars <= 0 || samples.length === 0) return [];
  const windowSize = Math.max(1, Math.floor(samples.length / bars));
  const peaks: number[] = [];
  let globalMax = 0;
  for (let b = 0; b < bars; b += 1) {
    const start = b * windowSize;
    if (start >= samples.length) {
      peaks.push(0);
      continue;
    }
    const end = Math.min(start + windowSize, samples.length);
    let localMax = 0;
    for (let i = start; i < end; i += 1) {
      const abs = Math.abs(samples[i] ?? 0);
      if (abs > localMax) localMax = abs;
    }
    peaks.push(localMax);
    if (localMax > globalMax) globalMax = localMax;
  }
  // Normalise so the loudest bar reaches full height.
  if (globalMax > 0) {
    for (let i = 0; i < peaks.length; i += 1) peaks[i] = (peaks[i] ?? 0) / globalMax;
  }
  return peaks;
}

/** Paint a mirrored bar waveform onto a canvas, scaled to its CSS size. */
function drawWaveform(canvas: HTMLCanvasElement, peaks: number[], color: string) {
  const ctx = canvas.getContext("2d");
  if (!ctx) return;
  const dpr = typeof window !== "undefined" ? (window.devicePixelRatio ?? 1) : 1;
  const cssWidth = canvas.clientWidth || 600;
  const cssHeight = canvas.clientHeight || 80;
  // Match the backing store to the displayed size for crisp bars.
  canvas.width = Math.round(cssWidth * dpr);
  canvas.height = Math.round(cssHeight * dpr);
  ctx.scale(dpr, dpr);
  ctx.clearRect(0, 0, cssWidth, cssHeight);

  if (peaks.length === 0) return;
  const mid = cssHeight / 2;
  const barWidth = cssWidth / peaks.length;
  const gap = barWidth > 2 ? 1 : 0;
  ctx.fillStyle = color;
  for (let i = 0; i < peaks.length; i += 1) {
    const peak = peaks[i] ?? 0;
    const h = Math.max(1, peak * (cssHeight - 4));
    const x = i * barWidth;
    ctx.fillRect(x, mid - h / 2, Math.max(1, barWidth - gap), h);
  }
}

export function ShadowingPractice() {
  const [sentence, setSentence] = useState("");
  const [recState, setRecState] = useState<RecordingState>("idle");
  const [refPeaks, setRefPeaks] = useState<number[]>([]);
  const [userPeaks, setUserPeaks] = useState<number[]>([]);
  const [userAudioUrl, setUserAudioUrl] = useState<string | null>(null);

  const settingsQuery = useSettingsQuery();
  const synthesize = useSynthesizeAudio();

  const voice = resolveVoice(settingsQuery.data?.tts_voice);
  const speed = settingsQuery.data?.tts_speed ?? 1.0;

  // --- refs for imperative audio plumbing ---------------------------------
  const audioCtxRef = useRef<AudioContext | null>(null);
  const refAudioRef = useRef<HTMLAudioElement | null>(null);
  const userAudioRef = useRef<HTMLAudioElement | null>(null);
  const refCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const userCanvasRef = useRef<HTMLCanvasElement | null>(null);

  const recorderRef = useRef<MediaRecorder | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const stopTimerRef = useRef<number | null>(null);
  // Track the last object URL so we can revoke it before replacing.
  const userUrlRef = useRef<string | null>(null);

  /** Lazily build (or resume) the shared AudioContext for decoding. */
  const getAudioContext = useCallback((): AudioContext | null => {
    if (typeof window === "undefined") return null;
    const Ctor =
      window.AudioContext ??
      (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Ctor) return null;
    if (!audioCtxRef.current || audioCtxRef.current.state === "closed") {
      audioCtxRef.current = new Ctor();
    }
    return audioCtxRef.current;
  }, []);

  /** Decode an ArrayBuffer to peaks for the first channel. */
  const decodeToPeaks = useCallback(
    async (buffer: ArrayBuffer): Promise<number[]> => {
      const ctx = getAudioContext();
      if (!ctx) return [];
      // decodeAudioData detaches the buffer — pass a copy so callers can reuse.
      const audioBuffer = await ctx.decodeAudioData(buffer.slice(0));
      const channel = audioBuffer.getChannelData(0);
      return computeWaveformPeaks(channel, WAVEFORM_BARS);
    },
    [getAudioContext],
  );

  const clearStopTimer = useCallback(() => {
    if (stopTimerRef.current !== null) {
      window.clearTimeout(stopTimerRef.current);
      stopTimerRef.current = null;
    }
  }, []);

  const cleanupStream = useCallback(() => {
    if (streamRef.current) {
      for (const track of streamRef.current.getTracks()) track.stop();
      streamRef.current = null;
    }
  }, []);

  // Tear everything down on unmount.
  useEffect(() => {
    return () => {
      clearStopTimer();
      try {
        recorderRef.current?.stop();
      } catch {
        /* recorder may be inactive — ignore */
      }
      cleanupStream();
      if (userUrlRef.current) {
        URL.revokeObjectURL(userUrlRef.current);
        userUrlRef.current = null;
      }
      if (audioCtxRef.current && audioCtxRef.current.state !== "closed") {
        void audioCtxRef.current.close().catch(() => {});
      }
      audioCtxRef.current = null;
    };
  }, [clearStopTimer, cleanupStream]);

  // Re-paint canvases whenever peaks change.
  useEffect(() => {
    if (refCanvasRef.current) drawWaveform(refCanvasRef.current, refPeaks, "#3b82f6");
  }, [refPeaks]);
  useEffect(() => {
    if (userCanvasRef.current) drawWaveform(userCanvasRef.current, userPeaks, "#f59e0b");
  }, [userPeaks]);

  // ----- Reference (TTS) -------------------------------------------------

  async function handleListen() {
    const trimmed = sentence.trim();
    if (trimmed.length === 0) return;
    try {
      const result = await synthesize.mutateAsync({ text: trimmed, voice, speed });
      const src = convertFileSrc(result.path);
      // Play it…
      const audio = refAudioRef.current;
      if (audio) {
        audio.src = src;
        audio.currentTime = 0;
        void audio.play().catch(() => {});
      }
      // …and decode it for the reference waveform.
      try {
        const resp = await fetch(src);
        const buf = await resp.arrayBuffer();
        const peaks = await decodeToPeaks(buf);
        setRefPeaks(peaks);
      } catch (err) {
        console.warn("[shadowing] could not decode reference audio", err);
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      const isMissingKey = /api key/i.test(message);
      toast({
        title: isMissingKey ? "Clé API manquante" : "Synthèse vocale impossible",
        description: isMissingKey ? "Configure ta clé OpenAI dans Settings." : message,
        variant: "destructive",
      });
    }
  }

  // ----- User recording --------------------------------------------------

  const stopRecording = useCallback(() => {
    clearStopTimer();
    const recorder = recorderRef.current;
    if (recorder && recorder.state !== "inactive") {
      try {
        recorder.stop();
      } catch {
        /* stop() twice throws on some platforms — ignore */
      }
    }
  }, [clearStopTimer]);

  async function handleRecord() {
    if (recState === "recording") {
      stopRecording();
      return;
    }
    if (recState !== "idle") return;

    if (typeof navigator === "undefined" || !navigator.mediaDevices?.getUserMedia) {
      toast({
        title: "Micro indisponible",
        description: "Ce navigateur ne fournit pas l'API d'enregistrement audio.",
        variant: "destructive",
      });
      return;
    }

    let stream: MediaStream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    } catch (err) {
      toast({
        title: "Accès micro refusé",
        description: err instanceof Error ? err.message : String(err),
        variant: "destructive",
      });
      return;
    }
    streamRef.current = stream;

    let recorder: MediaRecorder;
    try {
      const supported =
        typeof MediaRecorder !== "undefined" && MediaRecorder.isTypeSupported?.(RECORDING_MIME);
      recorder = supported
        ? new MediaRecorder(stream, { mimeType: RECORDING_MIME })
        : new MediaRecorder(stream);
    } catch (err) {
      cleanupStream();
      toast({
        title: "Enregistreur indisponible",
        description: err instanceof Error ? err.message : String(err),
        variant: "destructive",
      });
      return;
    }

    chunksRef.current = [];
    recorder.ondataavailable = (event) => {
      if (event.data.size > 0) chunksRef.current.push(event.data);
    };
    recorder.onstop = async () => {
      cleanupStream();
      const chunks = chunksRef.current;
      chunksRef.current = [];
      if (chunks.length === 0) {
        setRecState("idle");
        return;
      }
      setRecState("processing");
      const blob = new Blob(chunks, { type: recorder.mimeType || RECORDING_MIME });

      // Swap in a fresh object URL for replay (revoke the previous one).
      if (userUrlRef.current) URL.revokeObjectURL(userUrlRef.current);
      const url = URL.createObjectURL(blob);
      userUrlRef.current = url;
      setUserAudioUrl(url);

      try {
        const buf = await blob.arrayBuffer();
        const peaks = await decodeToPeaks(buf);
        setUserPeaks(peaks);
      } catch (err) {
        console.warn("[shadowing] could not decode recording", err);
        toast({
          title: "Analyse audio impossible",
          description: "L'enregistrement a été capturé mais n'a pas pu être décodé.",
          variant: "destructive",
        });
      } finally {
        setRecState("idle");
      }
    };

    recorderRef.current = recorder;
    try {
      recorder.start();
    } catch (err) {
      cleanupStream();
      toast({
        title: "Enregistrement impossible",
        description: err instanceof Error ? err.message : String(err),
        variant: "destructive",
      });
      return;
    }
    setRecState("recording");
    stopTimerRef.current = window.setTimeout(stopRecording, MAX_DURATION_MS);
  }

  function handleReplayUser() {
    const audio = userAudioRef.current;
    if (audio && userAudioUrl) {
      audio.currentTime = 0;
      void audio.play().catch(() => {});
    }
  }

  const trimmed = sentence.trim();
  const isSynth = synthesize.isPending;
  const isRecording = recState === "recording";
  const isProcessing = recState === "processing";

  return (
    <div className="space-y-6" data-testid="shadowing-practice">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-lg">
            <AudioLines className="h-5 w-5 text-primary" />
            Phrase à shadower
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="shadowing-sentence">Saisis ou colle une phrase</Label>
            <Textarea
              id="shadowing-sentence"
              rows={3}
              value={sentence}
              onChange={(e) => setSentence(e.target.value)}
              placeholder="Ex. « Je voudrais réserver une table pour deux personnes. »"
              className="text-base"
            />
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <Button
              type="button"
              onClick={() => void handleListen()}
              disabled={trimmed.length === 0 || isSynth}
              data-testid="listen-button"
            >
              {isSynth ? (
                <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
              ) : (
                <Volume2 className="h-4 w-4" aria-hidden />
              )}
              Écouter (référence)
            </Button>

            <Button
              type="button"
              variant={isRecording ? "destructive" : "default"}
              onClick={() => void handleRecord()}
              disabled={isProcessing}
              aria-pressed={isRecording}
              data-testid="record-button"
            >
              {isProcessing ? (
                <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
              ) : isRecording ? (
                <Square className="h-4 w-4" aria-hidden />
              ) : (
                <Mic className="h-4 w-4" aria-hidden />
              )}
              {isRecording ? "Arrêter" : isProcessing ? "Analyse…" : "Enregistrer"}
            </Button>

            {userAudioUrl && !isRecording && (
              <Button
                type="button"
                variant="outline"
                onClick={handleReplayUser}
                data-testid="replay-button"
              >
                <Play className="h-4 w-4" aria-hidden />
                Réécouter ma voix
              </Button>
            )}

            {isRecording && (
              <span className="inline-flex items-center gap-1 text-xs text-muted-foreground">
                <span className="h-2 w-2 animate-pulse rounded-full bg-red-500" aria-hidden />
                Max {(MAX_DURATION_MS / 1000).toFixed(0)} s
              </span>
            )}
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-lg">Comparaison des waveforms</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-1.5">
            <p className="text-xs font-medium uppercase tracking-wide text-blue-600 dark:text-blue-400">
              Référence (TTS)
            </p>
            <div className="rounded-md border bg-muted/20 p-2">
              <canvas
                ref={refCanvasRef}
                className="h-20 w-full"
                data-testid="reference-waveform"
                data-haspeaks={refPeaks.length > 0}
              />
            </div>
            {refPeaks.length === 0 && (
              <p className="text-xs text-muted-foreground">
                Clique « Écouter » pour générer la forme d'onde de référence.
              </p>
            )}
          </div>

          <div className="space-y-1.5">
            <p className="text-xs font-medium uppercase tracking-wide text-amber-600 dark:text-amber-400">
              Ta voix
            </p>
            <div className="rounded-md border bg-muted/20 p-2">
              <canvas
                ref={userCanvasRef}
                className="h-20 w-full"
                data-testid="user-waveform"
                data-haspeaks={userPeaks.length > 0}
              />
            </div>
            {userPeaks.length === 0 && (
              <p className="text-xs text-muted-foreground">
                Enregistre-toi en répétant la phrase pour comparer ton rythme à la référence.
              </p>
            )}
          </div>

          <p className="text-xs text-muted-foreground">
            Compare visuellement le rythme, les pauses et l'accentuation. Pas de note automatique :
            l'objectif est la boucle écoute → imitation → comparaison (technique d'Arguelles).
          </p>
        </CardContent>
      </Card>

      {/* biome-ignore lint/a11y/useMediaCaption: TTS playback of user text — no captions. */}
      <audio ref={refAudioRef} preload="none" className="hidden" />
      {/* biome-ignore lint/a11y/useMediaCaption: playback of the learner's own recording. */}
      <audio ref={userAudioRef} preload="none" className="hidden" src={userAudioUrl ?? undefined} />
    </div>
  );
}
