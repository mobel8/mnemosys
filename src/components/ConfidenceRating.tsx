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
}

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
    className:
      "border-red-200 bg-red-50 text-red-700 hover:bg-red-100 dark:border-red-900/40 dark:bg-red-950/40 dark:text-red-200",
  },
  {
    level: 2,
    label: "2",
    tooltip: "Peu confiant — j'hésite beaucoup",
    className:
      "border-orange-200 bg-orange-50 text-orange-700 hover:bg-orange-100 dark:border-orange-900/40 dark:bg-orange-950/40 dark:text-orange-200",
  },
  {
    level: 3,
    label: "3",
    tooltip: "Moyennement confiant — je pense savoir",
    className:
      "border-amber-200 bg-amber-50 text-amber-800 hover:bg-amber-100 dark:border-amber-900/40 dark:bg-amber-950/40 dark:text-amber-200",
  },
  {
    level: 4,
    label: "4",
    tooltip: "Confiant — je suis sûr·e à 80%",
    className:
      "border-lime-200 bg-lime-50 text-lime-800 hover:bg-lime-100 dark:border-lime-900/40 dark:bg-lime-950/40 dark:text-lime-200",
  },
  {
    level: 5,
    label: "5",
    tooltip: "Très confiant — je suis certain·e",
    className:
      "border-emerald-200 bg-emerald-50 text-emerald-800 hover:bg-emerald-100 dark:border-emerald-900/40 dark:bg-emerald-950/40 dark:text-emerald-200",
  },
];

export function ConfidenceRating({ value, onChange, disabled = false }: ConfidenceRatingProps) {
  return (
    <fieldset className="flex w-full max-w-md flex-col gap-2" data-testid="confidence-rating">
      <legend className="text-xs uppercase tracking-wide text-muted-foreground">
        Confiance avant rating (CBM)
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
      <p className="text-[11px] text-muted-foreground">
        Très peu confiant&nbsp;→&nbsp;Très confiant. Aide à mesurer la calibration de ta
        métacognition (Gardner-Medwin, UCL).
      </p>
    </fieldset>
  );
}
