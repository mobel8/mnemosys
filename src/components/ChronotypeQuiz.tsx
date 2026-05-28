/**
 * Chronotype calibration quiz (Vague 18).
 *
 * A short, self-contained adaptation of the Morningness–Eveningness
 * Questionnaire (Horne & Östberg 1976; reduced rMEQ, Adan & Almirall 1991).
 * Five Likert items, each scored; the summed score maps to a chronotype:
 *   - morning      : naturally early, peak alertness in the AM.
 *   - intermediate : flexible / no strong lean.
 *   - evening      : naturally late, peak alertness in the PM/evening.
 *
 * The result is persisted to `AppSettings.chronotype` and drives a « best study
 * slots » recommendation. Purely informational — no medical claim.
 *
 * The component is a controlled `Dialog`; the parent owns `open`/`onClose`.
 */

import { useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";

/** Chronotype classification stored in settings. */
export type Chronotype = "morning" | "intermediate" | "evening";

interface QuizOption {
  label: string;
  /** Higher = more « morning ». */
  score: number;
}

interface QuizQuestion {
  id: string;
  prompt: string;
  options: QuizOption[];
}

/**
 * Five rMEQ-style items. Option scores are tuned so the achievable total runs
 * from 5 (extreme evening) to ~25 (extreme morning); the thresholds below
 * split that range into the three types.
 */
const QUESTIONS: QuizQuestion[] = [
  {
    id: "wake",
    prompt: "Si tu étais totalement libre de ton emploi du temps, à quelle heure te lèverais-tu ?",
    options: [
      { label: "Avant 6h30", score: 5 },
      { label: "6h30 – 7h45", score: 4 },
      { label: "7h45 – 9h45", score: 3 },
      { label: "9h45 – 11h", score: 2 },
      { label: "Après 11h", score: 1 },
    ],
  },
  {
    id: "morning_alertness",
    prompt: "Dans la demi-heure qui suit ton réveil, comment te sens-tu ?",
    options: [
      { label: "Très alerte", score: 4 },
      { label: "Plutôt alerte", score: 3 },
      { label: "Plutôt endormi·e", score: 2 },
      { label: "Très endormi·e", score: 1 },
    ],
  },
  {
    id: "peak",
    prompt: "À quel moment de la journée te sens-tu au sommet de ta forme ?",
    options: [
      { label: "Tôt le matin", score: 5 },
      { label: "En fin de matinée", score: 4 },
      { label: "L'après-midi", score: 3 },
      { label: "En soirée", score: 2 },
      { label: "Tard le soir / la nuit", score: 1 },
    ],
  },
  {
    id: "bedtime",
    prompt: "Si tu étais totalement libre, à quelle heure te coucherais-tu ?",
    options: [
      { label: "Avant 21h", score: 5 },
      { label: "21h – 22h15", score: 4 },
      { label: "22h15 – 00h30", score: 3 },
      { label: "00h30 – 1h45", score: 2 },
      { label: "Après 1h45", score: 1 },
    ],
  },
  {
    id: "self_type",
    prompt: "Spontanément, tu te considères plutôt…",
    options: [
      { label: "Nettement du matin", score: 4 },
      { label: "Plutôt du matin", score: 3 },
      { label: "Plutôt du soir", score: 2 },
      { label: "Nettement du soir", score: 1 },
    ],
  },
];

const MORNING_THRESHOLD = 18;
const EVENING_THRESHOLD = 12;

/** Map a summed quiz score to a chronotype. Exposed for unit testing. */
export function scoreToChronotype(total: number): Chronotype {
  if (total >= MORNING_THRESHOLD) return "morning";
  if (total <= EVENING_THRESHOLD) return "evening";
  return "intermediate";
}

/** Human label + recommended study slots for each chronotype. */
export const CHRONOTYPE_INFO: Record<Chronotype, { label: string; slots: string }> = {
  morning: { label: "Matinal", slots: "7h – 11h" },
  intermediate: { label: "Intermédiaire", slots: "10h – 12h et 16h – 18h" },
  evening: { label: "Vespéral (du soir)", slots: "18h – 22h" },
};

interface ChronotypeQuizProps {
  open: boolean;
  onClose: () => void;
  /** Called with the computed type once the learner finishes the 5 questions. */
  onResult: (chronotype: Chronotype) => void;
}

export function ChronotypeQuiz({ open, onClose, onResult }: ChronotypeQuizProps) {
  // answers[questionId] = chosen option index
  const [answers, setAnswers] = useState<Record<string, number>>({});

  const allAnswered = useMemo(() => QUESTIONS.every((q) => answers[q.id] !== undefined), [answers]);

  const total = useMemo(() => {
    return QUESTIONS.reduce((sum, q) => {
      const idx = answers[q.id];
      if (idx === undefined) return sum;
      const opt = q.options[idx];
      return sum + (opt ? opt.score : 0);
    }, 0);
  }, [answers]);

  function handleSubmit() {
    if (!allAnswered) return;
    const chronotype = scoreToChronotype(total);
    onResult(chronotype);
    setAnswers({});
    onClose();
  }

  if (!open) return null;

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-h-[85vh] overflow-y-auto" data-testid="chronotype-quiz-dialog">
        <DialogHeader>
          <DialogTitle>Calibre ton chronotype</DialogTitle>
          <DialogDescription>
            5 questions pour déterminer si tu es plutôt du matin ou du soir, et te suggérer tes
            meilleurs créneaux d'étude. Aucune prescription médicale.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-5 py-2">
          {QUESTIONS.map((q, qi) => (
            <fieldset key={q.id} className="space-y-2">
              <legend className="text-sm font-medium">
                {qi + 1}. {q.prompt}
              </legend>
              <div className="space-y-1.5">
                {q.options.map((opt, oi) => {
                  const inputId = `${q.id}-${oi}`;
                  return (
                    <div key={inputId} className="flex items-center gap-2">
                      <input
                        id={inputId}
                        type="radio"
                        name={q.id}
                        checked={answers[q.id] === oi}
                        onChange={() => setAnswers((prev) => ({ ...prev, [q.id]: oi }))}
                        className="h-4 w-4"
                      />
                      <Label htmlFor={inputId} className="cursor-pointer text-sm font-normal">
                        {opt.label}
                      </Label>
                    </div>
                  );
                })}
              </div>
            </fieldset>
          ))}
        </div>

        <DialogFooter>
          <Button type="button" variant="ghost" onClick={onClose}>
            Annuler
          </Button>
          <Button
            type="button"
            onClick={handleSubmit}
            disabled={!allAnswered}
            data-testid="chronotype-submit"
          >
            Voir mon résultat
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
