/**
 * Per-deck scheduler picker (Vague 4).
 *
 * Renders three radio-style cards letting the learner choose which
 * algorithm a deck uses to schedule its cards. The component is fully
 * controlled — the parent dialog owns the state — so it slots cleanly
 * into both `<CreateDeckDialog>` and `<EditDeckDialog>`.
 *
 * Design choices:
 * - Visual "card radio" rather than a `<select>` because each option has
 *   a one-sentence description that should be visible at a glance.
 * - The recommended option (FSRS-6) is marked with a small text badge so
 *   the user has a sensible default suggestion.
 * - Editing an existing deck simply changes the kind — existing cards
 *   keep their `stability` / `difficulty`. The note about that lives in
 *   `<EditDeckDialog>` since it's only meaningful there.
 */

import { Label } from "@/components/ui/label";
import type { SchedulerKind } from "@/lib/tauri";
import { cn } from "@/lib/utils";

interface SchedulerPickerProps {
  value: SchedulerKind;
  onChange: (kind: SchedulerKind) => void;
  /** Optional helper line displayed under the heading. */
  helperText?: string;
}

interface SchedulerOption {
  kind: SchedulerKind;
  title: string;
  recommended?: boolean;
  description: string;
}

const OPTIONS: readonly SchedulerOption[] = [
  {
    kind: "fsrs6",
    title: "FSRS-6",
    recommended: true,
    description:
      "Adaptatif moderne, prédit la rétention avec 21 paramètres. Recommandé pour la plupart des decks.",
  },
  {
    kind: "sm2",
    title: "SM-2",
    description:
      "Algorithme Anki classique. Déterministe et auditable — pratique si tu veux contrôler exactement les intervalles.",
  },
  {
    kind: "leitner",
    title: "Leitner 5-box",
    description:
      "5 boîtes simples (1, 3, 7, 14, 30 jours). Idéal pour les matières non critiques ou pour débuter.",
  },
];

export function SchedulerPicker({ value, onChange, helperText }: SchedulerPickerProps) {
  return (
    <div className="space-y-2">
      <Label>Algorithme de scheduling</Label>
      {helperText && <p className="text-xs text-muted-foreground">{helperText}</p>}
      {/* Hidden native radios + clickable labels give us the right ARIA
          semantics (each option is a real <input type="radio">) while
          letting Tailwind render the option as a card. */}
      <fieldset className="grid gap-2 border-0 p-0">
        <legend className="sr-only">Algorithme de scheduling</legend>
        {OPTIONS.map((opt) => {
          const selected = value === opt.kind;
          const id = `scheduler-${opt.kind}`;
          return (
            <label
              key={opt.kind}
              htmlFor={id}
              className={cn(
                "cursor-pointer rounded-md border p-3 text-left transition-colors",
                "focus-within:outline-none focus-within:ring-2 focus-within:ring-ring",
                selected
                  ? "border-primary bg-primary/5"
                  : "border-input hover:border-muted-foreground/40",
              )}
            >
              <input
                id={id}
                type="radio"
                name="scheduler-kind"
                value={opt.kind}
                checked={selected}
                onChange={() => onChange(opt.kind)}
                className="sr-only"
              />
              <div className="flex items-center gap-2">
                <span className="text-sm font-semibold">{opt.title}</span>
                {opt.recommended && (
                  <span className="rounded-full bg-primary/15 px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide text-primary">
                    Recommandé
                  </span>
                )}
              </div>
              <p className="mt-1 text-xs text-muted-foreground">{opt.description}</p>
            </label>
          );
        })}
      </fieldset>
    </div>
  );
}

/** Short pretty label, used in deck badges. */
export function schedulerLabel(kind: SchedulerKind): string {
  switch (kind) {
    case "fsrs6":
      return "FSRS";
    case "sm2":
      return "SM-2";
    case "leitner":
      return "Leitner";
  }
}
