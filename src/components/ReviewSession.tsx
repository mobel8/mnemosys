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
 *   - e          : edit current card (opens the note editor)
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
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useHotkeys } from "react-hotkeys-hook";
import { CyclicSighing } from "@/components/CyclicSighing";
import { MoodCheckIn } from "@/components/MoodCheckIn";
import { PreQuestioning } from "@/components/PreQuestioning";
import { ReviewCard } from "@/components/ReviewCard";
import { ReviewControls } from "@/components/ReviewControls";
import { ReviewProgress } from "@/components/ReviewProgress";
import { type ReviewedLog, ReviewSummary } from "@/components/ReviewSummary";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Toast, ToastDescription, ToastTitle } from "@/components/ui/toast";
import { useSettingsQuery, useSubmitReview, useSuspendCard, useTodayWellness } from "@/lib/queries";
import { useReviewSession } from "@/lib/stores/review";
import type { CardWithNote, Rating, WellnessLog } from "@/lib/tauri";

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
  const typeTheAnswerEnabled = settings.data?.type_the_answer_enabled ?? false;
  const voiceAnswerEnabled = settings.data?.voice_answer_enabled ?? false;
  const confidenceEnabled = settings.data?.confidence_rating_enabled ?? false;
  const preQuestioningEnabled = settings.data?.pre_questioning_enabled ?? false;
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
    // Reset the per-card confidence buffer so each card starts fresh.
    setConfidence(null);
    advanceInStore();
  }, [advanceInStore, cards.length, markShown]);

  const handleFlip = useCallback(() => {
    if (phase !== "question") return;
    setPhase("answer");
  }, [phase]);

  const handleRate = useCallback(
    (rating: Rating) => {
      if (phase !== "answer" || !current) return;
      const reviewTimeMs = Math.max(0, Date.now() - cardShownAtRef.current);
      setPhase("submitting");
      setPendingRating(rating);
      // Only forward `confidence` when the toggle is on *and* the learner
      // actually picked a value. Otherwise the backend keeps it NULL.
      const confidenceForSubmit = confidenceEnabled && confidence !== null ? confidence : null;
      submitReview.mutate(
        {
          cardId: current.card.id,
          rating,
          reviewTimeMs,
          confidence: confidenceForSubmit,
        },
        {
          onSuccess: () => {
            setReviewed((log) => [
              ...log,
              {
                rating,
                review_time_ms: reviewTimeMs,
                correct: rating >= 3,
              },
            ]);
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
    [advanceToNext, confidence, confidenceEnabled, current, phase, pushToast, submitReview],
  );

  const handleQuit = useCallback(() => {
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

  const handleEdit = useCallback(() => {
    if (!current) return;
    // Edit deep-link lands on the same editor route; the editor (B2 territory)
    // will eventually wire up a `validateSearch` and pick the card id from
    // the URL. Until then we just navigate to the editor with the card id
    // appended manually so the future schema can read it via
    // `window.location.search`.
    navigate({
      to: "/decks/$deckId/new-card",
      params: { deckId },
    });
  }, [current, deckId, navigate]);

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
  useHotkeys("e", () => handleEdit(), { enabled: phase !== "done" && phase !== "submitting" });
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

      <div className="flex flex-1 flex-col items-center justify-center gap-8 px-4 py-8">
        <ReviewCard
          note={current.note}
          phase={phase}
          cardOrd={current.card.card_ord}
          typeTheAnswerEnabled={typeTheAnswerEnabled}
          voiceAnswerEnabled={voiceAnswerEnabled}
        />
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
            <Shortcut keys="E" label="Éditer la carte" />
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

function Shortcut({ keys, label }: { keys: string; label: string }) {
  return (
    <li className="flex items-center justify-between gap-3">
      <span className="text-muted-foreground">{label}</span>
      <kbd className="rounded border bg-muted px-2 py-1 font-mono text-xs">{keys}</kbd>
    </li>
  );
}
