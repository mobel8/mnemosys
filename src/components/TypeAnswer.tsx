/**
 * Type-the-answer input — generation effect (Slamecka & Graf 1978, d≈0.40).
 *
 * The learner types what they think the answer is BEFORE flipping the card.
 * On submit we compute a normalised Levenshtein similarity (1 — distance /
 * max(len)) and bucket it into "excellent" / "close" / "incorrect" feedback.
 * The score is surfaced back to the parent through `onSubmit` so it can
 * factor into the review log if desired (the UX currently doesn't force the
 * score into the FSRS rating — the learner keeps full control).
 *
 * Implementation notes:
 *   - Comparison is case-insensitive, diacritics are stripped, and
 *     surrounding whitespace is trimmed. This matches what a learner
 *     "would have said out loud" rather than what they typed verbatim.
 *   - Levenshtein is implemented locally to avoid adding a runtime
 *     dependency for ~30 lines of code.
 *   - The submit button is disabled when the input is empty so the
 *     feedback feels intentional.
 *
 * Accessibility:
 *   - The input is auto-focused on mount.
 *   - Enter submits; Esc clears.
 *   - The feedback region is `aria-live="polite"` so screen readers pick
 *     it up as it transitions from « waiting » to « excellent / close /
 *     incorrect ».
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";

const EXCELLENT_THRESHOLD = 0.85;
const CLOSE_THRESHOLD = 0.7;

export type TypeAnswerVerdict = "excellent" | "close" | "incorrect";

interface TypeAnswerProps {
  /** The expected answer (verso). Case + diacritics are normalised. */
  expectedAnswer: string;
  /** Fired once the learner clicks "Valider" or hits Enter. */
  onSubmit: (typed: string, score: number, verdict: TypeAnswerVerdict) => void;
  /** Optional input disable (e.g. while submitting). */
  disabled?: boolean;
}

/** Strip combining diacritics, lowercase, and trim outer whitespace. */
function normalise(input: string): string {
  // U+0300..U+036F is the "Combining Diacritical Marks" block.
  return input.normalize("NFKD").replace(/[̀-ͯ]/g, "").toLowerCase().trim();
}

/** Classic O(n*m) Levenshtein. Both inputs ≤ a few hundred chars in practice. */
export function levenshtein(a: string, b: string): number {
  if (a === b) return 0;
  if (a.length === 0) return b.length;
  if (b.length === 0) return a.length;

  // Two-row dynamic programming — keeps memory at O(min(n, m)).
  const [shorter, longer] = a.length < b.length ? [a, b] : [b, a];
  let prev = Array.from({ length: shorter.length + 1 }, (_, i) => i);
  let curr = new Array(shorter.length + 1).fill(0);

  for (let i = 1; i <= longer.length; i++) {
    curr[0] = i;
    const longCh = longer.charCodeAt(i - 1);
    for (let j = 1; j <= shorter.length; j++) {
      const cost = shorter.charCodeAt(j - 1) === longCh ? 0 : 1;
      curr[j] = Math.min(
        // biome-ignore lint/style/noNonNullAssertion: prev/curr are pre-filled above the inner loop, indices guaranteed in-range.
        curr[j - 1]! + 1,
        // biome-ignore lint/style/noNonNullAssertion: see above.
        prev[j]! + 1,
        // biome-ignore lint/style/noNonNullAssertion: see above.
        prev[j - 1]! + cost,
      );
    }
    [prev, curr] = [curr, prev];
  }
  // The last "prev" row holds the distance.
  return prev[shorter.length] ?? 0;
}

/**
 * Normalised similarity score in `[0, 1]`. `1` means identical after
 * normalisation, `0` means « completely different ».
 */
export function similarityScore(typed: string, expected: string): number {
  const a = normalise(typed);
  const b = normalise(expected);
  const maxLen = Math.max(a.length, b.length);
  if (maxLen === 0) return 1;
  const distance = levenshtein(a, b);
  const raw = 1 - distance / maxLen;
  // Clamp because the formula can dip below 0 for pathological inputs.
  return Math.max(0, Math.min(1, raw));
}

export function verdictFor(score: number): TypeAnswerVerdict {
  if (score >= EXCELLENT_THRESHOLD) return "excellent";
  if (score >= CLOSE_THRESHOLD) return "close";
  return "incorrect";
}

const VERDICT_COPY: Record<TypeAnswerVerdict, { label: string; className: string }> = {
  excellent: {
    label: "Excellent",
    className: "bg-emerald-100 text-emerald-900 dark:bg-emerald-900/40 dark:text-emerald-100",
  },
  close: {
    label: "Proche",
    className: "bg-amber-100 text-amber-900 dark:bg-amber-900/40 dark:text-amber-100",
  },
  incorrect: {
    label: "Incorrect",
    className: "bg-red-100 text-red-900 dark:bg-red-900/40 dark:text-red-100",
  },
};

export function TypeAnswer({ expectedAnswer, onSubmit, disabled = false }: TypeAnswerProps) {
  const [typed, setTyped] = useState("");
  const [submitted, setSubmitted] = useState(false);
  const [verdict, setVerdict] = useState<TypeAnswerVerdict | null>(null);
  const [score, setScore] = useState<number>(0);

  const inputRef = useRef<HTMLInputElement | null>(null);

  // Auto-focus on mount so the learner can start typing immediately.
  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  const handleSubmit = useCallback(() => {
    if (submitted || disabled || typed.trim().length === 0) return;
    const s = similarityScore(typed, expectedAnswer);
    const v = verdictFor(s);
    setScore(s);
    setVerdict(v);
    setSubmitted(true);
    onSubmit(typed, s, v);
  }, [disabled, expectedAnswer, onSubmit, submitted, typed]);

  const onKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLInputElement>) => {
      if (e.key === "Enter") {
        e.preventDefault();
        handleSubmit();
      } else if (e.key === "Escape") {
        e.preventDefault();
        if (!submitted) setTyped("");
      }
    },
    [handleSubmit, submitted],
  );

  const verdictClass = verdict ? VERDICT_COPY[verdict].className : "";
  const verdictLabel = verdict ? VERDICT_COPY[verdict].label : "";
  const scorePct = useMemo(() => Math.round(score * 100), [score]);

  return (
    <div className="flex w-full max-w-xl flex-col gap-3" data-testid="type-answer">
      <label htmlFor="type-answer-input" className="text-sm text-muted-foreground">
        Tape ta réponse — puis valide pour comparer.
      </label>
      <div className="flex gap-2">
        <Input
          id="type-answer-input"
          ref={inputRef}
          type="text"
          value={typed}
          disabled={disabled || submitted}
          autoComplete="off"
          autoCorrect="off"
          autoCapitalize="off"
          spellCheck={false}
          onChange={(e) => setTyped(e.target.value)}
          onKeyDown={onKeyDown}
          placeholder="Ta réponse…"
          aria-label="Ta réponse"
        />
        <Button
          type="button"
          onClick={handleSubmit}
          disabled={disabled || submitted || typed.trim().length === 0}
        >
          Valider
        </Button>
      </div>

      <div
        aria-live="polite"
        className={cn(
          "min-h-[44px] rounded-md border px-3 py-2 text-sm transition-colors",
          submitted ? verdictClass : "border-dashed text-muted-foreground",
        )}
        data-testid="type-answer-feedback"
      >
        {submitted && verdict ? (
          <div className="flex flex-wrap items-center justify-between gap-2">
            <span className="font-semibold">{verdictLabel}</span>
            <span className="tabular-nums text-xs">Similarité : {scorePct}%</span>
            <span className="w-full truncate text-xs opacity-80">
              Attendu&nbsp;: <span className="font-medium">{expectedAnswer}</span>
            </span>
          </div>
        ) : (
          <span>Compare ta saisie à la réponse attendue.</span>
        )}
      </div>
    </div>
  );
}
