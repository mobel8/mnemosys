/**
 * Whisper Mode Review — capture a voice answer (Vague 8).
 *
 * Lifecycle:
 *   1. idle      — Mic icon, "Enregistrer"
 *   2. recording — animated pulsing dot + elapsed seconds, "Arrêter"
 *   3. transcribing — Loader, button disabled
 *   4. idle      — same as #1, ready to record again
 *
 * Recording stops on click, on `MAX_DURATION_MS` timeout, or when the
 * component unmounts. The blob is base64-encoded (sans data: prefix) and
 * sent through `transcribe_voice_answer`. The resulting text is forwarded
 * to `onTranscribed` so the parent can fuzzy-match it just like a typed
 * answer.
 *
 * Notes:
 *   - We use `audio/webm` because every Chromium-based webview (i.e. Tauri)
 *     supports it. Whisper accepts webm/opus natively.
 *   - Microphone access is requested on the first click. If the user denies
 *     permission, we surface a toast and stay in `idle`.
 */

import { Loader2, Mic, MicOff, Square } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { toast } from "@/components/ui/use-toast";
import { useTranscribeVoiceAnswer } from "@/lib/queries";
import { cn } from "@/lib/utils";

/** Hard ceiling: auto-stop a 10s recording so a stuck mic doesn't bill the user. */
export const MAX_DURATION_MS = 10_000;

/** Default MIME for MediaRecorder in Chromium-based webviews. */
const RECORDING_MIME = "audio/webm";

interface VoiceAnswerButtonProps {
  /** ISO-639-1 hint forwarded to Whisper (`"fr"`, `"en"`, …). Optional. */
  language?: string;
  /** External disable (e.g. while submitting). */
  disabled?: boolean;
  /** Fired once Whisper returns the transcribed text (already trimmed). */
  onTranscribed: (text: string) => void;
  /** Class names appended to the outer wrapper. */
  className?: string;
}

/** Strip the `data:audio/...;base64,` prefix Whisper does not expect. */
function stripDataUrlPrefix(dataUrl: string): string {
  const idx = dataUrl.indexOf(",");
  return idx >= 0 ? dataUrl.slice(idx + 1) : dataUrl;
}

/** Read a Blob as a base64 string (without the data URL prefix). */
function blobToBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = reader.result;
      if (typeof result !== "string") {
        reject(new Error("FileReader returned non-string result"));
        return;
      }
      resolve(stripDataUrlPrefix(result));
    };
    reader.onerror = () => reject(reader.error ?? new Error("FileReader failed"));
    reader.readAsDataURL(blob);
  });
}

type RecordingState = "idle" | "recording" | "transcribing";

export function VoiceAnswerButton({
  language,
  disabled = false,
  onTranscribed,
  className,
}: VoiceAnswerButtonProps) {
  const [state, setState] = useState<RecordingState>("idle");
  const [elapsedMs, setElapsedMs] = useState(0);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const streamRef = useRef<MediaStream | null>(null);
  const stopTimerRef = useRef<number | null>(null);
  const tickTimerRef = useRef<number | null>(null);
  const startedAtRef = useRef<number>(0);

  const transcribe = useTranscribeVoiceAnswer({
    onSuccess: (text) => {
      setState("idle");
      onTranscribed(text);
    },
    onError: (err) => {
      setState("idle");
      const message = err.message ?? "Erreur inconnue";
      const isMissingKey = /api key/i.test(message);
      toast({
        title: isMissingKey ? "Clé API manquante" : "Transcription impossible",
        description: isMissingKey ? "Configure ta clé OpenAI dans Settings." : message,
        variant: "destructive",
      });
    },
  });

  const cleanupStream = useCallback(() => {
    if (streamRef.current) {
      for (const track of streamRef.current.getTracks()) track.stop();
      streamRef.current = null;
    }
  }, []);

  const clearTimers = useCallback(() => {
    if (stopTimerRef.current !== null) {
      window.clearTimeout(stopTimerRef.current);
      stopTimerRef.current = null;
    }
    if (tickTimerRef.current !== null) {
      window.clearInterval(tickTimerRef.current);
      tickTimerRef.current = null;
    }
  }, []);

  // Auto-cleanup if the component unmounts mid-recording.
  useEffect(() => {
    return () => {
      clearTimers();
      try {
        recorderRef.current?.stop();
      } catch {
        // recorder may already be inactive — ignore.
      }
      cleanupStream();
    };
  }, [cleanupStream, clearTimers]);

  const stopRecording = useCallback(() => {
    clearTimers();
    const recorder = recorderRef.current;
    if (recorder && recorder.state !== "inactive") {
      try {
        recorder.stop();
      } catch {
        // Some platforms throw if stop() is called twice — safe to ignore.
      }
    }
  }, [clearTimers]);

  const handleStart = useCallback(async () => {
    if (disabled || state !== "idle") return;

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
      const message = err instanceof Error ? err.message : String(err);
      toast({
        title: "Accès micro refusé",
        description: message,
        variant: "destructive",
      });
      return;
    }
    streamRef.current = stream;

    let recorder: MediaRecorder;
    try {
      // Some webviews don't accept the mimeType option — fall back to default.
      const supported =
        typeof MediaRecorder !== "undefined" && MediaRecorder.isTypeSupported?.(RECORDING_MIME);
      recorder = supported
        ? new MediaRecorder(stream, { mimeType: RECORDING_MIME })
        : new MediaRecorder(stream);
    } catch (err) {
      cleanupStream();
      const message = err instanceof Error ? err.message : String(err);
      toast({
        title: "Enregistreur indisponible",
        description: message,
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
        setState("idle");
        return;
      }
      const blob = new Blob(chunks, { type: recorder.mimeType || RECORDING_MIME });
      setState("transcribing");
      try {
        const audioBase64 = await blobToBase64(blob);
        transcribe.mutate({
          audioBase64,
          mimeType: recorder.mimeType || RECORDING_MIME,
          language,
        });
      } catch (err) {
        setState("idle");
        const message = err instanceof Error ? err.message : String(err);
        toast({
          title: "Conversion impossible",
          description: message,
          variant: "destructive",
        });
      }
    };
    recorderRef.current = recorder;
    startedAtRef.current = Date.now();
    setElapsedMs(0);

    try {
      recorder.start();
    } catch (err) {
      cleanupStream();
      const message = err instanceof Error ? err.message : String(err);
      toast({
        title: "Enregistrement impossible",
        description: message,
        variant: "destructive",
      });
      return;
    }
    setState("recording");

    tickTimerRef.current = window.setInterval(() => {
      setElapsedMs(Date.now() - startedAtRef.current);
    }, 150);
    stopTimerRef.current = window.setTimeout(() => {
      stopRecording();
    }, MAX_DURATION_MS);
  }, [cleanupStream, disabled, language, state, stopRecording, transcribe]);

  const handleClick = useCallback(() => {
    if (state === "recording") {
      stopRecording();
    } else if (state === "idle") {
      void handleStart();
    }
  }, [handleStart, state, stopRecording]);

  const isBusy = state === "transcribing";
  const isRecording = state === "recording";
  const buttonDisabled = disabled || isBusy;

  const buttonLabel =
    state === "transcribing" ? "Transcription…" : state === "recording" ? "Arrêter" : "Enregistrer";

  const elapsedSeconds = Math.min(MAX_DURATION_MS, elapsedMs) / 1000;

  return (
    <div
      className={cn("flex w-full max-w-xl flex-col gap-2", className)}
      data-testid="voice-answer-button"
    >
      <div className="flex items-center gap-2">
        <Button
          type="button"
          onClick={handleClick}
          disabled={buttonDisabled}
          variant={isRecording ? "destructive" : "default"}
          aria-label={buttonLabel}
          aria-pressed={isRecording}
        >
          {isBusy ? (
            <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
          ) : isRecording ? (
            <Square className="h-4 w-4" aria-hidden />
          ) : (
            <Mic className="h-4 w-4" aria-hidden />
          )}
          <span className="ml-1">{buttonLabel}</span>
        </Button>
        {isRecording && (
          <span
            className="inline-flex items-center gap-1 text-xs text-muted-foreground"
            data-testid="voice-answer-timer"
          >
            <span className="h-2 w-2 animate-pulse rounded-full bg-red-500" aria-hidden />
            {elapsedSeconds.toFixed(1)} / {(MAX_DURATION_MS / 1000).toFixed(0)} s
          </span>
        )}
        {!isRecording && !isBusy && (
          <span className="inline-flex items-center gap-1 text-xs text-muted-foreground">
            <MicOff className="h-3 w-3" aria-hidden />
            Maximum 10 secondes
          </span>
        )}
      </div>
      <p className="text-xs text-muted-foreground">
        Réponds à voix haute. La transcription Whisper sera comparée à la réponse attendue.
      </p>
    </div>
  );
}
