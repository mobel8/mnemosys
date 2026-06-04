/**
 * Hands-free Review Mode (Vague 23).
 *
 * An audio-driven alternative to the classic flip/rate loop, meant for
 * reviewing while walking or cooking — eyes and hands free. Per card the
 * machine walks four phases:
 *
 *   question  → TTS reads the recto, then auto-advances to `waiting`.
 *   waiting   → silence while the learner recalls aloud; one tap / the
 *               "Révéler" button (or saying nothing) moves to `answer`.
 *   answer    → TTS reads the verso, then auto-advances to `rating`.
 *   rating    → the learner grades by voice (Whisper maps
 *               "encore/difficile/bien/facile" → 1..4) or by four large
 *               touch buttons. Submitting advances to the next card.
 *
 * Audio: we reuse `synthesize_audio` (via `useSynthesizeAudio`, which already
 * routes to local Piper when enabled) and play the returned disk path through
 * one `<audio>` element wrapped with `convertFileSrc`. Voice grading reuses
 * the same MediaRecorder → Whisper path as `VoiceAnswerButton`.
 *
 * The component owns NOTHING about scheduling: it receives the queue snapshot
 * and reports each grade through `onSubmit`, exactly like the classic
 * `ReviewControls` → `ReviewSession` flow. The parent keeps the FSRS mutation
 * and the end-of-session summary. `onExit` swaps back to the classic UI.
 *
 * Cleanup is deliberate: every phase change and unmount stops the audio
 * element, tears down the mic stream + recorder, and clears all timers so no
 * playback or recording leaks across cards.
 */

import { convertFileSrc } from "@tauri-apps/api/core";
import { Headphones, Keyboard, Loader2, Mic, Square, Volume2 } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { toast } from "@/components/ui/use-toast";
import { useSynthesizeAudio, useTranscribeVoiceAnswer } from "@/lib/queries";
import type { CardWithNote, Note, Rating, TTSVoice } from "@/lib/tauri";
import { cn } from "@/lib/utils";

/** Hard ceiling on a single grade recording so a stuck mic can't run forever. */
const MAX_RECORDING_MS = 6_000;
/** MediaRecorder MIME accepted by every Chromium-based webview + Whisper. */
const RECORDING_MIME = "audio/webm";

type Phase = "question" | "waiting" | "answer" | "rating";

interface HandsFreeReviewProps {
  /** Snapshot of the cards to review, in order. */
  cards: CardWithNote[];
  /** Default TTS voice (from settings); falls back to the synth hook's own. */
  voice?: TTSVoice;
  /** ISO-639-1 hint for Whisper grading (e.g. `"fr"`). */
  language?: string;
  /** Fired once per graded card, mirroring the classic rate path. */
  onSubmit: (cardId: number, rating: Rating, reviewTimeMs: number) => void;
  /** Swap back to the classic flip/rate UI for the rest of the session. */
  onExit: () => void;
  /** All cards done — hand control back so the parent shows its summary. */
  onDone: () => void;
}

/** The four FSRS grades with the spoken keywords that select them. */
const RATING_BUTTONS: {
  rating: Rating;
  label: string;
  keywords: string[];
  className: string;
}[] = [
  {
    rating: 1,
    label: "Encore",
    keywords: ["encore", "again", "1", "un"],
    className: "bg-destructive text-destructive-foreground hover:bg-destructive/90",
  },
  {
    rating: 2,
    label: "Difficile",
    keywords: ["difficile", "hard", "dur", "2", "deux"],
    className: "bg-warning text-warning-foreground hover:bg-warning/90",
  },
  {
    rating: 3,
    label: "Bien",
    keywords: ["bien", "good", "bon", "3", "trois"],
    className: "bg-success text-success-foreground hover:bg-success/90",
  },
  {
    rating: 4,
    label: "Facile",
    keywords: ["facile", "easy", "4", "quatre"],
    className: "bg-chart-2 text-background hover:bg-chart-2/90",
  },
];

/**
 * Map a Whisper transcript to a grade. Matches the first button whose keyword
 * appears as a whole word in the (lowercased) transcript, so "c'était bien"
 * grades Good without "bien" colliding with, say, "bientôt". Returns `null`
 * when nothing matches so the caller can prompt a retry.
 */
export function transcriptToRating(transcript: string): Rating | null {
  const text = transcript.toLowerCase();
  for (const { rating, keywords } of RATING_BUTTONS) {
    for (const kw of keywords) {
      const re = new RegExp(`\\b${kw}\\b`, "i");
      if (re.test(text)) return rating;
    }
  }
  return null;
}

/** Strip the `data:audio/...;base64,` prefix Whisper does not expect. */
function stripDataUrlPrefix(dataUrl: string): string {
  const idx = dataUrl.indexOf(",");
  return idx >= 0 ? dataUrl.slice(idx + 1) : dataUrl;
}

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

/** Best-effort spoken recto, mirroring `ReviewCard`/`ReviewSession` field logic. */
function getSpokenFront(note: Note, cardOrd: number): string {
  const f = note.fields;
  if (note.template === "cloze") {
    // Blank the first cloze so TTS doesn't read the answer aloud.
    const text = typeof f.text === "string" ? f.text : "";
    return text.replace(/\{\{c\d+::(.*?)(::.*?)?\}\}/g, "…");
  }
  if (note.template === "sentence" || note.template === "bidirectional") {
    const source = typeof f.source === "string" ? f.source : "";
    const target = typeof f.target === "string" ? f.target : "";
    return cardOrd === 1 ? target : source;
  }
  if (note.template === "illness_script") {
    const condition = typeof f.condition === "string" ? f.condition : "";
    return condition ? `Décris le tableau de : ${condition}` : "";
  }
  if (note.template === "refutation") {
    const m = typeof f.misconception === "string" ? f.misconception : "";
    return m ? `Vrai ou faux ? ${m}` : "";
  }
  if (note.template === "worked_example") {
    return typeof f.problem === "string" ? f.problem : "";
  }
  return typeof f.front === "string" ? f.front : "";
}

/** Best-effort spoken verso. Reveals the cloze answers for narration. */
function getSpokenBack(note: Note, cardOrd: number): string {
  const f = note.fields;
  if (note.template === "cloze") {
    const text = typeof f.text === "string" ? f.text : "";
    return text.replace(/\{\{c\d+::(.*?)(::.*?)?\}\}/g, "$1");
  }
  if (note.template === "sentence" || note.template === "bidirectional") {
    const source = typeof f.source === "string" ? f.source : "";
    const target = typeof f.target === "string" ? f.target : "";
    return cardOrd === 1 ? source : target;
  }
  if (note.template === "illness_script") {
    const parts = ["epidemiology", "pathophysiology", "clinical", "management"]
      .map((k) => (typeof f[k] === "string" ? (f[k] as string).trim() : ""))
      .filter((v) => v.length > 0);
    return parts.join(". ");
  }
  if (note.template === "refutation") {
    // Verso = « Faux. {correct}. {explanation} » (mirrors ReviewCard).
    const correct = typeof f.correct === "string" ? f.correct.trim() : "";
    const explanation = typeof f.explanation === "string" ? f.explanation.trim() : "";
    if (!correct && !explanation) return "";
    return `Faux. ${correct}${explanation ? `. ${explanation}` : ""}`;
  }
  if (note.template === "worked_example") {
    // Verso = the solution steps then the final answer (mirrors ReviewCard).
    const rawSteps = Array.isArray(f.steps) ? f.steps : [];
    const steps = rawSteps
      .map((s) => (typeof s === "string" ? s.trim() : ""))
      .filter((s) => s.length > 0);
    const answer = typeof f.answer === "string" ? f.answer.trim() : "";
    return [...steps, answer].filter((s) => s.length > 0).join(". ");
  }
  return typeof f.back === "string" ? f.back : "";
}

export function HandsFreeReview({
  cards,
  voice,
  language,
  onSubmit,
  onExit,
  onDone,
}: HandsFreeReviewProps) {
  const [index, setIndex] = useState(0);
  const [phase, setPhase] = useState<Phase>("question");
  const [isSpeaking, setIsSpeaking] = useState(false);
  const [isRecording, setIsRecording] = useState(false);
  const [isTranscribing, setIsTranscribing] = useState(false);

  const audioRef = useRef<HTMLAudioElement | null>(null);
  const cardShownAtRef = useRef<number>(Date.now());
  // Mic plumbing (mirrors VoiceAnswerButton).
  const recorderRef = useRef<MediaRecorder | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const stopTimerRef = useRef<number | null>(null);

  const synthesize = useSynthesizeAudio();
  const transcribe = useTranscribeVoiceAnswer();

  const current = cards[index];

  // -- audio teardown ------------------------------------------------------
  const stopAudio = useCallback(() => {
    const audio = audioRef.current;
    if (audio) {
      audio.pause();
      try {
        audio.currentTime = 0;
      } catch {
        // setting currentTime can throw before metadata loads — ignore.
      }
    }
    setIsSpeaking(false);
  }, []);

  const cleanupMic = useCallback(() => {
    if (stopTimerRef.current !== null) {
      window.clearTimeout(stopTimerRef.current);
      stopTimerRef.current = null;
    }
    const recorder = recorderRef.current;
    if (recorder && recorder.state !== "inactive") {
      try {
        recorder.stop();
      } catch {
        // already inactive — ignore.
      }
    }
    recorderRef.current = null;
    if (streamRef.current) {
      for (const track of streamRef.current.getTracks()) track.stop();
      streamRef.current = null;
    }
    setIsRecording(false);
  }, []);

  // Stop any playback + recording when the card changes or we unmount, so no
  // audio/recorder/timer leaks across cards.
  useEffect(() => {
    return () => {
      stopAudio();
      cleanupMic();
    };
  }, [stopAudio, cleanupMic]);

  // -- TTS playback --------------------------------------------------------
  const speak = useCallback(
    (text: string, onEndPhase: Phase) => {
      const trimmed = text.trim();
      const audio = audioRef.current;
      // Nothing to read (e.g. occlusion recto) → skip straight to the next
      // phase so the loop never stalls on a silent card.
      if (trimmed.length === 0 || !audio) {
        setPhase(onEndPhase);
        return;
      }
      const play = (path: string) => {
        audio.src = convertFileSrc(path);
        audio.currentTime = 0;
        // When narration ends, advance the machine. We attach a one-shot
        // handler via the element's `onended` prop below; here we just play.
        void audio.play().catch(() => {
          // Autoplay/codec failure → don't strand the learner; advance.
          setIsSpeaking(false);
          setPhase(onEndPhase);
        });
      };
      synthesize.mutate(
        { text: trimmed, voice: voice ?? "nova" },
        {
          onSuccess: (result) => play(result.path),
          onError: (err) => {
            const message = err.message ?? "Erreur inconnue";
            const isMissingKey = /api key/i.test(message);
            toast({
              title: isMissingKey ? "Clé API manquante" : "Synthèse vocale impossible",
              description: isMissingKey
                ? "Configure une voix (Settings → API / Piper) pour le mode mains-libres."
                : message,
              variant: "destructive",
            });
            // Fall back to a silent step so manual buttons still drive the loop.
            setPhase(onEndPhase);
          },
        },
      );
    },
    [synthesize, voice],
  );

  // Drive auto-TTS on entering a speaking phase. We key on `phase` + `index`
  // so each card reads its question then (after reveal) its answer exactly
  // once. The `<audio onEnded>` handler performs the phase hand-off.
  // biome-ignore lint/correctness/useExhaustiveDependencies: speak is stable per card; re-running on its identity would double-fire TTS.
  useEffect(() => {
    if (!current) return;
    if (phase === "question") {
      cardShownAtRef.current = Date.now();
      speak(getSpokenFront(current.note, current.card.card_ord), "waiting");
    } else if (phase === "answer") {
      speak(getSpokenBack(current.note, current.card.card_ord), "rating");
    }
    // waiting + rating are silent (await user action).
  }, [phase, index, current]);

  const handleReveal = useCallback(() => {
    if (phase !== "waiting") return;
    stopAudio();
    setPhase("answer");
  }, [phase, stopAudio]);

  const handleRate = useCallback(
    (rating: Rating) => {
      if (!current || phase !== "rating") return;
      stopAudio();
      cleanupMic();
      const reviewTimeMs = Math.max(0, Date.now() - cardShownAtRef.current);
      onSubmit(current.card.id, rating, reviewTimeMs);
      const next = index + 1;
      if (next >= cards.length) {
        onDone();
      } else {
        setIndex(next);
        setPhase("question");
      }
    },
    [cards.length, cleanupMic, current, index, onDone, onSubmit, phase, stopAudio],
  );

  // -- voice grading -------------------------------------------------------
  const startRecording = useCallback(async () => {
    if (phase !== "rating" || isRecording || isTranscribing) return;
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
      toast({ title: "Accès micro refusé", description: message, variant: "destructive" });
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
      cleanupMic();
      const message = err instanceof Error ? err.message : String(err);
      toast({ title: "Enregistreur indisponible", description: message, variant: "destructive" });
      return;
    }
    chunksRef.current = [];
    recorder.ondataavailable = (event) => {
      if (event.data.size > 0) chunksRef.current.push(event.data);
    };
    recorder.onstop = async () => {
      // Detach the live stream immediately; keep the chunks for transcription.
      if (streamRef.current) {
        for (const track of streamRef.current.getTracks()) track.stop();
        streamRef.current = null;
      }
      setIsRecording(false);
      const chunks = chunksRef.current;
      chunksRef.current = [];
      if (chunks.length === 0) return;
      const blob = new Blob(chunks, { type: recorder.mimeType || RECORDING_MIME });
      setIsTranscribing(true);
      try {
        const audioBase64 = await blobToBase64(blob);
        transcribe.mutate(
          { audioBase64, mimeType: recorder.mimeType || RECORDING_MIME, language },
          {
            onSuccess: (text) => {
              setIsTranscribing(false);
              const rating = transcriptToRating(text);
              if (rating === null) {
                toast({
                  title: "Note non reconnue",
                  description: `« ${text} » — dis "encore", "difficile", "bien" ou "facile".`,
                });
                return;
              }
              handleRate(rating);
            },
            onError: (err) => {
              setIsTranscribing(false);
              const message = err.message ?? "Erreur inconnue";
              const isMissingKey = /api key/i.test(message);
              toast({
                title: isMissingKey ? "Clé API manquante" : "Transcription impossible",
                description: isMissingKey ? "Configure ta clé OpenAI dans Settings." : message,
                variant: "destructive",
              });
            },
          },
        );
      } catch (err) {
        setIsTranscribing(false);
        const message = err instanceof Error ? err.message : String(err);
        toast({ title: "Conversion impossible", description: message, variant: "destructive" });
      }
    };
    recorderRef.current = recorder;
    try {
      recorder.start();
    } catch (err) {
      cleanupMic();
      const message = err instanceof Error ? err.message : String(err);
      toast({ title: "Enregistrement impossible", description: message, variant: "destructive" });
      return;
    }
    setIsRecording(true);
    stopTimerRef.current = window.setTimeout(() => {
      const r = recorderRef.current;
      if (r && r.state !== "inactive") {
        try {
          r.stop();
        } catch {
          // ignore double-stop
        }
      }
    }, MAX_RECORDING_MS);
  }, [cleanupMic, handleRate, isRecording, isTranscribing, language, phase, transcribe]);

  const stopRecording = useCallback(() => {
    if (stopTimerRef.current !== null) {
      window.clearTimeout(stopTimerRef.current);
      stopTimerRef.current = null;
    }
    const recorder = recorderRef.current;
    if (recorder && recorder.state !== "inactive") {
      try {
        recorder.stop();
      } catch {
        // ignore
      }
    }
  }, []);

  if (!current) {
    // Defensive: parent should call onDone before this, but never render blank.
    return null;
  }

  const phaseLabel =
    phase === "question"
      ? "Écoute la question"
      : phase === "waiting"
        ? "Réponds à voix haute…"
        : phase === "answer"
          ? "Écoute la réponse"
          : "Note ta réponse";

  return (
    <div
      className="flex h-full min-h-0 flex-col items-center justify-center gap-8 px-4 py-8 text-center"
      data-testid="hands-free-review"
    >
      <div className="flex items-center gap-2 text-sm text-muted-foreground">
        <Headphones className="h-4 w-4" aria-hidden />
        Mode mains-libres — carte {index + 1} / {cards.length}
      </div>

      {/* Phase banner — very large so it reads from across the room. */}
      <div className="flex flex-col items-center gap-3">
        <div
          className={cn(
            "flex h-16 w-16 items-center justify-center rounded-full",
            isSpeaking
              ? "animate-pulse bg-primary/20 text-primary"
              : "bg-muted text-muted-foreground",
          )}
        >
          {isSpeaking ? (
            <Volume2 className="h-8 w-8" aria-hidden />
          ) : (
            <Headphones className="h-8 w-8" aria-hidden />
          )}
        </div>
        <p className="text-2xl font-semibold tracking-tight" aria-live="polite">
          {phaseLabel}
        </p>
      </div>

      {/* Reveal control during the silent thinking gap. */}
      {phase === "waiting" && (
        <Button size="lg" className="h-14 px-10 text-lg" onClick={handleReveal}>
          Révéler la réponse
        </Button>
      )}

      {/* Grading: four large touch buttons + voice grading. */}
      {phase === "rating" && (
        <div className="flex w-full max-w-2xl flex-col items-center gap-5">
          <div className="grid w-full grid-cols-2 gap-3 sm:grid-cols-4">
            {RATING_BUTTONS.map((b) => (
              <Button
                key={b.rating}
                type="button"
                onClick={() => handleRate(b.rating)}
                disabled={isTranscribing}
                className={cn("h-20 text-lg font-semibold", b.className)}
              >
                {b.label}
              </Button>
            ))}
          </div>
          <Button
            type="button"
            variant={isRecording ? "destructive" : "outline"}
            size="lg"
            className="h-14 px-8 text-base"
            disabled={isTranscribing}
            aria-pressed={isRecording}
            onClick={() => (isRecording ? stopRecording() : void startRecording())}
          >
            {isTranscribing ? (
              <Loader2 className="mr-2 h-5 w-5 animate-spin" aria-hidden />
            ) : isRecording ? (
              <Square className="mr-2 h-5 w-5" aria-hidden />
            ) : (
              <Mic className="mr-2 h-5 w-5" aria-hidden />
            )}
            {isTranscribing ? "Transcription…" : isRecording ? "Arrêter" : "Noter à la voix"}
          </Button>
          <p className="text-xs text-muted-foreground">
            Dis « encore », « difficile », « bien » ou « facile ».
          </p>
        </div>
      )}

      <Button variant="ghost" size="sm" className="mt-2" onClick={onExit}>
        <Keyboard className="mr-1 h-4 w-4" aria-hidden />
        Mode classique
      </Button>

      {/** biome-ignore lint/a11y/useMediaCaption: TTS playback of card text — no captions available. */}
      <audio
        ref={audioRef}
        preload="none"
        className="hidden"
        onPlay={() => setIsSpeaking(true)}
        onPause={() => setIsSpeaking(false)}
        onError={() => setIsSpeaking(false)}
        onEnded={() => {
          setIsSpeaking(false);
          // Hand off to the next phase once narration finishes.
          setPhase((p) => (p === "question" ? "waiting" : p === "answer" ? "rating" : p));
        }}
      />
    </div>
  );
}
