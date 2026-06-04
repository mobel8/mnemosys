/**
 * Confidence rating — CBM (Confidence-Based Marking, Gardner-Medwin / UCL).
 *
 * The learner rates how confident they are in their upcoming answer on a
 * 1..5 scale BEFORE seeing the FSRS rating buttons. The two signals are
 * kept orthogonal:
 *   - The FSRS rating measures the *outcome* (did the learner get it
 *     right + how easy was it?).
 *   - The CBM rating measures the *metacognition* (how sure was the
 *     learner?). Calibration shows up over time on the stats page.
 *
 * Implementation:
 *   - Five icon buttons, colour-graded red → green so the rating feels
 *     like a thermometer rather than a quiz.
 *   - A `title` (native tooltip) on each button explains the CBM levels.
 *   - The active button is highlighted with `aria-pressed`.
 *   - The whole strip stays keyboard-friendly: the buttons are real
 *     `<button>`s in tab order; arrow keys are *not* hooked because the
 *     parent (`ReviewControls`) already binds 1-4 for the FSRS rating —
 *     overlapping numeric shortcuts would be a footgun.
 */

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

interface ConfidenceRatingProps {
  /** Currently selected confidence (1..5). `null`/`undefined` means « not rated yet ». */
  value: number | null | undefined;
  onChange: (value: number) => void;
  disabled?: boolean;
  /**
   * Which capture moment this strip represents:
   *   - `"prospective"` (default, v5) — before the flip (CBM, Gardner-Medwin).
   *   - `"retrospective"` (v15) — after the answer is shown (Bang & Fleming
   *     2018, two-step confidence). Only the labels change; the 1..5 scale and
   *     `onChange` contract are identical.
   */
  variant?: "prospective" | "retrospective";
}

const VARIANT_COPY = {
  prospective: {
    legend: "Confiance avant rating (CBM)",
    help: "Très peu confiant → Très confiant. Aide à mesurer la calibration de ta métacognition (Gardner-Medwin, UCL).",
    testid: "confidence-rating",
  },
  retrospective: {
    legend: "Maintenant que tu as vu la réponse, à quel point étais-tu sûr ?",
    help: "Confiance rétrospective (Bang & Fleming 2018) : capte ta certitude une fois la réponse révélée.",
    testid: "confidence-rating-post",
  },
} as const;

interface LevelDef {
  level: number;
  label: string;
  tooltip: string;
  className: string;
}

const LEVELS: readonly LevelDef[] = [
  {
    level: 1,
    label: "1",
    tooltip: "Aucune confiance — pure intuition",
    className: "border-destructive/30 bg-destructive/10 text-foreground hover:bg-destructive/20",
  },
  {
    level: 2,
    label: "2",
    tooltip: "Peu confiant — j'hésite beaucoup",
    className: "border-warning/30 bg-warning/10 text-foreground hover:bg-warning/20",
  },
  {
    level: 3,
    label: "3",
    tooltip: "Moyennement confiant — je pense savoir",
    className: "border-warning/40 bg-warning/15 text-foreground hover:bg-warning/25",
  },
  {
    level: 4,
    label: "4",
    tooltip: "Confiant — je suis sûr·e à 80%",
    className: "border-success/30 bg-success/10 text-foreground hover:bg-success/20",
  },
  {
    level: 5,
    label: "5",
    tooltip: "Très confiant — je suis certain·e",
    className: "border-success/45 bg-success/20 text-foreground hover:bg-success/30",
  },
];

export function ConfidenceRating({
  value,
  onChange,
  disabled = false,
  variant = "prospective",
}: ConfidenceRatingProps) {
  const copy = VARIANT_COPY[variant];
  return (
    <fieldset className="flex w-full max-w-md flex-col gap-2" data-testid={copy.testid}>
      <legend className="text-xs uppercase tracking-wide text-muted-foreground">
        {copy.legend}
      </legend>
      <div className="flex items-center gap-2">
        {LEVELS.map((lvl) => {
          const isActive = value === lvl.level;
          return (
            <Button
              key={lvl.level}
              type="button"
              variant="outline"
              size="sm"
              disabled={disabled}
              aria-pressed={isActive}
              aria-label={`Confiance ${lvl.level} sur 5 — ${lvl.tooltip}`}
              title={lvl.tooltip}
              data-testid={`confidence-${lvl.level}`}
              onClick={() => onChange(lvl.level)}
              className={cn(
                "h-10 w-10 flex-1 rounded-md border transition-all",
                lvl.className,
                isActive && "ring-2 ring-primary/60 ring-offset-2 ring-offset-background",
              )}
            >
              {lvl.label}
            </Button>
          );
        })}
      </div>
      <p className="text-[11px] text-muted-foreground">{copy.help}</p>
    </fieldset>
  );
}
