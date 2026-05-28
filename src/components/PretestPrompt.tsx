/**
 * Pretest prompt — Vague 12 (pretesting effect, Pan et al. 2023).
 *
 * Shown for a brand-new card (`state === "new"`) BEFORE the normal
 * recto/verso flow when `pretest_mode_enabled` is on. The learner is asked
 * to *guess* the answer — even one that will be wrong — because the failed
 * retrieval attempt itself boosts encoding of the correct answer that
 * follows.
 *
 * The guess is **never scored**: it's a pure engagement prompt. Once the
 * learner clicks « Révéler » (or hits Enter / submits empty) we hand the
 * captured text back via `onComplete` and the parent resumes the standard
 * flip flow.
 */

import { Lightbulb } from "lucide-react";
import { useCallback, useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Textarea } from "@/components/ui/textarea";

interface PretestPromptProps {
  /** Recto of the new card — shown so the learner has something to guess at. */
  front: string;
  /** Called when the learner reveals. Carries the (possibly empty) guess. */
  onComplete: (guess: string) => void;
}

export function PretestPrompt({ front, onComplete }: PretestPromptProps) {
  const [guess, setGuess] = useState("");

  const handleReveal = useCallback(() => {
    onComplete(guess.trim());
  }, [guess, onComplete]);

  return (
    <Card className="w-full max-w-2xl" data-testid="pretest-prompt">
      <CardHeader>
        <div className="flex items-center gap-2">
          <Lightbulb className="h-5 w-5 text-amber-500" />
          <CardTitle>Devine d'abord</CardTitle>
        </div>
        <CardDescription>
          Deviner avant d'apprendre renforce l'encodage (Pan et al. 2023), même si tu te trompes.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div
          className="w-full whitespace-pre-wrap rounded-md border bg-muted/30 px-4 py-6 text-center text-2xl font-medium leading-relaxed"
          data-testid="pretest-front"
        >
          {front || <span className="text-muted-foreground italic">(recto vide)</span>}
        </div>
        <Textarea
          value={guess}
          onChange={(e) => setGuess(e.target.value)}
          placeholder="Devine la réponse (même si tu n'es pas sûr)"
          rows={3}
          aria-label="Devine la réponse"
          data-testid="pretest-input"
          // Cmd/Ctrl+Enter reveals without forcing a mouse trip.
          onKeyDown={(e) => {
            if ((e.metaKey || e.ctrlKey) && e.key === "Enter") {
              e.preventDefault();
              handleReveal();
            }
          }}
        />
        <div className="flex justify-end">
          <Button onClick={handleReveal} data-testid="pretest-reveal">
            Révéler
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
