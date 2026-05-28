/**
 * Self-explanation prompt — Vague 12 (Chi et al. 1989; Bisra meta g≈0.55).
 *
 * Surfaced on a fraction of reviews (the parent decides the cadence, ~1/5)
 * AFTER the flip and BEFORE the rating buttons. The learner is invited to
 * explain, in one sentence, *why* the revealed answer holds — an
 * elaborative-interrogation prompt that strengthens retention.
 *
 * The explanation is **never scored or persisted** (keeps the feature
 * migration-free): the metacognitive act is the whole point. « Continuer »
 * is always available, even with an empty box, so the prompt never blocks
 * the session.
 */

import { MessageSquare } from "lucide-react";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Textarea } from "@/components/ui/textarea";

interface SelfExplanationPromptProps {
  /** Called when the learner is done — fires whether or not they typed anything. */
  onContinue: () => void;
}

export function SelfExplanationPrompt({ onContinue }: SelfExplanationPromptProps) {
  const [text, setText] = useState("");

  return (
    <Card className="w-full max-w-2xl" data-testid="self-explanation-prompt">
      <CardHeader>
        <div className="flex items-center gap-2">
          <MessageSquare className="h-5 w-5 text-primary" />
          <CardTitle>Explique pourquoi</CardTitle>
        </div>
        <CardDescription>Auto-expliquer renforce la rétention (Chi 1989, g=0.55).</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <Textarea
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder="Explique pourquoi en une phrase…"
          rows={3}
          aria-label="Explique pourquoi en une phrase"
          data-testid="self-explanation-input"
          onKeyDown={(e) => {
            if ((e.metaKey || e.ctrlKey) && e.key === "Enter") {
              e.preventDefault();
              onContinue();
            }
          }}
        />
        <div className="flex justify-end">
          <Button onClick={onContinue} data-testid="self-explanation-continue">
            Continuer
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
