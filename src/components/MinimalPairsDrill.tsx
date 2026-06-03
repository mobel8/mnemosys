/**
 * Minimal-pairs pronunciation drill (sous-feature 3).
 *
 * Full page. The learner picks a phonemic contrast (e.g. /iː/ vs /ɪ/), then
 * runs a « listen & identify » loop:
 *   1. We pick a random pair from the contrast and a random side (a or b).
 *   2. The chosen word is spoken aloud — via the existing OpenAI/Piper TTS
 *      command (`useSynthesizeAudio`), with a Web SpeechSynthesis fallback
 *      when synthesis is unavailable (no API key / offline / error).
 *   3. The learner clicks the word they think they heard.
 *   4. Immediate feedback (success / destructive tint + the revealed IPA), a
 *      running score, then a new round.
 *
 * IMPORTANT: every random draw happens at runtime inside an event handler
 * (`startRound` is only ever called from clicks / mount effect callbacks),
 * never at module scope.
 */

import { convertFileSrc } from "@tauri-apps/api/core";
import { AnimatePresence, motion } from "framer-motion";
import { Check, Headphones, RotateCcw, Volume2, X } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { toast } from "@/components/ui/use-toast";
import { CONTRASTS, type Contrast, type MinimalPair } from "@/lib/minimal-pairs";
import { useSettingsQuery, useSynthesizeAudio } from "@/lib/queries";
import type { TTSVoice } from "@/lib/tauri";
import { cn } from "@/lib/utils";

const DEFAULT_VOICE: TTSVoice = "nova";
const DEFAULT_SPEED = 1.0;
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

/** Which side of the pair is the answer this round. */
type Side = "a" | "b";

/** State of the current round once the learner has answered. */
interface RoundResult {
  /** The side the learner clicked. */
  picked: Side;
  /** Whether that matched the spoken word. */
  correct: boolean;
}

interface Round {
  pair: MinimalPair;
  /** The side that was actually spoken (the correct answer). */
  target: Side;
}

/**
 * Speak `word` through the Web SpeechSynthesis API as a graceful fallback
 * when the Tauri TTS command is unavailable. Resolves silently when the API
 * is missing so the caller can keep the drill running.
 */
function speakWithWebApi(word: string): void {
  if (typeof window === "undefined" || !("speechSynthesis" in window)) return;
  try {
    const utterance = new SpeechSynthesisUtterance(word);
    utterance.lang = "en-US";
    utterance.rate = 0.9;
    window.speechSynthesis.cancel();
    window.speechSynthesis.speak(utterance);
  } catch {
    /* SpeechSynthesis can throw on some locked-down webviews — ignore. */
  }
}

export default function MinimalPairsDrill() {
  const firstContrast = CONTRASTS[0];
  const [contrastId, setContrastId] = useState<string>(firstContrast?.id ?? "");
  const [round, setRound] = useState<Round | null>(null);
  const [result, setResult] = useState<RoundResult | null>(null);
  const [score, setScore] = useState(0);
  const [attempts, setAttempts] = useState(0);
  /** Whether we've fallen back to the Web Speech API for this session. */
  const [usingFallback, setUsingFallback] = useState(false);

  /** `true` once the learner has triggered playback for the current round. */
  const [hasPlayed, setHasPlayed] = useState(false);

  const settingsQuery = useSettingsQuery();
  const synthesize = useSynthesizeAudio();
  const audioRef = useRef<HTMLAudioElement | null>(null);
  /** The text spoken in the active round, replayed by « réécouter ». */
  const spokenWordRef = useRef<string | null>(null);
  /**
   * Monotonic generation counter, bumped whenever a new round is prepared or
   * the contrast changes. Each `speak()` captures the value on entry and drops
   * its audio if the counter has since moved on, so a slow synthesis from an
   * abandoned round can never play over the current one (stale-resolution
   * guard).
   */
  const generationRef = useRef(0);

  const voice = resolveVoice(settingsQuery.data?.tts_voice);
  const speed = settingsQuery.data?.tts_speed ?? DEFAULT_SPEED;

  const contrast: Contrast | undefined = CONTRASTS.find((c) => c.id === contrastId);

  /** Speak one word: try the Tauri command, fall back to Web Speech on error. */
  const speak = useCallback(
    async (word: string) => {
      spokenWordRef.current = word;
      // Capture the generation on entry; if a new round/contrast supersedes
      // this one while synthesis is in flight, we must not play stale audio.
      const gen = generationRef.current;
      if (usingFallback) {
        speakWithWebApi(word);
        return;
      }
      try {
        const res = await synthesize.mutateAsync({ text: word, voice, speed });
        if (gen !== generationRef.current) return; // round changed — drop it.
        const audio = audioRef.current;
        if (audio) {
          audio.src = convertFileSrc(res.path);
          audio.currentTime = 0;
          await audio.play().catch(() => {});
        }
      } catch (err) {
        // First failure: switch to the offline Web Speech fallback and inform
        // the learner once, then keep the drill usable.
        setUsingFallback(true);
        const message = err instanceof Error ? err.message : String(err);
        const isMissingKey = /api key/i.test(message);
        toast({
          title: "Voix locale utilisée",
          description: isMissingKey
            ? "Clé OpenAI absente — on bascule sur la synthèse vocale du système."
            : "Synthèse en ligne indisponible — on bascule sur la voix du système.",
        });
        if (gen === generationRef.current) speakWithWebApi(word);
      }
    },
    [synthesize, voice, speed, usingFallback],
  );

  /**
   * Draw a fresh pair + side for a new round. Randomness lives here; the word
   * is NOT spoken automatically — the learner triggers playback explicitly
   * (« Écouter le mot »), so the page never autoplays on mount or on contrast
   * change. Bumps the generation counter so any pending synthesis is discarded.
   */
  const startRound = useCallback((target: Contrast) => {
    const pairs = target.pairs;
    if (pairs.length === 0) return;
    const pairIndex = Math.floor(Math.random() * pairs.length);
    const pair = pairs[pairIndex];
    if (!pair) return;
    const side: Side = Math.random() < 0.5 ? "a" : "b";
    generationRef.current += 1;
    setResult(null);
    setHasPlayed(false);
    setRound({ pair, target: side });
    spokenWordRef.current = side === "a" ? pair.a : pair.b;
  }, []);

  // Reset the session and prepare a (silent) first round whenever the contrast
  // changes. The draw happens inside startRound (not at render) and nothing is
  // spoken until the learner clicks « Écouter ». The score resets here so a new
  // contrast always starts at 0/0.
  // biome-ignore lint/correctness/useExhaustiveDependencies: re-run on contrast id only; startRound/contrast are derived from it.
  useEffect(() => {
    generationRef.current += 1;
    setScore(0);
    setAttempts(0);
    setResult(null);
    setRound(null);
    setHasPlayed(false);
    spokenWordRef.current = null;
    if (contrast) startRound(contrast);
  }, [contrastId]);

  // Stop any in-flight Web Speech utterance on unmount.
  useEffect(() => {
    return () => {
      if (typeof window !== "undefined" && "speechSynthesis" in window) {
        window.speechSynthesis.cancel();
      }
    };
  }, []);

  /** Play (or replay) the target word for the current round. */
  function handlePlay() {
    const word = spokenWordRef.current;
    if (!word) return;
    setHasPlayed(true);
    void speak(word);
  }

  function handleAnswer(picked: Side) {
    if (!round || result) return; // ignore clicks once answered
    const correct = picked === round.target;
    setResult({ picked, correct });
    setAttempts((n) => n + 1);
    if (correct) setScore((n) => n + 1);
  }

  function handleNext() {
    if (contrast) startRound(contrast);
  }

  const accuracy = attempts > 0 ? Math.round((score / attempts) * 100) : 0;
  const isSpeaking = synthesize.isPending;

  /** Tailwind tint for a word button given the current result. */
  function wordButtonClass(side: Side): string {
    if (!result || !round) {
      return "border-input bg-card hover:border-accent hover:bg-accent hover:text-accent-foreground";
    }
    const isTarget = round.target === side;
    const isPicked = result.picked === side;
    if (isTarget) {
      return "border-success/50 bg-success/10 text-success";
    }
    if (isPicked && !result.correct) {
      return "border-destructive/50 bg-destructive/10 text-destructive";
    }
    return "border-input bg-card opacity-60";
  }

  return (
    <div className="mx-auto max-w-3xl space-y-6 p-6" data-testid="minimal-pairs-drill">
      <header>
        <h2 className="flex items-center gap-2 font-display text-2xl font-semibold tracking-tight">
          <Headphones className="h-6 w-6" /> Prononciation
        </h2>
        <p className="mt-1 text-sm text-muted-foreground">
          Entraîne ton oreille sur les paires minimales anglaises. Choisis un contraste, écoute le
          mot prononcé, puis clique sur celui que tu penses avoir entendu.
        </p>
      </header>

      <Card>
        <CardHeader>
          <CardTitle className="text-lg">Contraste phonémique</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2">
          <Select value={contrastId} onValueChange={setContrastId}>
            <SelectTrigger className="w-full" data-testid="contrast-select" aria-label="Contraste">
              <SelectValue placeholder="Choisis un contraste" />
            </SelectTrigger>
            <SelectContent>
              {CONTRASTS.map((c) => (
                <SelectItem key={c.id} value={c.id}>
                  {c.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          {contrast && (
            <p className="text-xs text-muted-foreground">
              {contrast.pairs.length} paires dans ce contraste.
            </p>
          )}
        </CardContent>
      </Card>

      {round ? (
        <Card>
          <CardHeader className="flex-row items-center justify-between space-y-0">
            <CardTitle className="text-lg">Écoute et identifie</CardTitle>
            {/* Score announced politely so SR users hear it move after each try. */}
            <div className="flex items-center gap-4 text-sm" aria-live="polite">
              <span className="text-muted-foreground">
                Score{" "}
                <span className="font-mono tabular-nums text-foreground" data-testid="score">
                  {score}/{attempts}
                </span>
              </span>
              <span className="text-muted-foreground">
                Précision{" "}
                <span className="font-mono tabular-nums text-foreground" data-testid="accuracy">
                  {accuracy}%
                </span>
              </span>
            </div>
          </CardHeader>
          <CardContent className="space-y-6">
            <div className="flex justify-center">
              <Button
                type="button"
                size="lg"
                variant="outline"
                onClick={handlePlay}
                disabled={isSpeaking}
                data-testid="replay-button"
              >
                <Volume2 className={cn("h-4 w-4", isSpeaking && "animate-pulse")} aria-hidden />
                {hasPlayed ? "Réécouter" : "Écouter le mot"}
              </Button>
            </div>

            <div className="grid grid-cols-2 gap-4">
              {(["a", "b"] as const).map((side) => {
                const word = side === "a" ? round.pair.a : round.pair.b;
                const ipa = side === "a" ? round.pair.ipaA : round.pair.ipaB;
                const revealed = result !== null;
                const isTarget = round.target === side;
                const isPicked = result?.picked === side;
                // Once revealed, convey correct/incorrect with an icon + label
                // — not colour alone (P026). The target word is "correct"; the
                // word the learner wrongly picked is "incorrect".
                const showCorrect = revealed && isTarget;
                const showIncorrect = revealed && isPicked && !result.correct;
                const ariaLabel = !revealed
                  ? word
                  : showCorrect
                    ? `${word} — bonne réponse`
                    : showIncorrect
                      ? `${word} — réponse incorrecte`
                      : word;
                return (
                  <button
                    key={side}
                    type="button"
                    onClick={() => handleAnswer(side)}
                    disabled={revealed}
                    data-testid={`word-${side}`}
                    aria-label={ariaLabel}
                    aria-pressed={isPicked}
                    className={cn(
                      "flex flex-col items-center gap-1 rounded-xl border px-4 py-6 text-center shadow-xs transition-all duration-150",
                      "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background",
                      !revealed && "active:translate-y-px",
                      revealed && "cursor-default",
                      wordButtonClass(side),
                    )}
                  >
                    <span className="flex items-center gap-1.5 font-display text-2xl font-semibold tracking-tight">
                      {showCorrect && <Check className="h-5 w-5 shrink-0" aria-hidden />}
                      {showIncorrect && <X className="h-5 w-5 shrink-0" aria-hidden />}
                      {word}
                    </span>
                    <AnimatePresence>
                      {revealed && (
                        <motion.span
                          initial={{ opacity: 0, y: -4 }}
                          animate={{ opacity: 1, y: 0 }}
                          transition={{ duration: 0.2, ease: [0.16, 1, 0.3, 1] }}
                          className="font-mono text-sm tabular-nums"
                        >
                          /{ipa}/
                        </motion.span>
                      )}
                    </AnimatePresence>
                  </button>
                );
              })}
            </div>

            {/*
              Feedback live region: stable wrapper with role=status +
              aria-live=assertive so the « Correct » / « Raté » verdict is
              announced immediately to screen readers, not just shown by colour.
            */}
            <div
              className="flex min-h-9 items-center justify-center"
              role="status"
              aria-live="assertive"
            >
              <AnimatePresence mode="wait">
                {result ? (
                  <motion.div
                    key={result.correct ? "ok" : "ko"}
                    initial={{ opacity: 0, scale: 0.96 }}
                    animate={{ opacity: 1, scale: 1 }}
                    exit={{ opacity: 0, scale: 0.96 }}
                    transition={{ duration: 0.15, ease: [0.16, 1, 0.3, 1] }}
                    className={cn(
                      "flex items-center gap-2 text-sm font-medium",
                      result.correct ? "text-success" : "text-destructive",
                    )}
                  >
                    {result.correct ? (
                      <>
                        <Check className="h-4 w-4" aria-hidden /> Correct
                      </>
                    ) : (
                      <>
                        <X className="h-4 w-4" aria-hidden /> Raté — c'était «{" "}
                        {round.target === "a" ? round.pair.a : round.pair.b} »
                      </>
                    )}
                  </motion.div>
                ) : (
                  <p className="text-sm text-muted-foreground">Quel mot as-tu entendu ?</p>
                )}
              </AnimatePresence>
            </div>

            {result && (
              <div className="flex justify-center">
                <Button type="button" onClick={handleNext} data-testid="next-button">
                  <RotateCcw className="h-4 w-4" aria-hidden />
                  Mot suivant
                </Button>
              </div>
            )}
          </CardContent>
        </Card>
      ) : (
        <Card className="border-dashed">
          <CardContent className="flex flex-col items-center gap-3 py-12 text-center">
            <div className="flex h-12 w-12 items-center justify-center rounded-full bg-brand-100 text-brand-600 dark:bg-brand-900/40 dark:text-brand-300">
              <Headphones className="h-6 w-6" aria-hidden />
            </div>
            <p className="font-display text-lg font-semibold tracking-tight">
              Choisis un contraste pour commencer
            </p>
            <p className="max-w-sm text-sm text-muted-foreground">
              Chaque tour, un mot d'une paire minimale est prononcé. À toi de repérer lequel.
            </p>
          </CardContent>
        </Card>
      )}

      {/* biome-ignore lint/a11y/useMediaCaption: TTS playback of single words — no captions available. */}
      <audio ref={audioRef} preload="none" className="hidden" />
    </div>
  );
}
