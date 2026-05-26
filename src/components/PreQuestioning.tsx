/**
 * Pre-questioning — curiosity-priming Q&A before a study session.
 *
 * On mount, fires `useGeneratePreQuestions` against the deck. While the LLM
 * is round-tripping we show a loading skeleton; on success we surface the
 * questions one at a time with a free-form textarea so the learner can
 * commit their guess to memory ("retrieval before encoding" boosts the
 * primacy effect even when the guess is wrong — Pan et al. 2023, g≈0.45).
 *
 * Failure mode: if the LLM call errors (missing API key, network, etc.) we
 * show an inline alert with a "Continuer sans" button so the session never
 * gets stuck on a wonky pre-questioning step.
 *
 * UX safety:
 *   - The component is render-once: parents must make sure they don't
 *     remount it mid-session (handled in `ReviewSession` by gating on a
 *     `preQuestionsDone` flag).
 *   - The learner can always skip via "Passer ces questions" at any step.
 */

import { ArrowRight, Loader2 } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Textarea } from "@/components/ui/textarea";
import { useGeneratePreQuestions } from "@/lib/queries";

interface PreQuestioningProps {
  deckId: number;
  /** Hint passed straight to the LLM (`"fr"`, `"en"`, ...). */
  language: string;
  /** Number of questions to ask (clamped 1..5 server-side). */
  count?: number;
  /** Called when the learner finishes (or skips) the pre-questioning step. */
  onComplete: () => void;
}

export function PreQuestioning({ deckId, language, count = 3, onComplete }: PreQuestioningProps) {
  const mutation = useGeneratePreQuestions();
  const [index, setIndex] = useState(0);
  const [draft, setDraft] = useState("");

  // Fire the mutation once on mount. The parent owns the « should this even
  // render? » decision so retries are explicit (user-initiated).
  // biome-ignore lint/correctness/useExhaustiveDependencies: mount-only effect
  useEffect(() => {
    mutation.mutate({ deckId, count, language });
  }, []);

  const questions = useMemo(() => mutation.data ?? [], [mutation.data]);
  const current = questions[index];
  const isLast = index >= questions.length - 1;

  const handleNext = useCallback(() => {
    // We intentionally don't persist `draft` — the pedagogical value is the
    // act of retrieval, not the produced text. Once the learner clicks
    // "Question suivante" the guess can be safely discarded.
    setDraft("");
    if (isLast) {
      onComplete();
    } else {
      setIndex((i) => i + 1);
    }
  }, [isLast, onComplete]);

  const handleSkipAll = useCallback(() => {
    onComplete();
  }, [onComplete]);

  // -------- Loading -------------------------------------------------------
  if (mutation.isPending) {
    return (
      <Card className="w-full max-w-2xl" data-testid="pre-questioning-loading">
        <CardHeader>
          <CardTitle>Préparation de l'esprit</CardTitle>
          <CardDescription>
            On génère quelques questions d'amorçage pour activer ta curiosité…
          </CardDescription>
        </CardHeader>
        <CardContent className="flex items-center gap-3 text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" />
          <span>Quelques secondes…</span>
        </CardContent>
      </Card>
    );
  }

  // -------- Error / empty -------------------------------------------------
  if (mutation.isError) {
    return (
      <Card className="w-full max-w-2xl border-amber-500/40" data-testid="pre-questioning-error">
        <CardHeader>
          <CardTitle>Pré-questionnement indisponible</CardTitle>
          <CardDescription className="text-xs">
            {mutation.error?.message ?? "Erreur inconnue."}
          </CardDescription>
        </CardHeader>
        <CardContent className="flex justify-end gap-2">
          <Button variant="outline" onClick={() => mutation.mutate({ deckId, count, language })}>
            Réessayer
          </Button>
          <Button onClick={handleSkipAll}>Continuer sans</Button>
        </CardContent>
      </Card>
    );
  }

  if (!current) {
    // No questions came back. Skip silently.
    return (
      <Card className="w-full max-w-2xl" data-testid="pre-questioning-empty">
        <CardHeader>
          <CardTitle>Prêt·e ?</CardTitle>
          <CardDescription>Aucune question d'amorçage générée.</CardDescription>
        </CardHeader>
        <CardContent className="flex justify-end">
          <Button onClick={handleSkipAll}>Commencer</Button>
        </CardContent>
      </Card>
    );
  }

  // -------- Active question ----------------------------------------------
  const progressLabel = `Question ${index + 1} / ${questions.length}`;

  return (
    <Card className="w-full max-w-2xl" data-testid="pre-questioning-active">
      <CardHeader>
        <div className="flex items-center justify-between">
          <CardTitle>Pré-questionnement</CardTitle>
          <span className="rounded bg-muted px-2 py-1 text-xs font-medium text-muted-foreground">
            {progressLabel}
          </span>
        </div>
        <CardDescription>
          Réponds à ce que tu penses — sans pression. L'objectif est d'activer ton attention.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <p className="text-lg font-medium leading-relaxed" data-testid="pre-questioning-question">
          {current}
        </p>
        <Textarea
          key={index}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          placeholder="Tu penses que la réponse est…"
          rows={3}
          aria-label="Ta réponse"
        />
        <div className="flex justify-between gap-2">
          <Button variant="ghost" onClick={handleSkipAll}>
            Passer ces questions
          </Button>
          <Button onClick={handleNext}>
            {isLast ? "Commencer les révisions" : "Question suivante"}
            <ArrowRight className="ml-2 h-4 w-4" />
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
