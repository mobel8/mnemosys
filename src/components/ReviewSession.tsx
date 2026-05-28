/**
 * State machine + layout for an in-progress review session.
 *
 * Phases:
 *   - `question`   : current card's recto is showing, awaiting a flip.
 *   - `answer`     : verso revealed, awaiting a rating.
 *   - `submitting` : `submit_review` mutation in flight; controls disabled.
 *   - `done`       : queue exhausted; `<ReviewSummary />` takes over.
 *
 * The component owns:
 *   - The local queue snapshot (we don't re-fetch mid-session; new cards
 *     that come due appear in the post-session "Continuer" CTA instead).
 *   - The reviewed log (rating + ms + correctness) used for the summary.
 *   - Timestamps `startedAt` (session start) and `cardShownAt` (per card,
 *     reset when transitioning to a new card).
 *
 * Keyboard bindings:
 *   - Space      : flip (question phase only)
 *   - 1, 2, 3, 4 : rating (answer phase only)
 *   - s          : suspend current card and skip
 *   - Esc        : quit (with confirm in the progress bar)
 *   - ?          : show shortcut help
 *
 * We deliberately keep this stateful logic in the component rather than the
 * shared `useReviewSession` Zustand store: that store is read by the
 * sidebar pill (a different agent's surface area) and bloating it with a
 * full state machine + reviewed log would couple two unrelated concerns.
 * The lightweight store stays the source of truth for "is a session in
 * progress?", and we mirror `currentIndex`/`reviewedCount` into it so the
 * pill stays accurate.
 */

import { useNavigate } from "@tanstack/react-router";
import { Headphones } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useHotkeys } from "react-hotkeys-hook";
import { AmbientPlayer } from "@/components/AmbientPlayer";
import { ConfidenceRating } from "@/components/ConfidenceRating";
import { CyclicSighing } from "@/components/CyclicSighing";
import { FocusGuard } from "@/components/FocusGuard";
import { HandsFreeReview } from "@/components/HandsFreeReview";
import { MoodCheckIn } from "@/components/MoodCheckIn";
import { PreQuestioning } from "@/components/PreQuestioning";
import { PretestPrompt } from "@/components/PretestPrompt";
import { ReviewCard } from "@/components/ReviewCard";
import { ReviewControls } from "@/components/ReviewControls";
import { ReviewProgress } from "@/components/ReviewProgress";
import { type ReviewedLog, ReviewSummary } from "@/components/ReviewSummary";
import { SelfExplanationPrompt } from "@/components/SelfExplanationPrompt";
import { SketchCanvas } from "@/components/SketchCanvas";
import type { TypeAnswerVerdict } from "@/components/TypeAnswer";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Toast, ToastDescription, ToastTitle } from "@/components/ui/toast";
import {
  useSaveSketch,
  useSettingsQuery,
  useSubmitReview,
  useSuspendCard,
  useTodayWellness,
} from "@/lib/queries";
import { useReviewSession } from "@/lib/stores/review";
import type { CardWithNote, Rating, TTSVoice, WellnessLog } from "@/lib/tauri";

type Phase = "question" | "answer" | "submitting" | "done";

interface ReviewSessionProps {
  deckId: number;
  cards: CardWithNote[];
}

interface InlineToast {
  id: number;
  title: string;
  description?: string;
  variant?: "default" | "destructive";
}

export function ReviewSession({ deckId, cards: initial }: ReviewSessionProps) {
  const navigate = useNavigate();
  const submitReview = useSubmitReview();
  const suspendCard = useSuspendCard();
  const saveSketch = useSaveSketch();
  const settings = useSettingsQuery();

  // Snapshot the queue once; the parent route only renders us when due
  // cards arrive, so `initial` is stable per-mount.
  const [cards, setCards] = useState<CardWithNote[]>(initial);
  const [currentIndex, setCurrentIndex] = useState(0);
  const [phase, setPhase] = useState<Phase>(cards.length === 0 ? "done" : "question");
  const [reviewed, setReviewed] = useState<ReviewedLog[]>([]);
  const [pendingRating, setPendingRating] = useState<Rating | null>(null);
  const [helpOpen, setHelpOpen] = useState(false);
  const [toasts, setToasts] = useState<InlineToast[]>([]);
  const toastSeqRef = useRef(0);
  // Vague 2 — cognitive features state.
  // Whether pre-questioning still has to play before the queue. Stays
  // independent of `phase` so we don't intertwine the session machine
  // with the priming step.
  const [preQuestionsDone, setPreQuestionsDone] = useState(false);
  // Per-card confidence buffer. Reset on every card transition.
  const [confidence, setConfidence] = useState<number | null>(null);
  // Vague 15 — per-card retrospective confidence (captured AFTER the flip).
  // Reset on every card transition like the prospective buffer.
  const [confidencePost, setConfidencePost] = useState<number | null>(null);
  // Vague 7 — latest sketch PNG data-URL for the current card (kept in a ref so
  // each stroke doesn't re-render the session). Reset on every card transition.
  const sketchDataRef = useRef<string | null>(null);
  // Vague 8 — most recent type/voice answer outcome for the current card. Used
  // to surface the similarity score + suggest (not auto-apply) a rating. Reset
  // on every card transition.
  const [typedAnswer, setTypedAnswer] = useState<{
    score: number;
    verdict: TypeAnswerVerdict;
  } | null>(null);
  const typeTheAnswerEnabled = settings.data?.type_the_answer_enabled ?? false;
  const voiceAnswerEnabled = settings.data?.voice_answer_enabled ?? false;
  const confidenceEnabled = settings.data?.confidence_rating_enabled ?? false;
  // Vague 7 — sketch-before-flip (Wammes et al. 2016). When on, basic /
  // basic_reverse / sentence cards show a drawing canvas during the question
  // phase; the captured PNG is attached to the review on submit.
  const sketchBeforeFlipEnabled = settings.data?.sketch_before_flip_enabled ?? false;
  const preQuestioningEnabled = settings.data?.pre_questioning_enabled ?? false;
  // --- Vague 12 — cognitive features --------------------------------------
  const pretestModeEnabled = settings.data?.pretest_mode_enabled ?? false;
  const selfExplanationEnabled = settings.data?.self_explanation_enabled ?? false;
  const focusGuardEnabled = settings.data?.focus_guard_enabled ?? false;
  // Vague 18 — context ambient sound (Godden & Baddeley). Independent of the
  // neuro master switch; gated only by its own setting.
  const ambientSound = settings.data?.ambient_sound ?? "none";
  // Vague 23 — hands-free (audio + voice) review mode. Gated by its setting;
  // `handsFreeActive` toggles the alternative UI for the current session only.
  const handsFreeEnabled = settings.data?.hands_free_enabled ?? false;
  const [handsFreeActive, setHandsFreeActive] = useState(false);
  // Narrow the persisted `tts_voice` (a free-form `string | null`) to the
  // `TTSVoice` union HandsFreeReview expects, falling back to `undefined` (the
  // component then uses its own default) for unset or unknown values.
  const ttsVoice = useMemo(
    () => narrowTtsVoice(settings.data?.tts_voice),
    [settings.data?.tts_voice],
  );
  // Per-card pretest gate: which card index has already shown (or skipped)
  // its pretest prompt. Reset implicitly because we key on the index.
  const [pretestDoneForIndex, setPretestDoneForIndex] = useState<number | null>(null);
  // Self-explanation: once shown for the current card we set this so the
  // prompt doesn't re-trigger after the learner continues. Reset per card.
  const [selfExplanationDone, setSelfExplanationDone] = useState(false);
  // --- Vague 3 — neuro modes state ----------------------------------------
  const neuroEnabled = settings.data?.neuro_modes_enabled ?? false;
  const moodCheckinEnabled = (settings.data?.mood_checkin_enabled ?? false) && neuroEnabled;
  const cyclicSighingEnabled = (settings.data?.cyclic_sighing_enabled ?? false) && neuroEnabled;
  const todayWellness = useTodayWellness({ enabled: moodCheckinEnabled });
  const [moodCheckinOpen, setMoodCheckinOpen] = useState(false);
  const [moodCheckinDone, setMoodCheckinDone] = useState(false);
  const [cyclicSighingOpen, setCyclicSighingOpen] = useState(false);
  const [cyclicSighingDone, setCyclicSighingDone] = useState(false);

  // Decide whether to show the check-in. Done exactly once per session.
  useEffect(() => {
    if (!moodCheckinEnabled || moodCheckinDone) return;
    if (todayWellness.isLoading) return;
    if (todayWellness.data) {
      // A row exists for today — skip the modal but still consider it done.
      setMoodCheckinDone(true);
      // Surface the high-stress nudge from yesterday's data, when applicable.
      if (
        cyclicSighingEnabled &&
        (todayWellness.data.stress_level ?? 0) >= 4 &&
        !cyclicSighingDone
      ) {
        setCyclicSighingOpen(true);
      }
      return;
    }
    setMoodCheckinOpen(true);
  }, [
    moodCheckinEnabled,
    moodCheckinDone,
    todayWellness.data,
    todayWellness.isLoading,
    cyclicSighingEnabled,
    cyclicSighingDone,
  ]);

  const handleMoodSubmit = useCallback(
    (log: WellnessLog) => {
      setMoodCheckinDone(true);
      // Stress >= 4 + cyclic-sighing toggle on → suggest the primer.
      if (cyclicSighingEnabled && (log.stress_level ?? 0) >= 4 && !cyclicSighingDone) {
        setCyclicSighingOpen(true);
      }
    },
    [cyclicSighingEnabled, cyclicSighingDone],
  );

  const startedAtRef = useRef<number>(Date.now());
  const cardShownAtRef = useRef<number>(Date.now());

  const startSessionInStore = useReviewSession((s) => s.startSession);
  const advanceInStore = useReviewSession((s) => s.advance);
  const resetStore = useReviewSession((s) => s.reset);
  const markShown = useReviewSession((s) => s.markCardShown);

  // Mirror the queue into the shared store on mount; tear it down on unmount.
  // We deliberately ignore the dependency array warning — Zustand actions are
  // stable refs and we want this effect to fire exactly once per session.
  // biome-ignore lint/correctness/useExhaustiveDependencies: intentional mount-only effect
  useEffect(() => {
    startSessionInStore(deckId, initial);
    return () => {
      resetStore();
    };
  }, []);

  const current = cards[currentIndex];

  const pushToast = useCallback((t: Omit<InlineToast, "id">) => {
    toastSeqRef.current += 1;
    const id = toastSeqRef.current;
    setToasts((prev) => [...prev, { ...t, id }]);
    window.setTimeout(() => {
      setToasts((prev) => prev.filter((x) => x.id !== id));
    }, 3500);
  }, []);

  const advanceToNext = useCallback(() => {
    setCurrentIndex((i) => {
      const next = i + 1;
      if (next >= cards.length) {
        setPhase("done");
      } else {
        setPhase("question");
        cardShownAtRef.current = Date.now();
        markShown();
      }
      return next;
    });
    // Reset the per-card confidence buffers so each card starts fresh.
    setConfidence(null);
    setConfidencePost(null);
    // Reset the per-card sketch + typed-answer buffers (Vague 7 / Vague 8).
    sketchDataRef.current = null;
    setTypedAnswer(null);
    // Reset the self-explanation gate for the next card.
    setSelfExplanationDone(false);
    advanceInStore();
  }, [advanceInStore, cards.length, markShown]);

  const handleFlip = useCallback(() => {
    if (phase !== "question" || !current) return;
    // Vague 12 — block the flip while the pretest prompt is still up for a
    // new card; the learner must reveal via the prompt's own button first.
    if (
      pretestModeEnabled &&
      current.card.state === "new" &&
      pretestDoneForIndex !== currentIndex
    ) {
      return;
    }
    setPhase("answer");
  }, [phase, current, pretestModeEnabled, pretestDoneForIndex, currentIndex]);

  const handleRate = useCallback(
    (rating: Rating) => {
      if (phase !== "answer" || !current) return;
      // Vague 12 — if the self-explanation prompt is still showing for this
      // card, the rating row (and its 1-4 hotkeys) is gated until continue.
      if (selfExplanationEnabled && !selfExplanationDone && current.card.id % 5 === 0) {
        return;
      }
      const reviewTimeMs = Math.max(0, Date.now() - cardShownAtRef.current);
      setPhase("submitting");
      setPendingRating(rating);
      // Only forward `confidence` when the toggle is on *and* the learner
      // actually picked a value. Otherwise the backend keeps it NULL. Same
      // gate for the retrospective confidence (Vague 15).
      const confidenceForSubmit = confidenceEnabled && confidence !== null ? confidence : null;
      const confidencePostForSubmit =
        confidenceEnabled && confidencePost !== null ? confidencePost : null;
      // Vague 7 — snapshot the sketch + card id *before* the async hop so the
      // per-card buffer reset in `advanceToNext` can't race the save.
      const cardId = current.card.id;
      const sketchData = sketchBeforeFlipEnabled ? sketchDataRef.current : null;
      submitReview.mutate(
        {
          cardId,
          rating,
          reviewTimeMs,
          confidence: confidenceForSubmit,
          confidencePost: confidencePostForSubmit,
        },
        {
          onSuccess: (result) => {
            setReviewed((log) => [
              ...log,
              {
                rating,
                review_time_ms: reviewTimeMs,
                correct: rating >= 3,
              },
            ]);
            // Vague 7 — attach the captured drawing to this exact review. The
            // sketch is best-effort: a failure must never block the queue, so
            // we swallow it (the review itself is already persisted).
            if (sketchData) {
              saveSketch.mutate(
                { reviewId: result.review_id, cardId, sketchData },
                {
                  onError: (err) => {
                    pushToast({
                      title: "Croquis non enregistré",
                      description: err.message,
                      variant: "destructive",
                    });
                  },
                },
              );
            }
            setPendingRating(null);
            advanceToNext();
          },
          onError: (err) => {
            setPendingRating(null);
            setPhase("answer");
            pushToast({
              title: "Échec de l'enregistrement",
              description: err.message,
              variant: "destructive",
            });
          },
        },
      );
    },
    [
      advanceToNext,
      confidence,
      confidencePost,
      confidenceEnabled,
      current,
      phase,
      pushToast,
      submitReview,
      saveSketch,
      sketchBeforeFlipEnabled,
      selfExplanationEnabled,
      selfExplanationDone,
    ],
  );

  // Vague 8 — record a type/voice answer outcome. We surface the similarity
  // score and suggest a rating but never auto-grade: FSRS stays under the
  // learner's control (a self-rated « Again » on a typo is still valid signal).
  const handleTypedAnswer = useCallback(
    (_typed: string, score: number, verdict: TypeAnswerVerdict) => {
      setTypedAnswer({ score, verdict });
      const pct = Math.round(score * 100);
      pushToast({
        title:
          verdict === "excellent"
            ? `Réponse exacte (${pct}%)`
            : verdict === "close"
              ? `Presque (${pct}%)`
              : `Réponse éloignée (${pct}%)`,
        description:
          verdict === "incorrect"
            ? "Compare avec la bonne réponse, puis note honnêtement."
            : "Vérifie la réponse, puis choisis ta note.",
      });
    },
    [pushToast],
  );

  // Vague 23 — hands-free grade handler. HandsFreeReview owns its own cursor
  // over the same `cards` snapshot, so here we only persist the grade, append
  // to the reviewed log, and nudge the shared store pill. The queue cursor +
  // "next card" transition live inside HandsFreeReview; `onDone` flips us to
  // the summary.
  const handleHandsFreeSubmit = useCallback(
    (cardId: number, rating: Rating, reviewTimeMs: number) => {
      submitReview.mutate(
        { cardId, rating, reviewTimeMs, confidence: null, confidencePost: null },
        {
          onSuccess: () => {
            setReviewed((log) => [
              ...log,
              { rating, review_time_ms: reviewTimeMs, correct: rating >= 3 },
            ]);
            advanceInStore();
          },
          onError: (err) => {
            pushToast({
              title: "Échec de l'enregistrement",
              description: err.message,
              variant: "destructive",
            });
          },
        },
      );
    },
    [advanceInStore, pushToast, submitReview],
  );

  const handleQuit = useCallback(() => {
    // `deckId < 0` is the interleaved-session sentinel (see InterleavedSession).
    // A mixed queue has no canonical deck, so route back to the interleaved
    // entry point rather than a non-existent `/decks/-1`.
    if (deckId < 0) {
      navigate({ to: "/review-interleaved" });
      return;
    }
    navigate({ to: "/decks/$deckId", params: { deckId } });
  }, [deckId, navigate]);

  const handleSuspend = useCallback(() => {
    if (!current || phase === "submitting" || phase === "done") return;
    const cardId = current.card.id;
    // Optimistically remove from the local queue; the mutation will sync the
    // backend + caches. If it fails we restore the card.
    const removed = current;
    setCards((prev) => prev.filter((_c, idx) => idx !== currentIndex));
    suspendCard.mutate(
      { id: cardId, suspended: true },
      {
        onSuccess: () => {
          pushToast({ title: "Carte suspendue" });
          // The card was spliced out, so `currentIndex` now points at what
          // used to be `currentIndex + 1`. If we just ran past the end, mark
          // the session done.
          setCurrentIndex((i) => {
            const lengthAfter = cards.length - 1;
            if (i >= lengthAfter) {
              setPhase("done");
              return i;
            }
            setPhase("question");
            cardShownAtRef.current = Date.now();
            markShown();
            return i;
          });
        },
        onError: (err) => {
          // Roll back the optimistic splice.
          setCards((prev) => {
            const next = prev.slice();
            next.splice(currentIndex, 0, removed);
            return next;
          });
          pushToast({
            title: "Suspension impossible",
            description: err.message,
            variant: "destructive",
          });
        },
      },
    );
  }, [cards.length, current, currentIndex, markShown, phase, pushToast, suspendCard]);

  // NOTE: there is intentionally no "edit current card" hotkey. The only
  // editor route (`/decks/$deckId/new-card`) creates a *blank* note — it has
  // no `validateSearch` to load an existing card, and `<NoteEditor>` exposes
  // no edit-by-id mode. Wiring `E` to that route would drop the learner on an
  // empty form that silently discards the card they meant to fix, which is
  // worse than no shortcut. Re-introduce `E` once inline card editing exists.

  // ---- Hotkeys -----------------------------------------------------------
  // react-hotkeys-hook v5 — `enableOnFormTags` defaults to false (good: we
  // don't want Space to flip while the user types in a search field).
  useHotkeys(
    "space",
    (e) => {
      e.preventDefault();
      handleFlip();
    },
    { enabled: phase === "question" },
  );

  useHotkeys(
    "1",
    (e) => {
      e.preventDefault();
      handleRate(1);
    },
    { enabled: phase === "answer" },
  );
  useHotkeys(
    "2",
    (e) => {
      e.preventDefault();
      handleRate(2);
    },
    { enabled: phase === "answer" },
  );
  useHotkeys(
    "3",
    (e) => {
      e.preventDefault();
      handleRate(3);
    },
    { enabled: phase === "answer" },
  );
  useHotkeys(
    "4",
    (e) => {
      e.preventDefault();
      handleRate(4);
    },
    { enabled: phase === "answer" },
  );
  useHotkeys("escape", () => handleQuit(), { enabled: phase !== "done" });
  useHotkeys("s", () => handleSuspend(), { enabled: phase !== "done" && phase !== "submitting" });
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
      />
    );
  }

  // Pre-questioning takes precedence over the queue exactly once per
  // session. Once `preQuestionsDone` is set the user can't replay it
  // (matches Pan et al. 2023's « priming once, at the start ») nor
  // accidentally trigger a second LLM call.
  if (preQuestioningEnabled && !preQuestionsDone) {
    return (
      <div className="flex h-full min-h-0 flex-col">
        <ReviewProgress
          current={0}
          total={totalForBar}
          startedAt={startedAtRef.current}
          reviewedCount={0}
          onQuit={handleQuit}
          onHelp={() => setHelpOpen(true)}
        />
        <div className="flex flex-1 items-center justify-center px-4 py-8">
          <PreQuestioning
            deckId={deckId}
            language="fr"
            onComplete={() => {
              setPreQuestionsDone(true);
              cardShownAtRef.current = Date.now();
            }}
          />
        </div>
      </div>
    );
  }

  // --- Vague 12 — pretest gate --------------------------------------------
  // For a brand-new card, when pretest mode is on and we haven't yet cleared
  // the prompt for this card index, intercept the question phase with a guess
  // prompt before the normal flip flow resumes.
  const showPretest =
    pretestModeEnabled &&
    phase === "question" &&
    current.card.state === "new" &&
    pretestDoneForIndex !== currentIndex;

  // --- Vague 12 — self-explanation gate -----------------------------------
  // After the flip (answer phase) on ~1 card in 5 (deterministic via the
  // card id), ask the learner to explain the answer before the rating row.
  const showSelfExplanation =
    selfExplanationEnabled &&
    phase === "answer" &&
    !selfExplanationDone &&
    current.card.id % 5 === 0;

  // --- Vague 7 — sketch-before-flip gate ----------------------------------
  // Offer the drawing canvas during the question phase only, and only for
  // templates with a free-form prompt to draw (basic / basic_reverse /
  // sentence). Cloze / occlusion / disciplinary templates already demand
  // retrieval through their own UI, so a sketch box there would be noise.
  const sketchableTemplate =
    current.note.template === "basic" ||
    current.note.template === "basic_reverse" ||
    current.note.template === "sentence";
  const showSketch =
    sketchBeforeFlipEnabled && phase === "question" && sketchableTemplate && !showPretest;

  // --- Vague 23 — hands-free mode -----------------------------------------
  // When active, an audio/voice loop replaces the classic flip/rate UI for the
  // remainder of the session. It drives its own cursor over the snapshot from
  // the current card onward; we feed it the not-yet-reviewed slice so an
  // already-graded card isn't replayed if the learner toggled mid-session.
  if (handsFreeActive) {
    return (
      <div className="flex h-full min-h-0 flex-col">
        <ReviewProgress
          current={displayedIndex}
          total={totalForBar}
          startedAt={startedAtRef.current}
          reviewedCount={reviewed.length}
          onQuit={handleQuit}
          onHelp={() => setHelpOpen(true)}
        />
        <HandsFreeReview
          cards={cards.slice(currentIndex)}
          language="fr"
          voice={ttsVoice}
          onSubmit={handleHandsFreeSubmit}
          onExit={() => setHandsFreeActive(false)}
          onDone={() => {
            setHandsFreeActive(false);
            setPhase("done");
          }}
        />
        {ambientSound !== "none" && <AmbientPlayer kind={ambientSound} />}
      </div>
    );
  }

  return (
    <div className="flex h-full min-h-0 flex-col">
      <ReviewProgress
        current={displayedIndex}
        total={totalForBar}
        startedAt={startedAtRef.current}
        reviewedCount={reviewed.length}
        onQuit={handleQuit}
        onHelp={() => setHelpOpen(true)}
      />

      {/* Vague 23 — switch the current session into the audio/voice loop. */}
      {handsFreeEnabled && (
        <div className="flex justify-center pt-2">
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => setHandsFreeActive(true)}
          >
            <Headphones className="mr-1 h-4 w-4" aria-hidden />
            Mode mains-libres
          </Button>
        </div>
      )}

      {showPretest ? (
        <div className="flex flex-1 items-center justify-center px-4 py-8">
          <PretestPrompt
            key={`pretest-${current.card.id}`}
            front={getCardFront(current)}
            onComplete={() => {
              // The guess isn't scored — clearing the gate resumes the flip
              // flow on the very same (still-unflipped) card.
              setPretestDoneForIndex(currentIndex);
              cardShownAtRef.current = Date.now();
            }}
          />
        </div>
      ) : (
        <div className="flex flex-1 flex-col items-center justify-center gap-8 px-4 py-8">
          <ReviewCard
            note={current.note}
            phase={phase}
            cardOrd={current.card.card_ord}
            typeTheAnswerEnabled={typeTheAnswerEnabled}
            voiceAnswerEnabled={voiceAnswerEnabled}
            onTypedAnswer={handleTypedAnswer}
          />
          {/* Vague 7 — draw the answer before flipping (Wammes et al. 2016).
              The canvas captures its PNG into `sketchDataRef` on each stroke;
              `handleRate` attaches the latest snapshot to the review. */}
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
          {showSelfExplanation ? (
            <SelfExplanationPrompt
              key={`self-expl-${current.card.id}`}
              onContinue={() => setSelfExplanationDone(true)}
            />
          ) : (
            <div className="flex w-full max-w-2xl flex-col items-center gap-3">
              {/* Vague 8 — surface the type/voice answer score + a suggested
                  rating once the answer is visible. Purely advisory: the
                  learner still picks the rating. */}
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
              {/* Vague 15 — two-step: once the answer is visible, capture the
                  retrospective confidence (in addition to the prospective one
                  shown inside ReviewControls). */}
              {confidenceEnabled && phase === "answer" && (
                <ConfidenceRating
                  key={`conf-post-${current.card.id}`}
                  variant="retrospective"
                  value={confidencePost}
                  onChange={setConfidencePost}
                  disabled={false}
                />
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
          )}
        </div>
      )}

      {/* Vague 12 — opt-in webcam focus guard (consent-gated, 100% local). */}
      {focusGuardEnabled && <FocusGuard enabled={focusGuardEnabled} />}

      {/* Vague 18 — context ambient sound; plays for the active review, stops
          when the session ends (this branch unmounts) or the learner quits. */}
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
            <Shortcut keys="1 / 2 / 3 / 4" label="Noter Again / Hard / Good / Easy" />
            <Shortcut keys="S" label="Suspendre la carte" />
            <Shortcut keys="?" label="Afficher cette aide" />
            <Shortcut keys="Échap" label="Quitter la session" />
          </ul>
        </DialogContent>
      </Dialog>

      {/* Inline toast viewport — we render Toasts directly here so they ride
          on top of the session content without depending on a global helper. */}
      <div className="pointer-events-none fixed bottom-4 right-4 z-50 flex flex-col gap-2">
        {toasts.map((t) => (
          <Toast
            key={t.id}
            variant={t.variant}
            className="pointer-events-auto"
            open
            onOpenChange={(open) => {
              if (!open) setToasts((prev) => prev.filter((x) => x.id !== t.id));
            }}
          >
            <div className="grid gap-1">
              <ToastTitle>{t.title}</ToastTitle>
              {t.description && <ToastDescription>{t.description}</ToastDescription>}
            </div>
          </Toast>
        ))}
      </div>

      {/* Vague 3 — neuro modes overlays (opt-in, all gated on settings) */}
      {moodCheckinEnabled && (
        <MoodCheckIn
          open={moodCheckinOpen}
          onClose={() => {
            setMoodCheckinOpen(false);
            setMoodCheckinDone(true);
          }}
          onSubmit={handleMoodSubmit}
        />
      )}
      {cyclicSighingEnabled && (
        <CyclicSighing
          open={cyclicSighingOpen}
          onClose={() => {
            setCyclicSighingOpen(false);
            setCyclicSighingDone(true);
          }}
        />
      )}
    </div>
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
 * `undefined` for `null`/unset or any unrecognised value so callers can fall
 * back to their own default rather than forwarding an invalid voice id.
 */
function narrowTtsVoice(value: string | null | undefined): TTSVoice | undefined {
  return value != null && (TTS_VOICES as readonly string[]).includes(value)
    ? (value as TTSVoice)
    : undefined;
}

/**
 * Vague 8 — map a type/voice answer verdict to a human-readable rating
 * suggestion. Advisory only: the learner still presses the rating button.
 */
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

/**
 * Best-effort recto text for the pretest prompt. Mirrors the field logic in
 * `ReviewCard` (basic `front`, cloze `text`, sentence/bidirectional
 * `source`/`target` by ordinal) so the learner sees the same prompt they'd
 * get on the question face. Occlusion notes have no textual recto; we fall
 * back to an empty string and `PretestPrompt` renders its « recto vide »
 * placeholder (the pretest gate only fires for `new` cards anyway, and
 * occlusion cards still benefit from the guess box even without a stem).
 */
function getCardFront(cwn: CardWithNote): string {
  const { note, card } = cwn;
  const f = note.fields;
  if (note.template === "cloze") {
    return typeof f.text === "string" ? f.text : "";
  }
  if (note.template === "sentence" || note.template === "bidirectional") {
    const source = typeof f.source === "string" ? f.source : "";
    const target = typeof f.target === "string" ? f.target : "";
    return card.card_ord === 1 ? target : source;
  }
  // Vague 14 — disciplinary templates mirror their ReviewCard recto stems.
  if (note.template === "illness_script") {
    const condition = typeof f.condition === "string" ? f.condition : "";
    return condition ? `Décris le tableau de : ${condition}` : "";
  }
  if (note.template === "refutation") {
    const misconception = typeof f.misconception === "string" ? f.misconception : "";
    return misconception ? `Vrai ou faux ? ${misconception}` : "";
  }
  // Vague 15 — worked example recto is the problem statement.
  if (note.template === "worked_example") {
    return typeof f.problem === "string" ? f.problem : "";
  }
  return typeof f.front === "string" ? f.front : "";
}

function Shortcut({ keys, label }: { keys: string; label: string }) {
  return (
    <li className="flex items-center justify-between gap-3">
      <span className="text-muted-foreground">{label}</span>
      <kbd className="rounded border bg-muted px-2 py-1 font-mono text-xs">{keys}</kbd>
    </li>
  );
}
