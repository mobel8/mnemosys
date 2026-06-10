/**
 * State machine + layout for an in-progress review session.
 *
 * Phases:
 *   - `question`   : current card's recto is showing, awaiting a flip.
 *   - `answer`     : verso revealed, awaiting a rating.
 *   - `submitting` : `submit_review` mutation in flight; controls disabled.
 *   - `done`       : queue exhausted; `<ReviewSummary />` takes over.
 *
 * v0.11 rewrite — the audit found the core loop buried under 11 optional
 * interruptions (mood check-in, breathing primer, LLM pre-questions, pretest,
 * self-explanation, double confidence strips, movement breaks, delayed JOL…).
 * The loop is now: flip → rate, with AT MOST one optional add-on per phase:
 *   - question phase: type-the-answer (optional) + confidence 1-5 (optional,
 *     captured BEFORE the flip as CBM requires) + sketch (Labs).
 *   - answer phase: the four FSRS buttons. Nothing else.
 *
 * New in v0.11 — intra-session relearning: a card rated « Encore » re-enters
 * the live queue a few positions later (max twice per card per session), so a
 * failed card is re-tested while it's still cheap to fix instead of vanishing
 * until tomorrow. Each pass persists its own review — same trace Anki leaves
 * with learning steps.
 *
 * Keyboard bindings:
 *   - Space      : flip (question phase only)
 *   - 1, 2, 3, 4 : rating (answer phase only)
 *   - s          : suspend current card and skip
 *   - Esc        : quit — same confirmation path as the « Quitter » button
 *   - ?          : show shortcut help
 */

import { useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { Headphones } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useHotkeys } from "react-hotkeys-hook";
import { AmbientPlayer } from "@/components/AmbientPlayer";
import { HandsFreeReview } from "@/components/HandsFreeReview";
import { ReviewCard } from "@/components/ReviewCard";
import { ReviewControls } from "@/components/ReviewControls";
import { ReviewProgress } from "@/components/ReviewProgress";
import { type ReviewedLog, ReviewSummary } from "@/components/ReviewSummary";
import { SketchCanvas } from "@/components/SketchCanvas";
import type { TypeAnswerVerdict } from "@/components/TypeAnswer";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { useToast } from "@/components/ui/use-toast";
import {
  invalidateAfterSession,
  useSaveSketch,
  useSettingsQuery,
  useSubmitReview,
  useSuspendCard,
} from "@/lib/queries";
import { useReviewSession } from "@/lib/stores/review";
import { api, type CardWithNote, type Rating, type TTSVoice } from "@/lib/tauri";

type Phase = "question" | "answer" | "submitting" | "done";

/** A failed card re-enters the queue this many positions ahead (clamped). */
const RELEARN_GAP = 6;
/** Max number of same-session re-tests per card — avoids infinite loops. */
const MAX_RELEARN_PASSES = 2;

interface ReviewSessionProps {
  deckId: number;
  cards: CardWithNote[];
  /** P112 — libellé affiché dans la barre de progression (ex. « Session globale »). */
  sessionLabel?: string;
  /** ISO 639-1 hint for voice transcription / TTS (deck.language_mode). */
  languageHint?: string;
}

export function ReviewSession({
  deckId,
  cards: initial,
  sessionLabel,
  languageHint,
}: ReviewSessionProps) {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const submitReview = useSubmitReview();
  const suspendCard = useSuspendCard();
  const saveSketch = useSaveSketch();
  const settings = useSettingsQuery();
  const { toast } = useToast();

  // Snapshot the queue once; the parent route only renders us when due
  // cards arrive, so `initial` is stable per-mount. The queue then lives —
  // relearn passes splice copies back in (see `handleRate`).
  const [cards, setCards] = useState<CardWithNote[]>(initial);
  const [currentIndex, setCurrentIndex] = useState(0);
  const [phase, setPhase] = useState<Phase>(cards.length === 0 ? "done" : "question");
  const [reviewed, setReviewed] = useState<ReviewedLog[]>([]);
  // P103 — cards that are *still* due once this session's queue is exhausted.
  const [remainingDue, setRemainingDue] = useState<CardWithNote[]>([]);
  const [pendingRating, setPendingRating] = useState<Rating | null>(null);
  const [helpOpen, setHelpOpen] = useState(false);
  const [confirmQuitOpen, setConfirmQuitOpen] = useState(false);
  // Per-card confidence buffer (CBM — captured BEFORE the flip). Reset on
  // every card transition.
  const [confidence, setConfidence] = useState<number | null>(null);
  // Latest sketch PNG data-URL for the current card (ref so each stroke
  // doesn't re-render the session). Reset on every card transition.
  const sketchDataRef = useRef<string | null>(null);
  // Most recent type/voice answer outcome for the current card.
  const [typedAnswer, setTypedAnswer] = useState<{
    score: number;
    verdict: TypeAnswerVerdict;
  } | null>(null);
  // Per-card relearn tally (intra-session re-tests after an « Encore »).
  const relearnCountsRef = useRef<Map<number, number>>(new Map());

  const typeTheAnswerEnabled = settings.data?.type_the_answer_enabled ?? false;
  const voiceAnswerEnabled = settings.data?.voice_answer_enabled ?? false;
  const confidenceEnabled = settings.data?.confidence_rating_enabled ?? false;
  const sketchBeforeFlipEnabled = settings.data?.sketch_before_flip_enabled ?? false;
  const ambientSound = settings.data?.ambient_sound ?? "none";
  const handsFreeEnabled = settings.data?.hands_free_enabled ?? false;
  const [handsFreeActive, setHandsFreeActive] = useState(false);
  // Number of cards graded inside the *current* hands-free run (see
  // `handleHandsFreeExit`).
  const handsFreeGradedRef = useRef(0);
  const ttsVoice = useMemo(
    () => narrowTtsVoice(settings.data?.tts_voice),
    [settings.data?.tts_voice],
  );

  const startedAtRef = useRef<number>(Date.now());
  const cardShownAtRef = useRef<number>(Date.now());
  // P096 — synchronous double-submit guard (see original note): a ref flips
  // synchronously, blocking a same-frame duplicate before React re-renders.
  const submittingRef = useRef(false);

  const startSessionInStore = useReviewSession((s) => s.startSession);
  const resetStore = useReviewSession((s) => s.reset);

  // Flag the active session in the shared store on mount; clear on unmount.
  // Also run the end-of-session invalidation sweep exactly once per mount —
  // per-grade invalidations are on a diet (see useSubmitReview), the heavy
  // families refresh here.
  // biome-ignore lint/correctness/useExhaustiveDependencies: intentional mount-only effect
  useEffect(() => {
    startSessionInStore(deckId, initial);
    return () => {
      resetStore();
      invalidateAfterSession(queryClient);
    };
  }, []);

  const current = cards[currentIndex];

  // P103 — once the queue is exhausted, fetch the cards that are *still* due
  // so the summary can offer a working « Continuer » CTA. Honour the daily
  // new-card quota (the audit caught the old path bypassing it).
  useEffect(() => {
    if (phase !== "done" || deckId < 0) return;
    let cancelled = false;
    const newLimit = settings.data?.daily_new_limit;
    api.review
      .dueCards(deckId, 100, newLimit)
      .then((due) => {
        if (!cancelled) setRemainingDue(due);
      })
      .catch(() => {
        if (!cancelled) setRemainingDue([]);
      });
    return () => {
      cancelled = true;
    };
  }, [phase, deckId, settings.data?.daily_new_limit]);

  // P103 — re-seed the session with the freshly-due cards without leaving the
  // route.
  const handleContinue = useCallback(() => {
    if (remainingDue.length === 0) return;
    const next = remainingDue;
    setRemainingDue([]);
    setCards(next);
    setCurrentIndex(0);
    setReviewed([]);
    setPendingRating(null);
    setConfidence(null);
    sketchDataRef.current = null;
    setTypedAnswer(null);
    relearnCountsRef.current = new Map();
    submittingRef.current = false;
    startedAtRef.current = Date.now();
    cardShownAtRef.current = Date.now();
    setPhase("question");
  }, [remainingDue]);

  const resetPerCardBuffers = useCallback(() => {
    setConfidence(null);
    sketchDataRef.current = null;
    setTypedAnswer(null);
  }, []);

  const handleFlip = useCallback(() => {
    if (phase !== "question" || !current) return;
    setPhase("answer");
  }, [phase, current]);

  const handleRate = useCallback(
    (rating: Rating) => {
      if (phase !== "answer" || !current) return;
      // P096 — synchronous re-entrancy guard.
      if (submittingRef.current) return;
      submittingRef.current = true;
      const reviewTimeMs = Math.max(0, Date.now() - cardShownAtRef.current);
      setPhase("submitting");
      setPendingRating(rating);
      const confidenceForSubmit = confidenceEnabled && confidence !== null ? confidence : null;
      // Snapshot sketch + card id *before* the async hop (P097 race).
      const cardId = current.card.id;
      const cardSnapshot = current;
      const sketchData = sketchBeforeFlipEnabled ? sketchDataRef.current : null;
      submitReview.mutate(
        {
          cardId,
          rating,
          reviewTimeMs,
          confidence: confidenceForSubmit,
        },
        {
          onSuccess: (result) => {
            submittingRef.current = false;
            setReviewed((log) => [
              ...log,
              { rating, review_time_ms: reviewTimeMs, correct: rating >= 3 },
            ]);
            if (sketchData) {
              saveSketch.mutate(
                { reviewId: result.review_id, cardId, sketchData },
                {
                  onError: (err) => {
                    toast({
                      title: "Croquis non enregistré",
                      description: err.message,
                      variant: "destructive",
                    });
                  },
                },
              );
            }
            setPendingRating(null);

            // Intra-session relearning: an « Encore » re-queues the card a few
            // positions ahead so it's re-tested this session (max twice).
            let nextCards = cards;
            if (rating === 1) {
              const passes = relearnCountsRef.current.get(cardId) ?? 0;
              if (passes < MAX_RELEARN_PASSES) {
                relearnCountsRef.current.set(cardId, passes + 1);
                const insertAt = Math.min(currentIndex + 1 + RELEARN_GAP, cards.length);
                nextCards = [...cards.slice(0, insertAt), cardSnapshot, ...cards.slice(insertAt)];
                setCards(nextCards);
              }
            }

            const nextIndex = currentIndex + 1;
            if (nextIndex >= nextCards.length) {
              setPhase("done");
            } else {
              setPhase("question");
              cardShownAtRef.current = Date.now();
            }
            setCurrentIndex(nextIndex);
            resetPerCardBuffers();
          },
          onError: (err) => {
            submittingRef.current = false;
            setPendingRating(null);
            setPhase("answer");
            toast({
              title: "Échec de l'enregistrement",
              description: err.message,
              variant: "destructive",
            });
          },
        },
      );
    },
    [
      cards,
      confidence,
      confidenceEnabled,
      current,
      currentIndex,
      phase,
      resetPerCardBuffers,
      saveSketch,
      sketchBeforeFlipEnabled,
      submitReview,
      toast,
    ],
  );

  // Record a type/voice answer outcome. Advisory only — FSRS stays under the
  // learner's control.
  const handleTypedAnswer = useCallback(
    (_typed: string, score: number, verdict: TypeAnswerVerdict) => {
      setTypedAnswer({ score, verdict });
    },
    [],
  );

  // Hands-free grade handler (HandsFreeReview owns its own cursor).
  const handleHandsFreeSubmit = useCallback(
    (cardId: number, rating: Rating, reviewTimeMs: number) => {
      if (submittingRef.current) return;
      submittingRef.current = true;
      submitReview.mutate(
        { cardId, rating, reviewTimeMs, confidence: null },
        {
          onSuccess: () => {
            submittingRef.current = false;
            setReviewed((log) => [
              ...log,
              { rating, review_time_ms: reviewTimeMs, correct: rating >= 3 },
            ]);
            handsFreeGradedRef.current += 1;
          },
          onError: (err) => {
            submittingRef.current = false;
            toast({
              title: "Échec de l'enregistrement",
              description: err.message,
              variant: "destructive",
            });
          },
        },
      );
    },
    [submitReview, toast],
  );

  // Leave hands-free and resume the classic flip/rate UI.
  const handleHandsFreeExit = useCallback(() => {
    const graded = handsFreeGradedRef.current;
    handsFreeGradedRef.current = 0;
    setHandsFreeActive(false);
    if (graded <= 0) return;
    resetPerCardBuffers();
    setCurrentIndex((i) => {
      const next = i + graded;
      if (next >= cards.length) {
        setPhase("done");
      } else {
        setPhase("question");
        cardShownAtRef.current = Date.now();
      }
      return next;
    });
  }, [cards.length, resetPerCardBuffers]);

  const doQuit = useCallback(() => {
    // `deckId < 0` is the all-decks sentinel (global « Réviser » session) —
    // its natural exit is the home dashboard.
    if (deckId < 0) {
      navigate({ to: "/" });
      return;
    }
    navigate({ to: "/decks/$deckId", params: { deckId } });
  }, [deckId, navigate]);

  // Single quit path for BOTH the « Quitter » button and the Esc hotkey — the
  // audit caught Esc bypassing the confirmation.
  const requestQuit = useCallback(() => {
    if (reviewed.length > 5 && phase !== "done") {
      setConfirmQuitOpen(true);
    } else {
      doQuit();
    }
  }, [doQuit, phase, reviewed.length]);

  const handleSuspend = useCallback(() => {
    if (!current || phase === "submitting" || phase === "done") return;
    const cardId = current.card.id;
    const removed = current;
    const indexAtSuspend = currentIndex;
    // P097 — suspend is a card transition: reset buffers + re-arm immediately.
    resetPerCardBuffers();
    const lengthAfter = cards.length - 1;
    setCards((prev) => prev.filter((_c, idx) => idx !== indexAtSuspend));
    if (indexAtSuspend >= lengthAfter) {
      setPhase("done");
    } else {
      setPhase("question");
      cardShownAtRef.current = Date.now();
    }
    suspendCard.mutate(
      { id: cardId, suspended: true },
      {
        onSuccess: () => {
          toast({ title: "Carte suspendue" });
        },
        onError: (err) => {
          setCards((prev) => {
            const next = prev.slice();
            next.splice(indexAtSuspend, 0, removed);
            return next;
          });
          setPhase("question");
          cardShownAtRef.current = Date.now();
          toast({
            title: "Suspension impossible",
            description: err.message,
            variant: "destructive",
          });
        },
      },
    );
  }, [cards.length, current, currentIndex, phase, resetPerCardBuffers, suspendCard, toast]);

  // NOTE: there is intentionally no "edit current card" hotkey — the only
  // editor route creates a blank note (see the audit note in v0.10).

  // ---- Hotkeys -----------------------------------------------------------
  // Gated on `!anyModalOpen` so a modal interaction can't silently grade the
  // card behind it.
  const anyModalOpen = helpOpen || confirmQuitOpen;
  useHotkeys(
    "space",
    (e) => {
      e.preventDefault();
      handleFlip();
    },
    { enabled: phase === "question" && !anyModalOpen },
  );
  useHotkeys(
    "1",
    (e) => {
      e.preventDefault();
      handleRate(1);
    },
    { enabled: phase === "answer" && !anyModalOpen },
  );
  useHotkeys(
    "2",
    (e) => {
      e.preventDefault();
      handleRate(2);
    },
    { enabled: phase === "answer" && !anyModalOpen },
  );
  useHotkeys(
    "3",
    (e) => {
      e.preventDefault();
      handleRate(3);
    },
    { enabled: phase === "answer" && !anyModalOpen },
  );
  useHotkeys(
    "4",
    (e) => {
      e.preventDefault();
      handleRate(4);
    },
    { enabled: phase === "answer" && !anyModalOpen },
  );
  useHotkeys("escape", () => requestQuit(), { enabled: phase !== "done" && !anyModalOpen });
  useHotkeys("s", () => handleSuspend(), {
    enabled: phase !== "done" && phase !== "submitting" && !anyModalOpen,
  });
  useHotkeys("shift+slash", () => setHelpOpen((v) => !v));

  const totalForBar = cards.length;
  const displayedIndex = useMemo(
    () => (phase === "done" ? totalForBar : Math.min(currentIndex + 1, totalForBar)),
    [currentIndex, phase, totalForBar],
  );

  // Render --------------------------------------------------------------------
  if (phase === "done" || !current) {
    return (
      <ReviewSummary
        deckId={deckId}
        reviewed={reviewed}
        durationMs={Date.now() - startedAtRef.current}
        remainingDue={remainingDue.length}
        onContinue={remainingDue.length > 0 ? handleContinue : undefined}
      />
    );
  }

  // Sketch only for free-form templates (Labs).
  const sketchableTemplate =
    current.note.template === "basic" ||
    current.note.template === "basic_reverse" ||
    current.note.template === "sentence";
  const showSketch = sketchBeforeFlipEnabled && phase === "question" && sketchableTemplate;

  // Hands-free mode replaces the classic UI for the rest of the session.
  if (handsFreeActive) {
    return (
      <div className="flex h-full min-h-0 flex-col">
        <ReviewProgress
          current={displayedIndex}
          total={totalForBar}
          startedAt={startedAtRef.current}
          onQuit={requestQuit}
          onHelp={() => setHelpOpen(true)}
          label={sessionLabel}
        />
        <HandsFreeReview
          cards={cards.slice(currentIndex)}
          language={languageHint ?? "fr"}
          voice={ttsVoice}
          onSubmit={handleHandsFreeSubmit}
          onExit={handleHandsFreeExit}
          onDone={() => {
            handsFreeGradedRef.current = 0;
            setHandsFreeActive(false);
            setPhase("done");
          }}
        />
        {ambientSound !== "none" && <AmbientPlayer kind={ambientSound} />}
        <QuitConfirmDialog
          open={confirmQuitOpen}
          onOpenChange={setConfirmQuitOpen}
          reviewedCount={reviewed.length}
          onConfirm={doQuit}
        />
      </div>
    );
  }

  return (
    <div className="flex h-full min-h-0 flex-col">
      <ReviewProgress
        current={displayedIndex}
        total={totalForBar}
        startedAt={startedAtRef.current}
        onQuit={requestQuit}
        onHelp={() => setHelpOpen(true)}
        label={sessionLabel}
      />

      {handsFreeEnabled && (
        <div className="flex justify-center pt-2">
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => {
              handsFreeGradedRef.current = 0;
              setHandsFreeActive(true);
            }}
          >
            <Headphones className="mr-1 h-4 w-4" aria-hidden />
            Mode mains-libres
          </Button>
        </div>
      )}

      <div className="flex flex-1 flex-col items-center justify-center gap-8 px-4 py-8">
        <ReviewCard
          note={current.note}
          phase={phase}
          cardOrd={current.card.card_ord}
          typeTheAnswerEnabled={typeTheAnswerEnabled}
          voiceAnswerEnabled={voiceAnswerEnabled}
          languageHint={languageHint}
          onTypedAnswer={handleTypedAnswer}
        />
        {showSketch && (
          <div className="w-full max-w-2xl">
            <SketchCanvas
              key={`sketch-${current.card.id}`}
              onExport={(url) => {
                sketchDataRef.current = url;
              }}
            />
          </div>
        )}
        <div className="flex w-full max-w-2xl flex-col items-center gap-3">
          {/* Type/voice answer similarity hint — advisory only. */}
          {typedAnswer && phase === "answer" && (
            <div
              className="flex flex-col items-center gap-0.5 rounded-md border border-primary/20 bg-primary/5 px-3 py-1.5 text-sm"
              data-testid="typed-answer-hint"
            >
              <span className="font-medium text-primary">
                Similarité : {Math.round(typedAnswer.score * 100)}%
              </span>
              <span className="text-xs text-muted-foreground">
                Suggestion : {ratingSuggestion(typedAnswer.verdict)}
              </span>
            </div>
          )}
          <ReviewControls
            phase={phase}
            cardId={current.card.id}
            onFlip={handleFlip}
            onRate={handleRate}
            pendingRating={pendingRating}
            confidenceEnabled={confidenceEnabled}
            confidenceValue={confidence}
            onConfidenceChange={setConfidence}
          />
        </div>
      </div>

      {ambientSound !== "none" && <AmbientPlayer kind={ambientSound} />}

      <Dialog open={helpOpen} onOpenChange={setHelpOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Raccourcis clavier</DialogTitle>
            <DialogDescription>
              Garde les mains sur le clavier pour rester rapide.
            </DialogDescription>
          </DialogHeader>
          <ul className="space-y-2 text-sm">
            <Shortcut keys="Espace" label="Afficher la réponse" />
            <Shortcut keys="1 / 2 / 3 / 4" label="Noter Encore / Difficile / Bien / Facile" />
            <Shortcut keys="S" label="Suspendre la carte" />
            <Shortcut keys="?" label="Afficher cette aide" />
            <Shortcut keys="Échap" label="Quitter la session" />
          </ul>
        </DialogContent>
      </Dialog>

      <QuitConfirmDialog
        open={confirmQuitOpen}
        onOpenChange={setConfirmQuitOpen}
        reviewedCount={reviewed.length}
        onConfirm={doQuit}
      />
    </div>
  );
}

/** Quit confirmation — shared by the button and the Esc hotkey. */
function QuitConfirmDialog({
  open,
  onOpenChange,
  reviewedCount,
  onConfirm,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  reviewedCount: number;
  onConfirm: () => void;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Quitter la session ?</DialogTitle>
          <DialogDescription>
            Tu as déjà révisé {reviewedCount} cartes. Le progrès est sauvegardé carte par carte — tu
            peux reprendre à tout moment.
          </DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Continuer la session
          </Button>
          <Button
            variant="destructive"
            onClick={() => {
              onOpenChange(false);
              onConfirm();
            }}
          >
            Quitter
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/** Valid OpenAI/Piper TTS voices — kept in sync with the `TTSVoice` union. */
const TTS_VOICES: readonly TTSVoice[] = [
  "alloy",
  "echo",
  "fable",
  "onyx",
  "nova",
  "shimmer",
  "coral",
  "sage",
];

/**
 * Narrow a persisted `tts_voice` string to the `TTSVoice` union. Returns
 * `undefined` for `null`/unset or any unrecognised value.
 */
function narrowTtsVoice(value: string | null | undefined): TTSVoice | undefined {
  return value != null && (TTS_VOICES as readonly string[]).includes(value)
    ? (value as TTSVoice)
    : undefined;
}

/** Map a type/voice answer verdict to a human-readable rating suggestion. */
function ratingSuggestion(verdict: TypeAnswerVerdict): string {
  switch (verdict) {
    case "excellent":
      return "Easy / Good (4 ou 3)";
    case "close":
      return "Good / Hard (3 ou 2)";
    default:
      return "Again (1)";
  }
}

function Shortcut({ keys, label }: { keys: string; label: string }) {
  return (
    <li className="flex items-center justify-between gap-3">
      <span className="text-muted-foreground">{label}</span>
      <kbd className="rounded border bg-muted px-2 py-1 font-mono text-xs">{keys}</kbd>
    </li>
  );
}
